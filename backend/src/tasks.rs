//! Tasks domain — Task 14.5a. Port of src/app/tasks/actions.ts
//! (setTaskStatus, deleteTask, createTask, logTaskTime, bulkSetTaskStatus,
//! bulkSetTaskPriority, bulkDeleteTasks). applyTaskStatus — completion
//! attribution, activity log, recurrence spawn — is copied branch for
//! branch; the Next proxies own the guard/revalidate halves.

use crate::internal::{
    json_number, js_round, log_activity, ok_json, result_json, Activity,
};
use crate::util::{now_ms, now_secs};
use crate::AppState;
use axum::extract::{Path, State};
use axum::body::Bytes;
use axum::response::Response;
use chrono::Datelike;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

/// `if (!Number.isFinite(taskId) || taskId <= 0) return;` — a no-op, not
/// an error, exactly like the action.
fn path_id_ok(raw: &str) -> Option<f64> {
    match json_number(Some(&Value::String(raw.to_string()))) {
        Some(n) if n.is_finite() && n > 0.0 => Some(n),
        _ => None,
    }
}

struct TaskRow {
    id: i64,
    client_id: i64,
    title: String,
    description: Option<String>,
    why_it_matters: Option<String>,
    tool_path: Option<String>,
    priority: String,
    status: String,
    due_date: Option<i64>,
    recurring_interval: Option<String>,
    estimated_minutes: Option<i64>,
    assigned_user_id: Option<i64>,
    source: Option<String>,
    source_ref: Option<String>,
}

const TASK_COLS: &str = "id, client_id, title, description, why_it_matters, tool_path, priority, \
     status, due_date, recurring_interval, estimated_minutes, assigned_user_id, source, source_ref";

fn task_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<TaskRow> {
    Ok(TaskRow {
        id: r.get(0)?,
        client_id: r.get(1)?,
        title: r.get(2)?,
        description: r.get(3)?,
        why_it_matters: r.get(4)?,
        tool_path: r.get(5)?,
        priority: r.get(6)?,
        status: r.get(7)?,
        due_date: r.get(8)?,
        recurring_interval: r.get(9)?,
        estimated_minutes: r.get(10)?,
        assigned_user_id: r.get(11)?,
        source: r.get(12)?,
        source_ref: r.get(13)?,
    })
}

/// JS `setDate(+n)` under the UTC install (sandbox TZ is UTC; the Node
/// process runs with TZ unset → UTC). Calendar months get the exact JS
/// rollover treatment in js_add_months below.
fn js_add_months(base_secs: i64, add: i64) -> i64 {
    let Some(dt) = chrono::DateTime::from_timestamp(base_secs, 0) else {
        return base_secs;
    };
    let utc = dt.naive_utc();
    let (y, mo, d) = (utc.year(), utc.month() as i64 - 1, utc.day() as i64);
    let total = mo + add; // add > 0 here, so no negative-total edge
    let mut y2 = y + (total / 12) as i32;
    let mut mo2 = total % 12;
    let days_in = days_in_month(y2, (mo2 + 1) as u32);
    let d2 = if d > days_in {
        // JS setDate(d) with d > daysInMonth rolls into the NEXT month
        // (Jan 31 setMonth(1) → Mar 2, not Feb 28 like chrono would clamp).
        mo2 += 1;
        if mo2 > 11 {
            mo2 = 0;
            y2 += 1;
        }
        d - days_in
    } else {
        d
    };
    let Some(date) = chrono::NaiveDate::from_ymd_opt(y2, (mo2 + 1) as u32, d2 as u32) else {
        return base_secs;
    };
    chrono::NaiveDateTime::new(date, utc.time()).and_utc().timestamp()
}

fn is_leap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i32, m: u32) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap(y) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

