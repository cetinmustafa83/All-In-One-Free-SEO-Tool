//! Notifications domain — Task 14.5a. Port of src/app/notifications/actions.ts
//! recentNotifications(): the ENTIRE aggregate — audit completes/fails,
//! per-client score-drop detection computed in code, monitored-page changes
//! and the update-available/applied pair from activity_log — with the same
//! ordering, limits and string shaping. `at` leaves this service as an ISO
//! string; the Next proxy converts it back to a Date.

use crate::internal::result_json;
use crate::util::{iso_from_secs, now_secs};
use crate::AppState;
use axum::extract::State;
use axum::response::Response;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Map, Value};

struct AuditRow {
    id: i64,
    score: Option<i64>,
    issues_count: i64,
    status: String,
    completed_at: Option<i64>,
    created_at: i64,
    client_id: i64,
    client_name: Option<String>,
}

struct ChangeRow {
    id: i64,
    field: String,
    old_value: Option<String>,
    new_value: Option<String>,
    detected_at: i64,
    page_url: Option<String>,
    page_label: Option<String>,
    client_name: Option<String>,
}

/// Notification builder with the exact key order of the TS object literal.
fn notification(
    id: String,
    kind: &str,
    level: &str,
    title: String,
    body: String,
    href: &str,
    at_secs: i64,
) -> Value {
    let mut m = Map::new();
    m.insert("id".into(), Value::String(id));
    m.insert("kind".into(), json!(kind));
    m.insert("level".into(), json!(level));
    m.insert("title".into(), Value::String(title));
    m.insert("body".into(), Value::String(body));
    m.insert("href".into(), json!(href));
    m.insert("at".into(), Value::String(iso_from_secs(at_secs)));
    Value::Object(m)
}

/// JS String.prototype.slice(0, 60) — char-wise approximation (see util.rs).
fn slice60(s: &str) -> String {
    s.chars().take(60).collect()
}

/// pageUrl?.replace(/^https?:\/\//, "")
fn strip_http(u: &str) -> String {
    u.strip_prefix("https://")
        .or_else(|| u.strip_prefix("http://"))
        .unwrap_or(u)
        .to_string()
}

