//! Auth web routes — Task 14.4. Port of src/app/api/auth/{login,logout,
//! mode,register,status}/route.ts plus the account halves of
//! src/lib/auth.ts (authenticate / registerUser) and src/lib/invites.ts
//! (acceptInvite / findInvite).
//!
//! Two login modes behind one endpoint — which applies is a property of
//! the INSTALL, not the request: accounts (users > 0) take precedence
//! over the shared APP_PASSWORD, deliberately, so a still-set
//! APP_PASSWORD cannot become a back door around real users.

use crate::auth::ct_eq;
use crate::config::Config;
use crate::db::Db;
use crate::password;
use crate::session::{
    self, issue_session_cookie, password_login_cookie, Claims, UserRow, SESSION_COOKIE,
    SESSION_TTL_MS, USER_COLS,
};
use crate::util::now_ms;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

const LOGIN_WINDOW_MS: i64 = 15 * 60_000;
const LOGIN_FAILURES_PER_ACCOUNT: i64 = 10;
const LOGIN_FAILURES_PER_CALLER: i64 = 10;
const LOGIN_FAILURES_SHARED: i64 = 50;

fn json_response(status: StatusCode, body: Value) -> Response {
    (status, Json(body)).into_response()
}

fn set_cookie_resp(status: StatusCode, body: Value, cookie: String) -> Response {
    let mut resp = (status, Json(body)).into_response();
    if let Ok(v) = cookie.parse() {
        resp.headers_mut().append("set-cookie", v);
    }
    resp
}

// ---------------------------------------------------------------------------
// Accounts (src/lib/auth.ts authenticate / registerUser + invites)
// ---------------------------------------------------------------------------

/// Port of authenticate(). Same message for "no such user" and "wrong
/// password" so the form cannot enumerate accounts; the no-such-user path
/// burns a scrypt round to keep the work similar.
async fn authenticate(db: &Db, email: &str, submitted: &str) -> Result<UserRow, String> {
    let normalised = password::normalise_email(email);
    let user = db
        .with_conn(|c| {
            use rusqlite::OptionalExtension;
            c.query_row(
                &format!("SELECT {USER_COLS} FROM users WHERE lower(email) = ?1 LIMIT 1"),
                [&normalised],
                UserRow::from_row,
            )
            .optional()
        })
        .ok()
        .flatten();

    let Some(user) = user else {
        // scrypt is ~100ms of deliberate work — same as Node's await.
        let pw = submitted.to_string();
        let _ = tokio::task::spawn_blocking(move || password::hash_password(&pw)).await;
        return Err("Email or password is incorrect.".into());
    };

    let stored = user.password_hash.clone();
    let pw = submitted.to_string();
    let ok = tokio::task::spawn_blocking(move || password::verify_password(&pw, &stored))
        .await
        .unwrap_or(false);
    if !ok {
        return Err("Email or password is incorrect.".into());
    }
    if !user.active {
        return Err("That account has been deactivated. Ask the owner to re-enable it.".into());
    }

    let _ = db.with_conn(|c| {
        c.execute(
            "UPDATE users SET last_login_at = unixepoch() WHERE id = ?1",
            [user.id],
        )
    });
    Ok(user)
}

/// Port of registerUser(). First account = owner (that is what makes
/// accounts opt-in); afterwards registration is closed unless an invite
/// vouches for the new row.
async fn register_user(
    db: &Db,
    _cfg: &Config,
    input_email: &str,
    input_password: &str,
    input_name: Option<&str>,
    role: Option<&str>,
    allow_when_accounts_exist: bool,
) -> Result<UserRow, String> {
    let email = password::normalise_email(input_email);
    if !email.contains('@') || email.chars().count() < 3 {
        return Err("That doesn't look like an email address.".into());
    }
    if let Some(problem) = password::password_problem(input_password) {
        return Err(problem);
    }
    let is_first = !db.accounts_enabled();
    if !is_first && !allow_when_accounts_exist {
        return Err(
            "This instance already has accounts. Ask the owner for an invite link.".into(),
        );
    }
    let existing = db
        .with_conn(|c| {
            use rusqlite::OptionalExtension;
            c.query_row(
                "SELECT id FROM users WHERE lower(email) = ?1 LIMIT 1",
                [&email],
                |r| r.get::<_, i64>(0),
            )
            .optional()
        })
        .ok()
        .flatten();
    if existing.is_some() {
        return Err("An account with that email already exists.".into());
    }

    let pw = input_password.to_string();
    let password_hash =
        tokio::task::spawn_blocking(move || password::hash_password(&pw))
            .await
            .unwrap_or_default();
    if password_hash.is_empty() {
        return Err("Could not hash the password.".into()); // cannot happen; fail closed
    }
    let role = if is_first {
        "owner".to_string()
    } else {
        role.unwrap_or("member").to_string()
    };
    let name = input_name
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(String::from);

    let inserted = db.with_conn(|c| {
        c.execute(
            "INSERT INTO users (email, password_hash, name, role, active) \
             VALUES (?1, ?2, ?3, ?4, 1)",
            rusqlite::params![email, password_hash, name, role],
        )?;
        let id = c.last_insert_rowid();
        c.query_row(
            &format!("SELECT {USER_COLS} FROM users WHERE id = ?1"),
            [id],
            UserRow::from_row,
        )
    });
    match inserted {
        Ok(user) => {
            db.set_accounts_enabled();
            Ok(user)
        }
        Err(_) => Err("An account with that email already exists.".into()),
    }
}

