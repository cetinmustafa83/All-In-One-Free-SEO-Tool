//! In-memory rate limiter — Task 14.4. Port of src/lib/rate-limit.ts.
//!
//! Same semantics: one fixed window per key, only failures count for the
//! login limits, and without TRUSTED_PROXY=1 every caller shares one key
//! (Next does not expose the socket address; Rust could, but the shared
//! key is what the limits are tuned for — keep behavior identical).

use axum::http::HeaderMap;
use std::collections::HashMap;
use std::sync::Mutex;

use crate::util::now_ms;

#[derive(Clone, Copy, Debug)]
pub struct Bucket {
    pub count: i64,
    pub reset_at: i64,
}

#[derive(Default)]
pub struct Limiter {
    buckets: Mutex<HashMap<String, Bucket>>,
}

impl Limiter {
    /// Port of checkRateLimit: create-or-increment. True = allowed.
    pub fn check(&self, key: &str, max: i64, window_ms: i64) -> bool {
        let mut map = self.buckets.lock().expect("rate-limit mutex poisoned");
        let now = now_ms();
        match map.get_mut(key) {
            Some(b) if now < b.reset_at => {
                if b.count >= max {
                    return false;
                }
                b.count += 1;
                true
            }
            _ => {
                // Expired or missing: fresh window. Opportunistic cleanup so
                // the map stays bounded (same 1000-entry heuristic).
                if map.len() > 1000 {
                    map.retain(|_, b| now < b.reset_at);
                }
                map.insert(key.to_string(), Bucket { count: 1, reset_at: now + window_ms });
                true
            }
        }
    }

    /// Port of isRateLimited: read without counting.
    pub fn is_limited(&self, key: &str, max: i64) -> (bool, i64) {
        let map = self.buckets.lock().expect("rate-limit mutex poisoned");
        match map.get(key) {
            Some(b) if now_ms() < b.reset_at => (b.count >= max, b.reset_at),
            _ => (false, 0),
        }
    }
}

/// Port of trustedClientIp: forwarding headers only when TRUSTED_PROXY=1,
/// and the LAST x-forwarded-for entry — the one a proxy you control
/// appended, not the one the client invented.
fn trusted_client_ip(headers: &HeaderMap, trusted_proxy: bool) -> Option<String> {
    if !trusted_proxy {
        return None;
    }
    if let Some(fwd) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        let parts: Vec<&str> = fwd
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        if !parts.is_empty() {
            return Some(parts[parts.len() - 1].to_string());
        }
    }
    headers
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
}

/// Port of clientKey: trusted client IP, else one shared key.
pub fn client_key(headers: &HeaderMap, trusted_proxy: bool) -> String {
    trusted_client_ip(headers, trusted_proxy).unwrap_or_else(|| "shared".into())
}