pub async fn recent(State(state): State<AppState>) -> Response {
    // (at_secs, notification) — at kept beside the row so the final sort is
    // the same numeric getTime() compare the JS does (stable, newest first).
    let mut out: Vec<(i64, Value)> = Vec::new();

    // Audits — last 8 across clients
    let audits: Vec<AuditRow> = state
        .db
        .with_conn(|c| {
            let mut stmt = c.prepare(
                "SELECT a.id, a.score, a.issues_count, a.status, a.completed_at, a.created_at, \
                 a.client_id, cl.name \
                 FROM audits a LEFT JOIN clients cl ON a.client_id = cl.id \
                 ORDER BY a.created_at DESC LIMIT 8",
            )?;
            let it = stmt.query_map([], |r| {
                Ok(AuditRow {
                    id: r.get(0)?,
                    score: r.get(1)?,
                    issues_count: r.get(2)?,
                    status: r.get(3)?,
                    completed_at: r.get(4)?,
                    created_at: r.get(5)?,
                    client_id: r.get(6)?,
                    client_name: r.get(7)?,
                })
            })?;
            it.collect::<Result<Vec<_>, _>>()
        })
        .unwrap_or_default();

    // Compute per-client "previous completed" to detect drops — walks
    // oldest-first (the JS code reverses the freshly-queried list).
    let mut prev_by_client: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    for a in audits.iter().rev() {
        if a.status != "completed" {
            continue;
        }
        let Some(score) = a.score else { continue };
        if let Some(prev) = prev_by_client.get(&a.client_id) {
            if score - prev <= -5 {
                let name = a.client_name.clone().unwrap_or_else(|| "Client".into());
                let at = a.completed_at.unwrap_or(a.created_at);
                out.push((
                    at,
                    notification(
                        format!("score:{}", a.id),
                        "score_drop",
                        "warning",
                        format!("Score dropped — {name}"),
                        format!("Health score went from {prev} → {score} ({}).", prev - score),
                        &format!("/audits/{}", a.id),
                        at,
                    ),
                ));
            }
        }
        prev_by_client.insert(a.client_id, score);
    }

    for a in &audits {
        let name = a.client_name.clone().unwrap_or_else(|| "Client".into());
        let at = a.completed_at.unwrap_or(a.created_at);
        if a.status == "failed" {
            out.push((
                at,
                notification(
                    format!("audit:{}", a.id),
                    "audit_failed",
                    "error",
                    format!("Audit failed — {name}"),
                    "Site may be unreachable. Try running again.".into(),
                    &format!("/audits/{}", a.id),
                    at,
                ),
            ));
        } else if a.status == "completed" {
            let score = a.score.map(|s| s.to_string()).unwrap_or_else(|| "—".into());
            out.push((
                at,
                notification(
                    format!("audit:{}", a.id),
                    "audit_complete",
                    "success",
                    format!("Audit complete — {name}"),
                    format!("Score {score} · {} issues found.", a.issues_count),
                    &format!("/audits/{}", a.id),
                    at,
                ),
            ));
        }
    }

    // Page changes — last 10 (skip pure content-hash diffs to reduce noise)
    let changes: Vec<ChangeRow> = state
        .db
        .with_conn(|c| {
            let mut stmt = c.prepare(
                "SELECT pc.id, pc.field, pc.old_value, pc.new_value, pc.detected_at, \
                 mp.url, mp.label, cl.name \
                 FROM page_changes pc \
                 LEFT JOIN monitored_pages mp ON pc.monitored_page_id = mp.id \
                 LEFT JOIN clients cl ON mp.client_id = cl.id \
                 ORDER BY pc.detected_at DESC LIMIT 10",
            )?;
            let it = stmt.query_map([], |r| {
                Ok(ChangeRow {
                    id: r.get(0)?,
                    field: r.get(1)?,
                    old_value: r.get(2)?,
                    new_value: r.get(3)?,
                    detected_at: r.get(4)?,
                    page_url: r.get(5)?,
                    page_label: r.get(6)?,
                    client_name: r.get(7)?,
                })
            })?;
            it.collect::<Result<Vec<_>, _>>()
        })
        .unwrap_or_default();

    for ch in &changes {
        if ch.field == "content" {
            continue;
        }
        let name = ch.client_name.clone().unwrap_or_else(|| "Client".into());
        let label = ch
            .page_label
            .clone()
            .or_else(|| ch.page_url.as_ref().map(|u| strip_http(u)))
            .unwrap_or_default();
        let old = slice60(ch.old_value.as_deref().unwrap_or("—"));
        let new = slice60(ch.new_value.as_deref().unwrap_or("—"));
        out.push((
            ch.detected_at,
            notification(
                format!("change:{}", ch.id),
                "page_change",
                "warning",
                format!("{} changed — {}", ch.field, name),
                format!("{label} · \"{old}\" → \"{new}\""),
                "/monitor",
                ch.detected_at,
            ),
        ));
    }

    // System events from activity log — the SINGLE most-recent
    // "update available" but ONLY when newer than the most-recent
    // "updated"; the SINGLE most-recent "updated" when it happened
    // within the last 24h.
    let last_avail: Option<(i64, String, i64)> = state
        .db
        .with_conn(|c| {
            c.query_row(
                "SELECT id, message, created_at FROM activity_log \
                 WHERE kind = 'system.update_available' ORDER BY created_at DESC LIMIT 1",
                params![],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
        })
        .ok()
        .flatten();
    let last_updated: Option<(i64, String, String, i64)> = state
        .db
        .with_conn(|c| {
            c.query_row(
                "SELECT id, message, level, created_at FROM activity_log \
                 WHERE kind = 'system.updated' ORDER BY created_at DESC LIMIT 1",
                params![],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()
        })
        .ok()
        .flatten();

    // Hide "update available" if the user already applied something newer.
    if let Some((id, message, at)) = &last_avail {
        let newer = match &last_updated {
            None => true,
            Some((_, _, _, upd_at)) => at > upd_at,
        };
        if newer {
            out.push((
                *at,
                notification(
                    format!("sys:avail:{id}"),
                    "update_available",
                    "info",
                    "Update available".into(),
                    message.clone(),
                    "/settings#update",
                    *at,
                ),
            ));
        }
    }

    // Show "App updated" only when it's recent (last 24h).
    if let Some((id, message, level, at)) = &last_updated {
        if now_secs() - *at < 24 * 60 * 60 {
            out.push((
                *at,
                notification(
                    format!("sys:upd:{id}"),
                    "update_applied",
                    level, // column is NOT NULL; the JS `?? "success"` only
                    // guarded a legacy null that cannot occur.
                    "App updated".into(),
                    message.clone(),
                    "/settings#update",
                    *at,
                ),
            ));
        }
    }

    // Sort newest first, cap to 15 (Rust sort_by is stable, like JS)
    out.sort_by(|a, b| b.0.cmp(&a.0));
    let list: Vec<Value> = out.into_iter().take(15).map(|(_, v)| v).collect();

    result_json(json!({ "notifications": list }))
}