/// Port of nextDueDate(prev, interval): daily/weekly are +N days; monthly/
/// quarterly are JS calendar-month arithmetic (rollover, not clamping).
fn next_due_date(prev: Option<i64>, interval: &str) -> i64 {
    let base = prev.unwrap_or_else(now_secs);
    match interval {
        "daily" => base + 86_400,
        "weekly" => base + 7 * 86_400,
        "monthly" => js_add_months(base, 1),
        "quarterly" => js_add_months(base, 3),
        _ => base,
    }
}

/// Port of applyTaskStatus(): the UPDATE with completion attribution, the
/// activity entry, and the next instance of a recurring task.
fn apply_task_status(
    state: &AppState,
    existing: &TaskRow,
    status: &str,
    completed_by_user_id: Option<i64>,
) -> Result<(), String> {
    state
        .db
        .with_conn(|c| {
            c.execute(
                "UPDATE tasks SET status = ?2, completed_by_user_id = ?3, updated_at = ?4 WHERE id = ?1",
                params![existing.id, status, completed_by_user_id, now_secs()],
            )
        })
        .map_err(|e| format!("status update failed: {e}"))?;

    if status != "done" || existing.status == "done" {
        return Ok(());
    }

    log_activity(
        &state.db,
        &Activity {
            kind: "task.completed",
            message: &format!("Completed task: {}", existing.title),
            level: "success",
            client_id: Some(existing.client_id),
            entity_type: Some("task"),
            entity_id: Some(existing.id),
            user_id: completed_by_user_id,
            dedupe: true,
            dedupe_window_minutes: 60 * 24,
        },
    );

    let Some(interval) = existing.recurring_interval.as_deref() else {
        return Ok(());
    };

    // Done → reopened → done again must not clone a second next instance.
    let open_instance: Option<i64> = state
        .db
        .with_conn(|c| {
            c.query_row(
                "SELECT id FROM tasks \
                 WHERE client_id = ?1 AND title = ?2 AND recurring_interval = ?3 \
                 AND status IN ('todo', 'in_progress') AND id != ?4 LIMIT 1",
                params![existing.client_id, existing.title, interval, existing.id],
                |r| r.get(0),
            )
            .optional()
        })
        .ok()
        .flatten();
    if open_instance.is_some() {
        return Ok(());
    }

    let due = next_due_date(existing.due_date, interval);
    state
        .db
        .with_conn(|c| {
            c.execute(
                "INSERT INTO tasks (client_id, title, description, why_it_matters, tool_path, \
                 priority, status, due_date, recurring_interval, estimated_minutes, \
                 assigned_user_id, source, source_ref) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'todo', ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    existing.client_id,
                    existing.title,
                    existing.description,
                    existing.why_it_matters,
                    existing.tool_path,
                    existing.priority,
                    due,
                    existing.recurring_interval,
                    existing.estimated_minutes,
                    existing.assigned_user_id,
                    existing.source,
                    existing.source_ref,
                ],
            )
        })
        .map_err(|e| format!("recurrence spawn failed: {e}"))?;
    Ok(())
}

// ---------- POST /api/internal/tasks/:id/status ----------

pub async fn task_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
    bytes: Bytes,
) -> Response {
    let Some(task_id) = path_id_ok(&id) else {
        return ok_json(json!({ "noop": true }));
    };
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let status = crate::util::js_string(body.get("status"));
    let user_id = body.get("userId").and_then(|v| v.as_i64());

    let existing = state
        .db
        .with_conn(|c| {
            c.query_row(
                &format!("SELECT {TASK_COLS} FROM tasks WHERE id = ?1 LIMIT 1"),
                params![task_id],
                task_from_row,
            )
            .optional()
        })
        .ok()
        .flatten();
    let Some(existing) = existing else {
        return ok_json(json!({ "noop": true }));
    };
    match apply_task_status(&state, &existing, &status, user_id) {
        Ok(()) => ok_json(json!({})),
        Err(e) => crate::internal::db_error_response(&e),
    }
}

// ---------- POST /api/internal/tasks/:id/delete ----------

