//! Session tokens — Task 14.4. Port of src/lib/session-token.ts,
//! src/lib/session-secret.ts and the session halves of src/lib/auth.ts.
//!
//! Token: `v1.{userId}.{expiresAtMs}.{fingerprint}.{hmac-b64url}` —
//! stateless, verified by the Next edge middleware during cutover, so
//! the secret and the serialization must match the Node side exactly.
//! The secret resolves in the SAME priority order and reads the SAME
//! file the Next process wrote (.seo-session-secret in the data dir);
//! a cookie issued by either stack must verify in the other.

use crate::config::Config;
use crate::db::Db;
use crate::util::{now_ms, iso_from_secs};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

pub const SESSION_COOKIE: &str = "stb_session";
pub const PASSWORD_COOKIE: &str = "stb_auth";
/// 14 days (see session-token.ts — short enough that a stolen laptop
/// stops mattering; the pw fingerprint is the real revocation path).
pub const SESSION_TTL_MS: i64 = 14 * 24 * 60 * 60 * 1000;
const VERSION: &str = "v1";

type HmacSha256 = Hmac<Sha256>;

// ---------------------------------------------------------------------------
// Secret (port of session-secret.ts)
// ---------------------------------------------------------------------------

pub struct SecretInfo {
    pub value: String,
    pub source: &'static str,
}

static SECRET: OnceLock<SecretInfo> = OnceLock::new();

/// Port of ensureSessionSecret: SEO_SESSION_SECRET → data/.seo-session-secret
/// (≥32 chars) → generate + persist → APP_PASSWORD fallback → ephemeral.
pub fn ensure_session_secret(cfg: &Config) -> &SecretInfo {
    SECRET.get_or_init(|| resolve_secret(cfg))
}

fn resolve_secret(cfg: &Config) -> SecretInfo {
    if let Ok(from_env) = std::env::var("SEO_SESSION_SECRET") {
        let t = from_env.trim().to_string();
        if !t.is_empty() {
            return SecretInfo { value: t, source: "env" };
        }
    }
    let file = cfg.data_dir().join(".seo-session-secret");
    if let Ok(stored) = std::fs::read_to_string(&file) {
        let t = stored.trim().to_string();
        if t.chars().count() >= 32 {
            return SecretInfo { value: t, source: "file" };
        }
    }
    // Generate once and persist (mode 0600, same as the Node side).
    let mut buf = [0u8; 32];
    rand::Rng::fill(&mut rand::thread_rng(), &mut buf);
    let generated = b64url(&buf);
    let write_result = (|| -> std::io::Result<()> {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::create_dir_all(cfg.data_dir())?;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&file)?;
        f.write_all(generated.as_bytes())?;
        Ok(())
    })();
    match write_result {
        Ok(()) => SecretInfo { value: generated, source: "generated" },
        Err(_) => {
            // Read-only volume etc. — mirror the Node fallback chain.
            if !cfg.app_password.is_empty() {
                return SecretInfo {
                    value: format!("app-password:{}", cfg.app_password),
                    source: "app-password",
                };
            }
            let mut buf2 = [0u8; 32];
            rand::Rng::fill(&mut rand::thread_rng(), &mut buf2);
            SecretInfo { value: b64url(&buf2), source: "ephemeral" }
        }
    }
}

// ---------------------------------------------------------------------------
// Token primitives
// ---------------------------------------------------------------------------

