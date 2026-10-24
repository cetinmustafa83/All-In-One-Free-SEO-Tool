//! Internal action API — Task 14.5a.
//!
//! The Next server actions in the ported domains (tasks, notifications,
//! keywords, backlinks, audit issues) keep their exported signatures but
//! forward their DB effects to THIS service over `/api/internal/*`. The
//! channel is protected by a shared secret token:
//!
//!   1. `SEO_INTERNAL_TOKEN` env var (trimmed, non-empty) wins;
//!   2. else the file `<data dir>/.seo-internal-token` — the SAME
//!      resolution `session.rs` uses for the session secret
//!      (config.data_dir()), so both processes read one file;
//!   3. else generate 32 random bytes as hex, persist 0600, and use it —
//!      the first process to boot writes it, the other reads it.
//!
//! Denials use the admin-guard error envelope (error.rs family 2:
//! `{"ok":false,"error":"..."}`) — internal endpoints guard actions, so
//! they sit in the admin family, not the v1 `{"error"}` family.
//!
//! This module also hosts the port of `src/lib/activity.ts` logActivity()
//! (SELECT-then-INSERT dedupe inside a 24h window) because every domain
//! module here needs it — the Next actions called it through the same
//! shared helper.

use crate::config::Config;
use crate::db::Db;
use crate::error;
use crate::util::now_ms;
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::Value;
use rusqlite::OptionalExtension;
use std::sync::OnceLock;

// ---------------------------------------------------------------------------
// Token (file resolution mirrors session.rs / session-secret.ts)
// ---------------------------------------------------------------------------

pub struct TokenInfo {
    pub value: String,
    /// "env" | "file" | "generated" | "ephemeral" — parity with the
    /// session-secret source report; kept for diagnostics.
    #[allow(dead_code)]
    pub source: &'static str,
}

static TOKEN: OnceLock<TokenInfo> = OnceLock::new();

pub fn ensure_internal_token(cfg: &Config) -> &TokenInfo {
    TOKEN.get_or_init(|| resolve_token(cfg))
}

fn resolve_token(cfg: &Config) -> TokenInfo {
    if let Ok(from_env) = std::env::var("SEO_INTERNAL_TOKEN") {
        let t = from_env.trim().to_string();
        if !t.is_empty() {
            return TokenInfo { value: t, source: "env" };
        }
    }
    let file = cfg.data_dir().join(".seo-internal-token");
    if let Ok(stored) = std::fs::read_to_string(&file) {
        let t = stored.trim().to_string();
        if !t.is_empty() {
            return TokenInfo { value: t, source: "file" };
        }
    }
    // Generate once and persist (mode 0600, same as the session secret).
    let mut buf = [0u8; 32];
    rand::Rng::fill(&mut rand::thread_rng(), &mut buf);
    let generated: String = buf.iter().map(|b| format!("{b:02x}")).collect();
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
        Ok(()) => TokenInfo { value: generated, source: "generated" },
        Err(_) => {
            // Read-only volume — fall back to an ephemeral token for this
            // process lifetime (never matches the Next side, but fails
            // closed rather than open).
            let mut buf2 = [0u8; 32];
            rand::Rng::fill(&mut rand::thread_rng(), &mut buf2);
            TokenInfo { value: buf2.iter().map(|b| format!("{b:02x}")).collect(), source: "ephemeral" }
        }
    }
}

pub const MSG_TOKEN_REQUIRED: &str = "Internal token required.";

/// Middleware for every /api/internal/* route: constant-time compare of the
/// `X-Internal-Token` header against the resolved secret. All valid tokens
/// are 64 hex chars, so the length early-out leaks nothing useful.
pub async fn require_token(
    State(state): State<crate::AppState>,
    req: Request,
    next: Next,
) -> Response {
    let provided = req
        .headers()
        .get("x-internal-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim()
        .to_string();
    let expected = &ensure_internal_token(&state.cfg).value;
    if provided.is_empty() || provided.len() != expected.len() {
        return token_denied();
    }
    if !crate::auth::ct_eq(provided.as_bytes(), expected.as_bytes()) {
        return token_denied();
    }
    next.run(req).await
}

fn token_denied() -> Response {
    error::admin_error(StatusCode::UNAUTHORIZED, MSG_TOKEN_REQUIRED)
}

/// 400-style failure for direct API callers; the same admin envelope.
#[allow(dead_code)]
pub fn bad_request(message: &str) -> Response {
    error::admin_error(StatusCode::BAD_REQUEST, message)
}

// ---------------------------------------------------------------------------
// logActivity port (src/lib/activity.ts) — shared by tasks + backlinks
// ---------------------------------------------------------------------------

pub struct Activity<'a> {
    pub kind: &'a str,
    pub message: &'a str,
    pub level: &'a str,
    pub client_id: Option<i64>,
    pub entity_type: Option<&'a str>,
    pub entity_id: Option<i64>,
    /// Resolved by the Next side (currentUserId()) and passed through —
    /// the Rust process has no request cookie on this channel.
    pub user_id: Option<i64>,
    /// activity.ts default: dedupe on (kind, message) inside 24h.
    pub dedupe: bool,
    pub dedupe_window_minutes: i64,
}

