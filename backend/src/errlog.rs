//! Error sink — Task 14.4. Port of src/lib/error-log.ts (logError) and the
//! two handlers POST /api/errors (browser error trap target) and
//! GET /api/errors/by-digest (digest → message lookup).
//!
//! logError never throws — a failing error logger must not create a
//! logging loop, so every DB operation below is best-effort.

use crate::db::Db;
use crate::util::{js_slice, js_string};
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

const MAX_ROWS: i64 = 1000;

/// Port of logError({source, context, error, url, userAgent}) for the
/// client-error path. `message`/`stack` are pre-extracted by the caller
/// (extract(): message = error.message.slice(0,500) || name || "Unknown
/// error"; stack = error.stack?.slice(0,4000) ?? null).
pub fn log_client_error(
    db: &Db,
    source: &str,
    context: &str,
    message: &str,
    stack: Option<&str>,
    url: Option<&str>,
    user_agent: Option<&str>,
) {
    let context = js_slice(context, 200);
    let message = js_slice(message, 500);

    // Dedupe on (source, context, message).
    let existing: Option<(i64, i64)> = db
        .with_conn(|c| {
            use rusqlite::OptionalExtension;
            c.query_row(
                "SELECT id, occurrences FROM system_errors \
                 WHERE source = ?1 AND context = ?2 AND message = ?3 LIMIT 1",
                rusqlite::params![source, context, message],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
            )
            .optional()
        })
        .ok()
        .flatten();

    if let Some((id, occurrences)) = existing {
        // Update on recurrence: bump count, refresh last-seen, un-resolve.
        // A truthy new stack OVERWRITES (drizzle spread semantics), absent
        // stack keeps the old one.
        let _ = db.with_conn(|c| {
            c.execute(
                "UPDATE system_errors SET occurrences = ?1, last_seen_at = unixepoch(), \
                 resolved = 0, stack = COALESCE(?2, stack) WHERE id = ?3",
                rusqlite::params![occurrences + 1, stack, id],
            )
        });
    } else {
        let _ = db.with_conn(|c| {
            c.execute(
                "INSERT INTO system_errors (source, context, message, stack, url, user_agent, occurrences) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
                rusqlite::params![source, context, message, stack, url, user_agent],
            )
        });
        // Trim oldest beyond MAX_ROWS — one delete with a subquery.
        if let Ok(total) = db.with_conn(|c| {
            c.query_row("SELECT count(*) FROM system_errors", [], |r| r.get::<_, i64>(0))
        }) {
            if total > MAX_ROWS {
                let to_delete = total - MAX_ROWS;
                let _ = db.with_conn(|c| {
                    c.execute(
                        "DELETE FROM system_errors WHERE id IN (\
                           SELECT id FROM system_errors ORDER BY last_seen_at ASC LIMIT ?1\
                         )",
                        rusqlite::params![to_delete],
                    )
                });
            }
        }
    }
}

fn ok_json(v: Value) -> Response {
    Json(v).into_response()
}

/// POST /api/errors — the browser's global error trap posts here.
pub async fn errors_post(State(state): State<crate::AppState>, body: Bytes) -> Response {
    // req.json().catch(() => null): empty/invalid → null → "bad json".
    let parsed: Option<Value> = serde_json::from_slice(&body).ok();
    let Some(v) = parsed else {
        return bad_json_response();
    };
    // if (!body?.message) — falsy (absent, null, "") → "no message".
    let message_raw = v.get("message");
    let has_message = match message_raw {
        None | Some(Value::Null) => false,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Some(Value::Bool(b)) => *b,
        Some(_) => true,
    };
    if !has_message {
        return (StatusCode::BAD_REQUEST, Json(json!({ "ok": false, "error": "no message" })))
            .into_response();
    }
    let message = js_string(message_raw);

    // context = [context?.slice(0,160) ?? "browser",
    //            digest ? `digest ${String(digest).slice(0,40)}` : null]
    //           .filter(Boolean).join(" · ")
    let ctx_field = v.get("context");
    let ctx_present = matches!(ctx_field, Some(Value::String(s)) if !s.is_empty());
    let ctx_part = if ctx_present {
        js_slice(&js_string(ctx_field), 160)
    } else {
        "browser".to_string()
    };
    let digest = v.get("digest").filter(|d| !d.is_null());
    let digest_part = digest.map(|d| format!("digest {}", js_slice(&js_string(Some(d)), 40)));
    let context = match digest_part {
        Some(d) if !ctx_part.is_empty() => format!("{ctx_part} · {d}"),
        Some(d) => d,
        None => ctx_part,
    };

    // Synthetic Error(message) with optional stack override. When the body
    // has no stack, Node stores V8's auto stack; we store a minimal
    // equivalent — DB content only, not part of the HTTP contract.
    let stack: Option<String> = match v.get("stack") {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        _ => Some(format!("Error: {message}\n    at <anonymous>")),
    };

    log_client_error(
        &state.db,
        "client",
        &context,
        &message,
        stack.as_deref(),
        v.get("url")
            .filter(|u| !u.is_null())
            .map(|u| js_string(Some(u)))
            .as_deref(),
        v.get("userAgent")
            .filter(|u| !u.is_null())
            .map(|u| js_string(Some(u)))
            .as_deref(),
    );
    ok_json(json!({ "ok": true }))
}

/// GET /api/errors/by-digest?digest=N — turn Next's production error
/// digest into the server-side message it stands for.
pub async fn errors_by_digest(State(state): State<crate::AppState>, uri: Uri) -> Response {
    // searchParams.get("digest")?.trim() ?? ""
    let digest = crate::util::qparam(uri.query(), "digest").unwrap_or("").trim();

    // Next digests are numeric strings, 4–32 digits.
    let valid = (4..=32).contains(&digest.len()) && digest.bytes().all(|b| b.is_ascii_digit());
    if !valid {
        return (StatusCode::BAD_REQUEST, Json(json!({ "ok": false, "error": "bad digest" })))
            .into_response();
    }

    let row = state.db.with_conn(|c| {
        use rusqlite::OptionalExtension;
        c.query_row(
            "SELECT message, stack, context, occurrences FROM system_errors \
             WHERE source = 'server' AND context LIKE ?1 \
             ORDER BY last_seen_at DESC LIMIT 1",
            [format!("%digest {digest}%")],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()
    });

    match row {
        Ok(Some((message, stack, context, occurrences))) => {
            // Enough to locate the fault: first 12 stack lines.
            let stack_json = stack.map(|s| {
                let lines: Vec<&str> = s.split('\n').take(12).collect();
                lines.join("\n")
            });
            ok_json(json!({
                "ok": true,
                "found": true,
                "message": message,
                "stack": stack_json,
                "context": context,
                "occurrences": occurrences,
            }))
        }
        // Not found is not an error condition — and neither is a failing
        // query: same graceful answer either way.
        _ => ok_json(json!({ "ok": true, "found": false })),
    }
}

/// The 400 body shared by both failure shapes in POST /api/errors.
fn bad_json_response() -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "ok": false, "error": "bad json" }))).into_response()
}
