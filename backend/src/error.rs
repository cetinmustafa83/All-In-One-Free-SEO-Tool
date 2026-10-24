//! Error envelope parity — Task 14.2 (contract R4).
//!
//! The Next.js API uses TWO envelope shapes; the Rust port must use the
//! same one per endpoint family or the frontend/edge callers break:
//!
//! 1. `{"error": "..."}`           — v1 public API (src/lib/api-auth.ts jsonError)
//!                                    and edge/fixes contract responses
//! 2. `{"ok": false, "error": "..."}` — admin guard denials (src/lib/admin-auth.ts)
//!
//! Message strings are byte-for-byte copies of the Next sources.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

// ---- admin guard messages (src/lib/admin-auth.ts) ----
pub const MSG_CROSS_SITE: &str =
    "Cross-site request blocked. Admin actions can only be triggered from the app itself.";
pub const MSG_LOCAL_ONLY: &str =
    "This action is restricted to local-machine requests. Set APP_PASSWORD to enable authenticated remote access, or bind the server to 0.0.0.0 only on a trusted LAN.";
pub const MSG_SIGN_IN: &str = "Sign in first.";
pub const MSG_OWNER_ONLY: &str = "Only the workspace owner can do this.";

// ---- v1 / edge messages (api-auth.ts jsonError + edge/fixes route) ----
pub const MSG_BEARER_REQUIRED: &str = "Unauthorized — Bearer token required.";
pub const MSG_READ_SCOPE: &str = "Read scope required.";
pub const MSG_CLIENT_REQUIRED: &str = "client required";
pub const MSG_UNAUTHORIZED: &str = "unauthorized";

/// `{"error": "..."}` — v1 + edge family.
pub fn api_error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

/// `{"ok": false, "error": "..."}` — admin guard family.
pub fn admin_error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "ok": false, "error": message }))).into_response()
}