pub async fn task_delete(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    if let Some(task_id) = path_id_ok(&id) {
        return match state
            .db
            .with_conn(|c| c.execute("DELETE FROM tasks WHERE id = ?1", params![task_id]))
        {
            Ok(_) => ok_json(json!({})),
            Err(e) => crate::internal::db_error_response(&format!("delete failed: {e}")),
        };
    }
    ok_json(json!({}))
}

// ---------- POST /api/internal/tasks/create ----------
// Validation replicates newTaskSchema (zod v4) message-for-message; the
// schema field order is the error precedence order.

fn err_invalid_number_nan() -> String {
    "Invalid input: expected number, received NaN".into()
}

/// z.coerce.number().int().positive()
fn v_client_id(v: Option<&Value>) -> Result<f64, String> {
    match json_number(v) {
        None => Err(err_invalid_number_nan()),
        Some(n) if n.is_nan() => Err(err_invalid_number_nan()),
        Some(n) if n.fract() != 0.0 => Err("Invalid input: expected int, received number".into()),
        Some(n) if n <= 0.0 => Err("Too small: expected number to be >0".into()),
        Some(n) => Ok(n),
    }
}

/// z.coerce.number().int().min(0).max(365) — undefined passes as absent,
/// null coerces to 0 (zod .optional() only exempts undefined).
fn v_due_in_days(v: Option<&Value>) -> Result<Option<f64>, String> {
    match v {
        None => Ok(None), // JSON absent = JS undefined
        Some(_) => match json_number(v) {
            None => Err(err_invalid_number_nan()),
            Some(n) if n.is_nan() => Err(err_invalid_number_nan()),
            Some(n) if n.fract() != 0.0 => {
                Err("Invalid input: expected int, received number".into())
            }
            Some(n) if n < 0.0 => Err("Too small: expected number to be >=0".into()),
            Some(n) if n > 365.0 => Err("Too big: expected number to be <=365".into()),
            Some(n) => Ok(Some(n)),
        },
    }
}

/// z.string().trim().min(2).max(200)
fn v_title(v: Option<&Value>) -> Result<String, String> {
    match v {
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.chars().count() < 2 {
                Err("Too small: expected string to have >=2 characters".into())
            } else if t.chars().count() > 200 {
                Err("Too big: expected string to have <=200 characters".into())
            } else {
                Ok(t.to_string())
            }
        }
        None => Err("Invalid input: expected string, received undefined".into()),
        Some(Value::Number(_)) => Err("Invalid input: expected string, received number".into()),
        Some(Value::Bool(_)) => Err("Invalid input: expected string, received boolean".into()),
        Some(_) => Err("Invalid input: expected string, received object".into()),
    }
}

const PRIORITIES: [&str; 3] = ["high", "medium", "low"];

fn v_priority(v: Option<&Value>) -> Result<String, String> {
    match v {
        // .default("medium") fires only for undefined
        None => Ok("medium".into()),
        Some(Value::String(s)) if PRIORITIES.contains(&s.as_str()) => Ok(s.clone()),
        Some(_) => Err(
            "Invalid option: expected one of \"high\"|\"medium\"|\"low\"".into(),
        ),
    }
}

/// z.string().trim().max(500).optional().or(literal("").transform) — "" is
/// consumed by the LEFT branch (string passes), so it stays "" in the DB.
fn v_max_len_optional(v: Option<&Value>, max: usize) -> Result<Option<String>, String> {
    match v {
        None => Ok(None),
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.chars().count() > max {
                Err(format!("Too big: expected string to have <={max} characters"))
            } else {
                Ok(Some(t.to_string()))
            }
        }
        Some(_) => Err("Invalid input".into()), // union fallback, zod v4
    }
}

const RECURRENCES: [&str; 4] = ["daily", "weekly", "monthly", "quarterly"];