/// Port of findInvite: sha256(token) → row → not accepted → not expired.
fn find_invite(db: &Db, token: &str) -> Option<(i64, String, String)> {
    if token.is_empty() {
        return None;
    }
    let hash = session::sha256_hex(token);
    let row = db
        .with_conn(|c| {
            use rusqlite::OptionalExtension;
            c.query_row(
                "SELECT id, email, role, expires_at, accepted_at FROM user_invites \
                 WHERE token_hash = ?1 LIMIT 1",
                [&hash],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, Option<i64>>(3)?,
                        r.get::<_, Option<i64>>(4)?,
                    ))
                },
            )
            .optional()
        })
        .ok()
        .flatten()?;
    let (id, email, role, expires_at, accepted_at) = row;
    if accepted_at.is_some() {
        return None;
    }
    // invite.expiresAt.getTime() <= Date.now() — storage is epoch seconds.
    let expired = expires_at.map(|s| s * 1000 <= now_ms()).unwrap_or(true);
    if expired {
        return None;
    }
    Some((id, email, role))
}

/// Port of acceptInvite.
async fn accept_invite(
    db: &Db,
    cfg: &Config,
    token: &str,
    pwd: &str,
    name: Option<&str>,
) -> Result<i64, String> {
    let Some((invite_id, email, role)) = find_invite(db, token) else {
        return Err("That invite link is invalid or has expired. Ask for a new one.".into());
    };
    let user = register_user(db, cfg, &email, pwd, name, Some(&role), true).await?;
    let _ = db.with_conn(|c| {
        c.execute(
            "UPDATE user_invites SET accepted_at = unixepoch() WHERE id = ?1",
            [invite_id],
        )
    });
    Ok(user.id)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

fn body_json(body: &Bytes) -> Option<Value> {
    serde_json::from_slice(body).ok()
}

/// JS truthiness for a JSON value (used for body.token).
fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

fn rate_keys(
    state: &crate::AppState,
    headers: &HeaderMap,
    email: Option<&str>,
) -> Vec<(String, i64)> {
    let caller = crate::ratelimit::client_key(headers, state.cfg.trusted_proxy);
    let mut keys = vec![(
        format!("login:{caller}"),
        if caller == "shared" {
            LOGIN_FAILURES_SHARED
        } else {
            LOGIN_FAILURES_PER_CALLER
        },
    )];
    if let Some(e) = email {
        keys.push((
            format!("login:email:{}", password::normalise_email(e)),
            LOGIN_FAILURES_PER_ACCOUNT,
        ));
    }
    keys
}

fn too_many(reset_at: i64) -> Response {
    // Math.ceil((resetAt - now) / 60_000), floored at 1.
    let diff = reset_at - now_ms();
    let mins = ((diff + 59_999) / 60_000).max(1);
    let plural = if mins == 1 { "" } else { "s" };
    let mut resp = json_response(
        StatusCode::TOO_MANY_REQUESTS,
        json!({ "error": format!("Too many sign-in attempts. Try again in {mins} minute{plural}.") }),
    );
    if let Ok(v) = format!("{}", mins * 60).parse() {
        resp.headers_mut().insert("retry-after", v);
    }
    resp
}

/// POST /api/auth/login — two modes, install-level choice.
pub async fn login(
    State(state): State<crate::AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    // req.json().catch(() => null) — anything unparseable behaves like an
    // absent body: empty password, no email.
    let parsed = body_json(&body);
    let submitted = parsed
        .as_ref()
        .and_then(|v| v.get("password"))
        .map(|v| crate::util::js_string(Some(v)))
        .unwrap_or_default();
    // Rate-key email must be a non-empty STRING (the JS guard is typeof).
    let email_for_keys = parsed.as_ref().and_then(|v| v.get("email")).and_then(|e| {
        e.as_str()
            .filter(|s| !s.is_empty())
            .map(String::from)
    });
    let keys = rate_keys(&state, &headers, email_for_keys.as_deref());

    for (key, max) in &keys {
        let (limited, reset_at) = state.rl.is_limited(key, *max);
        if limited {
            return too_many(reset_at);
        }
    }

    if state.db.accounts_enabled() {
        let email = parsed
            .as_ref()
            .and_then(|v| v.get("email"))
            .map(|v| crate::util::js_string(Some(v)))
            .unwrap_or_default();
        if email.is_empty() {
            return json_response(
                StatusCode::BAD_REQUEST,
                json!({ "error": "Enter your email address." }),
            );
        }
        match authenticate(&state.db, &email, &submitted).await {
            Ok(user) => {
                let cookie = issue_session_cookie(&state.db, &headers, &state.cfg, &user)
                    .expect("issue_session_cookie always returns Some");
                return set_cookie_resp(
                    StatusCode::OK,
                    json!({
                        "ok": true,
                        "user": { "id": user.id, "name": user.name, "role": user.role },
                    }),
                    cookie,
                );
            }
            Err(err) => {
                for (key, max) in &keys {
                    state.rl.check(key, *max, LOGIN_WINDOW_MS);
                }
                // Same 250ms jitter as the Node side — a fast "no such
                // user" next to a slow "wrong password" is how account
                // enumeration works.
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                return json_response(StatusCode::UNAUTHORIZED, json!({ "error": err }));
            }
        }
    }

    let required = state.cfg.app_password.as_str();
    if required.is_empty() {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Auth disabled (APP_PASSWORD not set)" }),
        );
    }
    if !ct_eq(submitted.as_bytes(), required.as_bytes()) {
        for (key, max) in &keys {
            state.rl.check(key, *max, LOGIN_WINDOW_MS);
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        return json_response(StatusCode::UNAUTHORIZED, json!({ "error": "Wrong password" }));
    }
    // Cookie value is the hashed token, NEVER the raw password.
    let token = session::sha256_hex(&format!("{required}.v1"));
    set_cookie_resp(
        StatusCode::OK,
        json!({ "ok": true }),
        password_login_cookie(&headers, &state.cfg, &token),
    )
}

/// POST /api/auth/logout — clears BOTH cookies unconditionally.
pub async fn logout(headers: HeaderMap) -> Response {
    let mut resp = json_response(StatusCode::OK, json!({ "ok": true }));
    for cookie in session::clear_cookies(&headers) {
        if let Ok(v) = cookie.parse() {
            resp.headers_mut().append("set-cookie", v);
        }
    }
    resp
}

/// GET /api/auth/mode — middleware asks, because the edge sandbox cannot
/// open SQLite. Nothing but the mode leaves this endpoint.
pub async fn mode(State(state): State<crate::AppState>) -> Response {
    let mode = if state.db.accounts_enabled() {
        "accounts"
    } else if state.cfg.app_password_set {
        "password"
    } else {
        "open"
    };
    let mut resp = json_response(StatusCode::OK, json!({ "mode": mode }));
    if let Ok(v) = "no-store".parse() {
        resp.headers_mut().insert("cache-control", v);
    }
    resp
}

/// POST /api/auth/register — first owner or valid invite, nothing else.
pub async fn register(
    State(state): State<crate::AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let parsed = body_json(&body);
    let get = |key: &str| parsed.as_ref().and_then(|v| v.get(key));
    let pwd = get("password").map(|v| crate::util::js_string(Some(v))).unwrap_or_default();
    let name = get("name").and_then(|v| match v {
        Value::String(s) => Some(s.clone()),
        _ => None,
    });

    if truthy(get("token")) {
        let token = get("token").map(|v| crate::util::js_string(Some(v))).unwrap_or_default();
        return match accept_invite(&state.db, &state.cfg, &token, &pwd, name.as_deref()).await {
            Err(err) => json_response(StatusCode::BAD_REQUEST, json!({ "error": err })),
            Ok(user_id) => {
                let user: Option<UserRow> = state
                    .db
                    .with_conn(|c| {
                        c.query_row(
                            &format!("SELECT {USER_COLS} FROM users WHERE id = ?1"),
                            [user_id],
                            UserRow::from_row,
                        )
                    })
                    .ok();
                let mut resp = json_response(StatusCode::OK, json!({ "ok": true }));
                if let Some(user) = user {
                    if let Some(cookie) =
                        issue_session_cookie(&state.db, &headers, &state.cfg, &user)
                    {
                        if let Ok(v) = cookie.parse() {
                            resp.headers_mut().append("set-cookie", v);
                        }
                    }
                }
                resp
            }
        };
    }

    if state.db.accounts_enabled() {
        return json_response(
            StatusCode::FORBIDDEN,
            json!({ "error": "This instance already has accounts. Ask the owner for an invite link." }),
        );
    }

    let email = get("email").map(|v| crate::util::js_string(Some(v))).unwrap_or_default();
    match register_user(
        &state.db,
        &state.cfg,
        &email,
        &pwd,
        name.as_deref(),
        None,
        false,
    )
    .await
    {
        Err(err) => json_response(StatusCode::BAD_REQUEST, json!({ "error": err })),
        Ok(user) => {
            let mut resp = json_response(StatusCode::OK, json!({ "ok": true }));
            if let Some(cookie) = issue_session_cookie(&state.db, &headers, &state.cfg, &user) {
                if let Ok(v) = cookie.parse() {
                    resp.headers_mut().append("set-cookie", v);
                }
            }
            resp
        }
    }
}

/// GET /api/auth/status — who is signed in, if anyone. Never echoes a
/// password, a token, or whether a specific email exists.
pub async fn status(State(state): State<crate::AppState>, headers: HeaderMap) -> Response {
    let accounts = state.db.accounts_enabled();
    let user = if accounts {
        session::current_user(&state.db, &headers, &state.cfg)
    } else {
        None
    };
    let mode = if accounts {
        "accounts"
    } else if state.cfg.app_password_set {
        "password"
    } else {
        "open"
    };
    json_response(
        StatusCode::OK,
        json!({
            "enabled": accounts || state.cfg.app_password_set,
            "mode": mode,
            "user": user.map(|u| json!({
                "id": u.id,
                "name": u.name,
                "email": u.email,
                "role": u.role,
            })),
        }),
    )
}

// ---------------------------------------------------------------------------
// /__dev/* — scaffolding probes for the token machinery. Clearly
// namespaced, never part of the contract.
// ---------------------------------------------------------------------------

/// GET /__dev/session — signs, verifies, and rejects a tampered token
/// using the SAME secret file the Next process uses.
pub async fn dev_session(State(state): State<crate::AppState>) -> Response {
    let secret = session::ensure_session_secret(&state.cfg);
    let fp = session::user_fingerprint("scrypt:1:aa:bb", true);
    let claims = Claims {
        user_id: 424242,
        expires_at: now_ms() + 60_000,
        fingerprint: fp,
    };
    let token = session::sign_session(&claims, &secret.value);
    let verified = session::verify_session(Some(&token), &secret.value).is_some();
    let tamper_accepted =
        session::verify_session(Some(&format!("{token}x")), &secret.value).is_some();
    let prefix = token.split('.').next().unwrap_or("").to_string();
    json_response(
        StatusCode::OK,
        json!({
            "ok": true,
            "version": prefix,
            "verified": verified,
            "tamper_rejected": !tamper_accepted,
            "secret_source": secret.source,
            "ttl_ms": SESSION_TTL_MS,
            "cookie": SESSION_COOKIE,
        }),
    )
}

/// GET /__dev/scrypt — FIXED input (parity-scrypt-check / 32-hex salt),
/// so the Node side can compute the same hash with crypto.scrypt and
/// prove the two KDF implementations agree byte-for-byte. This is the
/// interop that makes an accounts-mode password verify across stacks.
pub async fn dev_scrypt() -> Response {
    let hash = tokio::task::spawn_blocking(|| {
        let derived = {
            let mut out = [0u8; 64];
            let _ = scrypt::scrypt(
                b"parity-scrypt-check",
                b"0123456789abcdef0123456789abcdef",
                &scrypt::Params::new(14, 8, 1, 64).expect("valid params"),
                &mut out,
            );
            out.iter().map(|b| format!("{b:02x}")).collect::<String>()
        };
        format!("scrypt:1:0123456789abcdef0123456789abcdef:{derived}")
    })
    .await
    .unwrap_or_default();
    json_response(StatusCode::OK, json!({ "hash": hash }))
}