/// Never lets activity logging break the main flow (the Node side wraps in
/// try/catch; here every step already returns Result and is ignored).
pub fn log_activity(db: &Db, opts: &Activity<'_>) {
    if opts.dedupe {
        let cutoff = (now_ms() - opts.dedupe_window_minutes * 60 * 1000) / 1000;
        let existing: Option<i64> = db
            .with_conn(|c| {
                c.query_row(
                    "SELECT id FROM activity_log \
                     WHERE kind = ?1 AND message = ?2 AND created_at > ?3 \
                     ORDER BY created_at DESC LIMIT 1",
                    rusqlite::params![opts.kind, opts.message, cutoff],
                    |r| r.get(0),
                )
                .optional()
            })
            .ok()
            .flatten();
        if existing.is_some() {
            return;
        }
    }
    let _ = db.with_conn(|c| {
        c.execute(
            "INSERT INTO activity_log (kind, message, level, client_id, entity_type, entity_id, user_id) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                opts.kind,
                opts.message,
                opts.level,
                opts.client_id,
                opts.entity_type,
                opts.entity_id,
                opts.user_id,
            ],
        )
    });
}

// ---------------------------------------------------------------------------
// Shared value coercion for JSON bodies (JS Number / String semantics)
// ---------------------------------------------------------------------------

/// JS Number(x) over a JSON value: null → 0, bool → 0/1, number → itself,
/// string → JS parse ("" → 0, junk → NaN = None here), object/array → NaN.
pub fn json_number(v: Option<&Value>) -> Option<f64> {
    match v {
        None => None, // JSON undefined — only NaN maps to None
        Some(Value::Null) => Some(0.0),
        Some(Value::Bool(b)) => Some(if *b { 1.0 } else { 0.0 }),
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) => {
            if s.trim().is_empty() {
                return Some(0.0);
            }
            // JS hex/octal/Infinity literal support is out of scope for
            // form-derived values; plain decimal only.
            s.trim().parse::<f64>().ok()
        }
        Some(_) => None,
    }
}

/// JS Math.round: half rounds UP (towards +∞), unlike f64::round.
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// Uniform ok envelope for the void-returning actions.
pub fn ok_json(extra: Value) -> Response {
    let mut map = serde_json::Map::new();
    map.insert("ok".into(), Value::Bool(true));
    if let Value::Object(m) = extra {
        for (k, v) in m {
            map.insert(k, v);
        }
    }
    (StatusCode::OK, Json(Value::Object(map))).into_response()
}

pub fn result_json(v: Value) -> Response {
    (StatusCode::OK, Json(v)).into_response()
}

/// DB-level failure on an internal endpoint: 500 + admin-family envelope so
/// the Next proxy surfaces it (throws) instead of silently dropping the
/// write. Found in 14.5a smoke: an FK violation on completed_by_user_id was
/// being swallowed by `let _ =` and the action reported ok while writing
/// nothing — silent data loss. Never swallow primary-effect DB errors.
pub fn db_error_response(msg: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "ok": false, "error": msg })),
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// WHATWG-ish URL helpers (no url crate — pragmatic subset, see worklog)
// ---------------------------------------------------------------------------

fn is_forbidden_host_char(c: char) -> bool {
    matches!(
        c,
        '\0' | '\t' | '\n' | '\r' | ' ' | '#' | '/' | ':' | '<' | '>' | '?' | '@' | '[' | '\\' | ']' | '^' | '|'
    )
}

/// Split "scheme://authority/path..." → (scheme_lowercase, authority).
fn split_scheme(raw: &str) -> Option<(String, &str)> {
    let idx = raw.find("://")?;
    let scheme = &raw[..idx];
    let mut chars = scheme.chars();
    let first = chars.next()?;
    if !first.is_ascii_alphabetic() {
        return None;
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.')) {
        return None;
    }
    Some((scheme.to_ascii_lowercase(), &raw[idx + 3..]))
}

/// Authority → host (strip userinfo + port) or None when malformed.
/// Mirrors the parts of WHATWG host parsing this codebase relies on:
/// IPv6 kept in brackets, ports must be numeric, forbidden chars rejected,
/// ASCII-lowercase.
fn authority_host(authority: &str) -> Option<String> {
    // userinfo ends at the LAST '@' (WHATWG ignores further '@' in host)
    let host_port = match authority.rfind('@') {
        Some(i) => &authority[i + 1..],
        None => authority,
    };
    let host = if host_port.starts_with('[') {
        let end = host_port.find(']')? + 1;
        let h = &host_port[..end];
        // anything after ']' must be empty or ":port"
        let rest = &host_port[end..];
        if !rest.is_empty() && !rest.starts_with(':') {
            return None;
        }
        if !rest.is_empty() && !rest[1..].is_empty() && !rest[1..].chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        h.to_string()
    } else {
        match host_port.split_once(':') {
            Some((h, port)) => {
                if !port.is_empty() && !port.chars().all(|c| c.is_ascii_digit()) {
                    return None;
                }
                h.to_string()
            }
            None => host_port.to_string(),
        }
    };
    if host.is_empty() || host.starts_with('[') {
        return Some(host); // empty → caller decides; bracketed kept verbatim
    }
    if host.chars().any(is_forbidden_host_char) {
        return None;
    }
    Some(host.to_ascii_lowercase())
}

/// zod v4 z.string().url() ≈ `new URL(x)` — scheme://host must parse.
/// The actions only ever reach here with http/https after the prepend
/// transform, which is the subset this validator covers exactly.
pub fn is_url(raw: &str) -> bool {
    let Some((scheme, rest)) = split_scheme(raw) else {
        return false;
    };
    // WHATWG special schemes need a host; non-special (mailto:) allow opaque
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    match scheme.as_str() {
        "http" | "https" | "ws" | "wss" | "ftp" | "file" => authority_host(authority)
            .map(|h| !h.is_empty())
            .unwrap_or(false),
        _ => !authority.is_empty() || !rest.is_empty(),
    }
}

/// new URL(x).hostname — lowercase, userinfo/port stripped, IPv6 bracketed.
pub fn url_hostname(raw: &str) -> Option<String> {
    let (_, rest) = split_scheme(raw)?;
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    authority_host(&rest[..authority_end]).filter(|h| !h.is_empty())
}