/// btoa(s).replace('+','-').replace('/','_').replace(/=+$/,'') — identical
/// output to base64 URL_SAFE_NO_PAD for byte arrays.
fn b64url(bytes: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub fn sha256_hex(input: &str) -> String {
    let mut h = Sha256::new();
    h.update(input.as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn hmac_b64url(secret: &str, message: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("hmac accepts any key length");
    mac.update(message.as_bytes());
    b64url(&mac.finalize().into_bytes())
}

/// Port of userFingerprint: first 16 hex chars of
/// sha256(`${passwordHash}|${active ? 1 : 0}`). Change-detector, not a secret.
pub fn user_fingerprint(password_hash: &str, active: bool) -> String {
    sha256_hex(&format!("{password_hash}|{}", if active { 1 } else { 0 }))[..16].to_string()
}

pub struct Claims {
    pub user_id: i64,
    pub expires_at: i64,
    pub fingerprint: String,
}

pub fn sign_session(claims: &Claims, secret: &str) -> String {
    let payload = format!(
        "{VERSION}.{}.{}.{}",
        claims.user_id, claims.expires_at, claims.fingerprint
    );
    let sig = hmac_b64url(secret, &payload);
    format!("{payload}.{sig}")
}

/// Port of verifySession. Deliberately checks ONLY authenticity + expiry —
/// existence/active/fingerprint are the caller's job (requireUser port).
pub fn verify_session(token: Option<&str>, secret: &str) -> Option<Claims> {
    let token = token?;
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 5 {
        return None;
    }
    let (version, raw_id, raw_exp, fingerprint, sig) =
        (parts[0], parts[1], parts[2], parts[3], parts[4]);
    if version != VERSION {
        return None;
    }
    let payload = format!("{version}.{raw_id}.{raw_exp}.{fingerprint}");
    let expected = hmac_b64url(secret, &payload);
    // Constant-time-ish, same as the Node side.
    if sig.len() != expected.len() {
        return None;
    }
    if !crate::auth::ct_eq(sig.as_bytes(), expected.as_bytes()) {
        return None;
    }
    // Number(rawId): integer > 0. JS Number("") = 0 → rejected here too.
    let user_id = parse_js_number(raw_id)? as i64;
    if user_id <= 0 {
        return None;
    }
    let expires_at = parse_js_number(raw_exp)?;
    if !expires_at.is_finite() || expires_at <= now_ms() as f64 {
        return None;
    }
    Some(Claims { user_id, expires_at: expires_at as i64, fingerprint: fingerprint.to_string() })
}

/// JS Number() semantics for token fields: "" → 0 (falsy-ish but integer),
/// junk → NaN (None here). Number("5") = 5.
fn parse_js_number(s: &str) -> Option<f64> {
    if s.trim().is_empty() {
        return Some(0.0);
    }
    s.trim().parse::<f64>().ok()
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

/// Cookie header → value of `name`. Values in this app never need
/// percent-encoding (base64url + dots + hex), so a plain split is exact.
pub fn cookie_value(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
    let raw = headers.get("cookie")?.to_str().ok()?;
    raw.split(';').find_map(|pair| {
        let (k, v) = pair.trim().split_once('=')?;
        (k == name).then(|| v.to_string())
    })
}

/// isHttps() port: SEO_COOKIE_SECURE=1 wins, else x-forwarded-proto's
/// first entry === "https".
pub fn is_https(headers: &axum::http::HeaderMap, cfg: &Config) -> bool {
    if cfg.cookie_secure_env {
        return true;
    }
    headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|v| v.trim() == "https")
        .unwrap_or(false)
}

/// req.nextUrl.protocol === "https:" port (logout route uses this alone,
/// WITHOUT the env override — faithful to the source).
fn protocol_https(headers: &axum::http::HeaderMap) -> bool {
    headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|v| v.trim() == "https")
        .unwrap_or(false)
}

/// Attribute order mirrors the `cookie` package (Next's serializer):
/// value; Max-Age; Path; HttpOnly; Secure; SameSite.
fn set_cookie(name: &str, value: &str, max_age: i64, secure: bool) -> String {
    let mut c = format!("{name}={value}; Max-Age={max_age}; Path=/; HttpOnly;");
    if secure {
        c.push_str(" Secure;");
    }
    c.push_str(" SameSite=Lax");
    c
}

pub fn session_cookie(headers: &axum::http::HeaderMap, cfg: &Config, token: &str) -> String {
    set_cookie(
        SESSION_COOKIE,
        token,
        SESSION_TTL_MS / 1000,
        is_https(headers, cfg),
    )
}

/// Password-mode login cookie (stb_auth = sha256(APP_PASSWORD + ".v1")).
/// The login route's `req.nextUrl.protocol === "https:" || isHttps()`
/// union is exactly is_https() here.
pub fn password_login_cookie(headers: &axum::http::HeaderMap, cfg: &Config, token: &str) -> String {
    set_cookie(PASSWORD_COOKIE, token, 60 * 60 * 24 * 30, is_https(headers, cfg))
}

/// Clear-cookie pair for POST /api/auth/logout (secure = protocol only).
pub fn clear_cookies(headers: &axum::http::HeaderMap) -> Vec<String> {
    let secure = protocol_https(headers);
    vec![
        set_cookie(PASSWORD_COOKIE, "", 0, secure),
        set_cookie(SESSION_COOKIE, "", 0, secure),
    ]
}

// ---------------------------------------------------------------------------
// User rows + current_user
// ---------------------------------------------------------------------------

pub struct UserRow {
    pub id: i64,
    pub email: String,
    pub password_hash: String,
    pub name: Option<String>,
    pub role: String,
    pub active: bool,
    pub created_at: Option<i64>,
    pub last_login_at: Option<i64>,
}

impl UserRow {
    pub fn from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: r.get(0)?,
            email: r.get(1)?,
            password_hash: r.get(2)?,
            name: r.get(3)?,
            role: r.get(4)?,
            active: r.get::<_, i64>(5)? != 0,
            created_at: r.get(6)?,
            last_login_at: r.get(7)?,
        })
    }
}

pub const USER_COLS: &str =
    "id, email, password_hash, name, role, active, created_at, last_login_at";

fn load_user(db: &Db, id: i64) -> Option<UserRow> {
    db.with_conn(|c| {
        c.query_row(
            &format!("SELECT {USER_COLS} FROM users WHERE id = ?1 LIMIT 1"),
            [id],
            UserRow::from_row,
        )
    })
    .ok()
}

/// Port of currentUser(): valid signature → user exists → active →
/// fingerprint (password hash + active) unchanged. Each step is a
/// revocation path; any failure → null.
pub fn current_user(
    db: &Db,
    headers: &axum::http::HeaderMap,
    cfg: &Config,
) -> Option<UserRow> {
    if !db.accounts_enabled() {
        return None;
    }
    let token = cookie_value(headers, SESSION_COOKIE)?;
    let secret = &ensure_session_secret(cfg).value;
    let claims = verify_session(Some(&token), secret)?;
    let user = load_user(db, claims.user_id)?;
    if !user.active {
        return None;
    }
    let fp = user_fingerprint(&user.password_hash, user.active);
    if fp != claims.fingerprint {
        return None;
    }
    Some(user)
}

/// Port of issueSession(): sign claims and return the Set-Cookie header.
/// The expiresAt claim travels in epoch-ms, exactly like the Node side.
pub fn issue_session_cookie(
    db: &Db,
    headers: &axum::http::HeaderMap,
    cfg: &Config,
    user: &UserRow,
) -> Option<String> {
    let secret = &ensure_session_secret(cfg).value;
    let fingerprint = user_fingerprint(&user.password_hash, user.active);
    let claims = Claims {
        user_id: user.id,
        expires_at: now_ms() + SESSION_TTL_MS,
        fingerprint,
    };
    let token = sign_session(&claims, secret);
    let _ = db; // kept for signature symmetry with the Next flow
    Some(session_cookie(headers, cfg, &token))
}

/// ISO render helper re-exported so callers don't need util imports for it.
pub fn iso(secs: i64) -> String {
    iso_from_secs(secs)
}
