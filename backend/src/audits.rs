//! Audit issues domain — Task 14.5a. Port of src/app/audits/issue-actions.ts
//! (setIssueStatus, setStatusForType). Plain status updates; the status
//! strings are stored as-is exactly like the action (SQLite has no enum
//! constraint, and the action never validates them either).

use crate::internal::ok_json;
use crate::util::now_secs;
use crate::AppState;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::response::Response;
use rusqlite::params;
use serde_json::{json, Value};

/// `if (!Number.isFinite(x) || x <= 0) return;`
fn id_ok(raw: &str) -> Option<f64> {
    match crate::internal::json_number(Some(&Value::String(raw.to_string()))) {
        Some(n) if n.is_finite() && n > 0.0 => Some(n),
        _ => None,
    }
}

// ---------- POST /api/internal/audits/issues/:id/status ----------

pub async fn issue_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
    bytes: Bytes,
) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    if let Some(issue_id) = id_ok(&id) {
        let status = crate::util::js_string(body.get("status"));
        // auditId is only used by the action for revalidatePath — accepted
        // and ignored here (the Next proxy owns revalidation).
        let _ = state.db.with_conn(|c| {
            c.execute(
                "UPDATE audit_issues SET status = ?2, updated_at = ?3 WHERE id = ?1",
                params![issue_id, status, now_secs()],
            )
        });
    }
    ok_json(json!({}))
}

// ---------- POST /api/internal/audits/:id/issues-type ----------

pub async fn issues_type(
    State(state): State<AppState>,
    Path(id): Path<String>,
    bytes: Bytes,
) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    if let Some(audit_id) = id_ok(&id) {
        let issue_type = crate::util::js_string(body.get("type"));
        let status = crate::util::js_string(body.get("status"));

        let ids: Vec<i64> = state
            .db
            .with_conn(|c| {
                let mut stmt = c.prepare(
                    "SELECT id FROM audit_issues WHERE audit_id = ?1 AND type = ?2",
                )?;
                let it = stmt.query_map(params![audit_id, issue_type], |r| r.get(0))?;
                it.collect::<Result<Vec<_>, _>>()
            })
            .unwrap_or_default();
        if ids.is_empty() {
            return ok_json(json!({ "noop": true }));
        }
        let sql = format!(
            "UPDATE audit_issues SET status = ?{}, updated_at = ?{} WHERE id IN ({})",
            ids.len() + 1,
            ids.len() + 2,
            (1..=ids.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(","),
        );
        let mut p: Vec<Box<dyn rusqlite::ToSql>> =
            ids.iter().map(|i| Box::new(*i) as Box<dyn rusqlite::ToSql>).collect();
        p.push(Box::new(status));
        p.push(Box::new(now_secs()));
        let refs: Vec<&dyn rusqlite::ToSql> = p.iter().map(|b| b.as_ref()).collect();
        let _ = state.db.with_conn(|c| c.execute(&sql, refs.as_slice()));
    }
    ok_json(json!({}))
}
