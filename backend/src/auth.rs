//! Auth middleware — Task 14.2. Faithful port of the Next.js guards:
//!
//! - `is_cross_site`   ← isCrossSiteRequest (src/lib/admin-auth.ts)
//! - `is_local_request` ← isLocalRequest       (src/lib/admin-auth.ts)
//! - `guard_admin`      ← guardAdminRequest three modes (accounts / password / open)
//! - bearer parsing + scope + limit helpers ← src/lib/api-auth.ts
//!
//! Contract (R4): status codes AND message strings must match byte-for-byte
//! — the parity probes and manual curl diffs enforce this.

use crate::config::Config;
use crate::db::Db;
use crate::error;
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use sha2::{Digest, Sha256};

const LOCAL_HOSTS: [&str; 5] = ["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"];

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

fn is_local_ip(ip: &str) -> bool {
    let trimmed = ip.strip_prefix("::ffff:").unwrap_or(ip).trim();
    matches!(trimmed, "127.0.0.1" | "::1" | "localhost")
}

/// Port of isCrossSiteRequest. `Sec-Fetch-Site` is browser-set and cannot
/// be spoofed by page JS; older browsers fall back to Origin-vs-Host.
pub fn is_cross_site(headers: &HeaderMap) -> bool {
    if let Some(site) = header(headers, "sec-fetch-site") {
        if site != "same-origin" && site != "none" {
            return true;
        }
    }
    if let Some(origin) = header(headers, "origin") {
        if !origin.is_empty() {
            let host = header(headers, "host").unwrap_or("");
            let ok = origin_host(origin).map(|h| h.eq_ignore_ascii_case(host)).unwrap_or(false);
            if !ok || host.is_empty() {
                return true;
            }
        }
    }
    false
}

/// Extract `host[:port]` from an Origin URL (mirrors `new URL(origin).host`).
fn origin_host(origin: &str) -> Option<&str> {
    let rest = origin
        .strip_prefix("https://")
        .or_else(|| origin.strip_prefix("http://"))?;
    let end = rest.find(['/']).unwrap_or(rest.len());
    Some(&rest[..end])
}

/// Port of isLocalRequest: forwarding headers only when TRUSTED_PROXY=1,
/// else Host header, else (no Host at all) treat as same-machine socket.
pub fn is_local_request(headers: &HeaderMap, trusted_proxy: bool) -> bool {
    if trusted_proxy {
        if let Some(fwd) = header(headers, "x-forwarded-for") {
            let first = fwd.split(',').next().unwrap_or("").trim();
            if !first.is_empty() {
                return is_local_ip(first);
            }
        }
        if let Some(real) = header(headers, "x-real-ip") {
            let real = real.trim();
            if !real.is_empty() {
                return is_local_ip(real);
            }
        }
    }
    let host = header(headers, "host").unwrap_or("");
    let hostname = if host.starts_with('[') {
        &host[..host.find(']').map(|i| i + 1).unwrap_or(host.len())]
    } else {
        host.split(':').next().unwrap_or("")
    };
    if LOCAL_HOSTS.iter().any(|h| h.eq_ignore_ascii_case(hostname)) {
        return true;
    }
    if !host.is_empty() {
        return false;
    }
    // Node falls back to the request URL hostname, which reads as the bound
    // host (localhost) for direct socket callers. No Host header ⇒ same
    // machine as far as this check can tell.
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdminMode {
    /// users table has rows → session cookie validated by the Next proxy.
    Accounts,
    /// APP_PASSWORD set → proxy validated the shared-password cookie.
    Password,
    /// No auth configured → same-machine callers only.
    Open,
}

pub fn admin_mode(db: &Db, cfg: &Config) -> AdminMode {
    if db.accounts_enabled() {
        AdminMode::Accounts
    } else if cfg.app_password_set {
        AdminMode::Password
    } else {
        AdminMode::Open
    }
}

/// Port of guardAdminRequest. Cross-site check FIRST in every mode (a
/// cookie rides along on cross-site POSTs — login does not stop CSRF).
///
/// Accounts-mode note: the proxy's cookie validation already ran upstream
/// (middleware runs before rewrites during cutover), so the guard passes;
/// the in-route owner re-check stays Next-side until sessions are ported.
/// Fail-closed here would lock owners out of admin actions entirely.
pub fn guard_admin(headers: &HeaderMap, db: &Db, cfg: &Config) -> Result<AdminMode, Response> {
    if is_cross_site(headers) {
        return Err(error::admin_error(StatusCode::FORBIDDEN, error::MSG_CROSS_SITE));
    }
    match admin_mode(db, cfg) {
        AdminMode::Accounts | AdminMode::Password => Ok(admin_mode(db, cfg)),
        AdminMode::Open => {
            if is_local_request(headers, cfg.trusted_proxy) {
                Ok(AdminMode::Open)
            } else {
                Err(error::admin_error(StatusCode::FORBIDDEN, error::MSG_LOCAL_ONLY))
            }
        }
    }
}

// ---- Bearer API keys (src/lib/api-auth.ts) ----

pub const KEY_PREFIX: &str = "seo_live_";

/// `Authorization: Bearer <token>` — scheme case-insensitive (`/^Bearer\s+(.+)$/i`).
pub fn bearer_token(headers: &HeaderMap) -> Option<String> {
    let h = header(headers, "authorization")?;
    let (scheme, rest) = h.split_once(char::is_whitespace)?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }
    let raw = rest.trim();
    if raw.is_empty() {
        return None;
    }
    Some(raw.to_string())
}

pub fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let out = hasher.finalize();
    out.iter().map(|b| format!("{b:02x}")).collect()
}

/// Port of requireScope: `admin` implies everything; `read` is implied by `write`.
pub fn scope_allows(scopes: &[String], need: &str) -> bool {
    if scopes.iter().any(|s| s == "admin") {
        return true;
    }
    match need {
        "read" => scopes.iter().any(|s| s == "read" || s == "write"),
        "write" => scopes.iter().any(|s| s == "write"),
        _ => false,
    }
}

/// Port of parseLimit: `?limit=` as a positive integer ≤ max.
/// null/""/non-finite → fallback.
pub fn parse_limit(raw: Option<&str>, fallback: i64, max: i64) -> i64 {
    let Some(raw) = raw else { return fallback };
    if raw.is_empty() {
        return fallback;
    }
    match raw.trim().parse::<f64>() {
        Ok(n) if n.is_finite() => (n.floor() as i64).clamp(1, max),
        _ => fallback,
    }
}

/// Port of timingSafeEqual (edge-token.ts): equal-length, xor-fold compare.
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