/// z.enum([...]).optional().or(literal("").transform) — "" → undefined via
/// the right branch; any other invalid value → generic union "Invalid input".
fn v_recurring(v: Option<&Value>) -> Result<Option<String>, String> {
    match v {
        None => Ok(None),
        Some(Value::String(s)) if s.is_empty() => Ok(None),
        Some(Value::String(s)) if RECURRENCES.contains(&s.as_str()) => Ok(Some(s.clone())),
        Some(_) => Err("Invalid input".into()),
    }
}

pub async fn task_create(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);

    let client_id = match v_client_id(body.get("clientId")) {
        Ok(n) => n,
        Err(e) => return result_json(json!({ "ok": false, "error": e })),
    };
    let title = match v_title(body.get("title")) {
        Ok(t) => t,
        Err(e) => return result_json(json!({ "ok": false, "error": e })),
    };
    let why_it_matters = match v_max_len_optional(body.get("whyItMatters"), 500) {
        Ok(v) => v,
        Err(e) => return result_json(json!({ "ok": false, "error": e })),
    };
    let priority = match v_priority(body.get("priority")) {
        Ok(p) => p,
        Err(e) => return result_json(json!({ "ok": false, "error": e })),
    };
    let due_in_days = match v_due_in_days(body.get("dueInDays")) {
        Ok(v) => v,
        Err(e) => return result_json(json!({ "ok": false, "error": e })),
    };
    let recurring = match v_recurring(body.get("recurringInterval")) {
        Ok(v) => v,
        Err(e) => return result_json(json!({ "ok": false, "error": e })),
    };

    let client = state
        .db
        .with_conn(|c| {
            c.query_row(
                "SELECT id FROM clients WHERE id = ?1 LIMIT 1",
                params![client_id],
                |r| r.get::<_, i64>(0),
            )
            .optional()
        })
        .ok()
        .flatten();
    if client.is_none() {
        return result_json(json!({ "ok": false, "error": "Client not found." }));
    }

    let due_date: Option<i64> = due_in_days
        .map(|d| (now_ms() as f64 + d * 86_400_000.0) as i64 / 1000);

    let insert = state.db.with_conn(|c| {
        c.execute(
            "INSERT INTO tasks (client_id, title, why_it_matters, priority, status, due_date, recurring_interval) \
             VALUES (?1, ?2, ?3, ?4, 'todo', ?5, ?6)",
            params![client_id, title, why_it_matters, priority, due_date, recurring],
        )?;
        Ok(c.last_insert_rowid())
    });
    let row_id = match insert {
        Ok(id) => id,
        Err(e) => return result_json(json!({ "ok": false, "error": e.to_string() })),
    };

    let user_id = body.get("userId").and_then(|v| v.as_i64());
    log_activity(
        &state.db,
        &Activity {
            kind: "task.created",
            message: &format!("New task: {title}"),
            level: "info",
            client_id: Some(client_id as i64),
            entity_type: Some("task"),
            entity_id: Some(row_id),
            user_id,
            dedupe: true,
            dedupe_window_minutes: 60 * 24,
        },
    );

    result_json(json!({ "ok": true, "id": row_id }))
}

// ---------- POST /api/internal/tasks/:id/time ----------

pub async fn task_time(
    State(state): State<AppState>,
    Path(id): Path<String>,
    bytes: Bytes,
) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let Some(task_id) = path_id_ok(&id) else {
        return result_json(json!({ "ok": false, "error": "Invalid task" }));
    };
    let minutes = match json_number(body.get("minutes")) {
        Some(n) if n.is_finite() && n != 0.0 => n,
        _ => return result_json(json!({ "ok": false, "error": "Enter minutes" })),
    };
    let actual: Option<i64> = state
        .db
        .with_conn(|c| {
            c.query_row(
                "SELECT actual_minutes FROM tasks WHERE id = ?1 LIMIT 1",
                params![task_id],
                |r| r.get(0),
            )
            .optional()
        })
        .ok()
        .flatten();
    let Some(actual) = actual else {
        return result_json(json!({ "ok": false, "error": "Task not found" }));
    };
    let new_total = (actual as f64 + js_round(minutes)).max(0.0) as i64;
    if let Err(e) = state.db.with_conn(|c| {
        c.execute(
            "UPDATE tasks SET actual_minutes = ?2, updated_at = ?3 WHERE id = ?1",
            params![task_id, new_total, now_secs()],
        )
    }) {
        return result_json(json!({ "ok": false, "error": format!("time log failed: {e}") }));
    }
    result_json(json!({ "ok": true, "total": new_total }))
}

// ---------- bulk helpers ----------

/// validIds: Number.isFinite(id) && id > 0 — kept as f64, like the SQL the
/// action would build (5.5 matches nothing, same as drizzle).
fn valid_ids(v: Option<&Value>) -> Vec<f64> {
    match v {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|x| match x {
                Value::Number(n) => {
                    let f = n.as_f64()?;
                    f.is_finite().then_some(f).filter(|f| *f > 0.0)
                }
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn placeholders(n: usize) -> String {
    (1..=n).map(|i| format!("?{i}")).collect::<Vec<_>>().join(",")
}

// ---------- POST /api/internal/tasks/bulk-status ----------

pub async fn bulk_status(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let ids = valid_ids(body.get("ids"));
    if ids.is_empty() {
        return ok_json(json!({ "noop": true }));
    }
    let status = crate::util::js_string(body.get("status"));
    let user_id = body.get("userId").and_then(|v| v.as_i64());

    let rows = state.db.with_conn(|c| {
        let sql = format!(
            "SELECT {TASK_COLS} FROM tasks WHERE id IN ({})",
            placeholders(ids.len())
        );
        let mut stmt = c.prepare(&sql)?;
        let mut it = stmt.query(rusqlite::params_from_iter(ids.iter()))?;
        let mut out = Vec::new();
        while let Some(r) = it.next()? {
            out.push(task_from_row(r)?);
        }
        Ok(out)
    });
    if let Ok(rows) = rows {
        for row in &rows {
            if let Err(e) = apply_task_status(&state, row, &status, user_id) {
                return crate::internal::db_error_response(&e);
            }
        }
    }
    ok_json(json!({}))
}

// ---------- POST /api/internal/tasks/bulk-priority ----------

pub async fn bulk_priority(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let ids = valid_ids(body.get("ids"));
    if ids.is_empty() {
        return ok_json(json!({ "noop": true }));
    }
    let priority = crate::util::js_string(body.get("priority"));
    let mut sql = format!(
        "UPDATE tasks SET priority = ?{}, updated_at = ?{} WHERE id IN (",
        ids.len() + 1,
        ids.len() + 2
    );
    sql.push_str(&placeholders(ids.len()));
    sql.push(')');
    let mut p: Vec<Box<dyn rusqlite::ToSql>> =
        ids.iter().map(|f| Box::new(*f) as Box<dyn rusqlite::ToSql>).collect();
    p.push(Box::new(priority));
    p.push(Box::new(now_secs()));
    let refs: Vec<&dyn rusqlite::ToSql> = p.iter().map(|b| b.as_ref()).collect();
    match state.db.with_conn(|c| c.execute(&sql, refs.as_slice())) {
        Ok(_) => ok_json(json!({})),
        Err(e) => crate::internal::db_error_response(&format!("bulk priority failed: {e}")),
    }
}

// ---------- POST /api/internal/tasks/bulk-delete ----------

pub async fn bulk_delete(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let ids = valid_ids(body.get("ids"));
    if ids.is_empty() {
        return ok_json(json!({ "noop": true }));
    }
    let sql = format!("DELETE FROM tasks WHERE id IN ({})", placeholders(ids.len()));
    match state.db.with_conn(|c| {
        c.execute(&sql, rusqlite::params_from_iter(ids.iter()))
    }) {
        Ok(_) => ok_json(json!({})),
        Err(e) => crate::internal::db_error_response(&format!("bulk delete failed: {e}")),
    }
}
