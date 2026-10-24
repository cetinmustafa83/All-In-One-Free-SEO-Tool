//! Keywords domain — Task 14.5a. Port of src/app/keywords/actions.ts
//! (trackKeyword, untrackKeyword) and src/app/keywords/import-actions.ts
//! (importKeywords with its quoted-CSV parser, header sniffing and
//! lowercase dedupe). researchAction deliberately stays Next-side.

use crate::internal::{json_number, ok_json, result_json};
use crate::AppState;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::response::Response;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

// ---------- POST /api/internal/keywords/track ----------

pub async fn track(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);

    let client_id = match json_number(body.get("clientId")) {
        Some(n) if n.is_finite() && n > 0.0 => n as i64,
        // `if (!Number.isFinite(clientId) || clientId <= 0) return;` — silent
        _ => return ok_json(json!({})),
    };
    let query = crate::util::js_string(body.get("query")).trim().to_string();
    if query.is_empty() {
        return ok_json(json!({}));
    }
    let country = crate::util::js_string(body.get("country"));
    let device = crate::util::js_string(body.get("device"));

    // Skip if same client+query already tracked
    let existing = state
        .db
        .with_conn(|c| {
            c.query_row(
                "SELECT id FROM keywords WHERE client_id = ?1 AND query = ?2 LIMIT 1",
                params![client_id, query],
                |r| r.get::<_, i64>(0),
            )
            .optional()
        })
        .ok()
        .flatten();
    if existing.is_some() {
        return ok_json(json!({ "deduped": true }));
    }

    let _ = state.db.with_conn(|c| {
        c.execute(
            "INSERT INTO keywords (client_id, query, country, device) VALUES (?1, ?2, ?3, ?4)",
            params![client_id, query, country, device],
        )
    });
    ok_json(json!({ "deduped": false }))
}

// ---------- POST /api/internal/keywords/:id/untrack ----------

pub async fn untrack(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    match json_number(Some(&Value::String(id))) {
        Some(n) if n.is_finite() && n > 0.0 => {
            let _ = state
                .db
                .with_conn(|c| c.execute("DELETE FROM keywords WHERE id = ?1", params![n]));
        }
        _ => {}
    }
    ok_json(json!({}))
}

// ---------- POST /api/internal/keywords/import ----------

/// Port of the import-actions.ts parseCsv: quoted values, escaped quotes,
/// embedded commas/newlines. Lone \r is SKIPPED entirely in this variant
/// (the backlinks parser treats it as a row terminator — do not unify).
fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut cell = String::new();
    let mut in_quotes = false;

    let chars: Vec<char> = text.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        let ch = chars[i];
        if in_quotes {
            if ch == '"' && i + 1 < chars.len() && chars[i + 1] == '"' {
                cell.push('"');
                i += 1;
            } else if ch == '"' {
                in_quotes = false;
            } else {
                cell.push(ch);
            }
        } else {
            match ch {
                '"' => in_quotes = true,
                ',' => row.push(std::mem::take(&mut cell)),
                '\n' => {
                    row.push(std::mem::take(&mut cell));
                    rows.push(std::mem::take(&mut row));
                }
                '\r' => {} // skip
                _ => cell.push(ch),
            }
        }
        i += 1;
    }
    // last cell / row
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        rows.push(row);
    }
    rows
}

pub async fn import(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let csv = crate::util::js_string(body.get("csv")).trim().to_string();
    let target_client_id = json_number(body.get("clientId"));

    if csv.is_empty() {
        return result_json(json!({ "ok": false, "error": "CSV is empty." }));
    }
    let Some(target_client_id) = target_client_id.filter(|n| n.is_finite() && *n > 0.0) else {
        return result_json(json!({ "ok": false, "error": "Pick a target client." }));
    };
    let target_client_id = target_client_id as i64;

    let client = state
        .db
        .with_conn(|c| {
            c.query_row(
                "SELECT id FROM clients WHERE id = ?1 LIMIT 1",
                params![target_client_id],
                |r| r.get::<_, i64>(0),
            )
            .optional()
        })
        .ok()
        .flatten();
    if client.is_none() {
        return result_json(json!({ "ok": false, "error": "Client not found." }));
    }

    let rows = parse_csv(&csv);
    if rows.is_empty() {
        return result_json(json!({ "ok": false, "error": "No rows parsed." }));
    }

    // Detect header — accept several common shapes:
    //   query / keyword / query,country,device / query,country
    let header: Vec<String> = rows[0]
        .iter()
        .map(|c| c.trim().to_lowercase())
        .collect();
    let query_idx = match header.iter().position(|h| h == "query") {
        Some(i) => Some(i),
        None => header.iter().position(|h| h == "keyword"),
    };
    let country_idx = header.iter().position(|h| h == "country");
    let device_idx = header.iter().position(|h| h == "device");

    let (data_rows, query_col): (Vec<&Vec<String>>, usize) = match query_idx {
        Some(qi) => (rows[1..].iter().collect(), qi),
        // No header — treat first column of every row as the query
        None => (rows.iter().collect(), 0),
    };

    // Existing keywords for this client (for dedup)
    let existing: Vec<String> = state
        .db
        .with_conn(|c| {
            let mut stmt = c
                .prepare("SELECT query FROM keywords WHERE client_id = ?1")?;
            let it = stmt.query_map(params![target_client_id], |r| r.get::<_, String>(0))?;
            it.collect::<Result<Vec<_>, _>>()
        })
        .unwrap_or_default();
    let mut existing_set: std::collections::HashSet<String> = existing
        .iter()
        .map(|q| q.trim().to_lowercase())
        .collect();

    let mut added = 0i64;
    let mut skipped = 0i64;
    let mut to_insert: Vec<(i64, String, String, String)> = Vec::new();

    for r in data_rows {
        let query = r.get(query_col).map(|s| s.trim().to_string()).unwrap_or_default();
        if query.is_empty() {
            skipped += 1;
            continue;
        }
        let normalized = query.to_lowercase();
        if existing_set.contains(&normalized) {
            skipped += 1;
            continue;
        }
        existing_set.insert(normalized);

        // `r[countryIdx] ?? "US"` — only a MISSING index falls back to US;
        // an empty cell stays "" exactly like the JS.
        let country = match country_idx {
            Some(ci) => r
                .get(ci)
                .map(|s| s.trim().to_uppercase())
                .unwrap_or_else(|| "US".into()),
            None => "US".into(),
        };
        let device_raw = match device_idx {
            Some(di) => r
                .get(di)
                .map(|s| s.trim().to_lowercase())
                .unwrap_or_else(|| "desktop".into()),
            None => "desktop".into(),
        };
        let device: String = if device_raw == "mobile" { "mobile".into() } else { "desktop".into() };

        to_insert.push((target_client_id, query, country, device));
        added += 1;
    }

    if !to_insert.is_empty() {
        // One statement, like the drizzle insert in the action.
        let mut sql = String::from(
            "INSERT INTO keywords (client_id, query, country, device) VALUES ",
        );
        for i in 0..to_insert.len() {
            if i > 0 {
                sql.push(',');
            }
            let b = i * 4;
            sql.push_str(&format!(
                "({},{},{},{})",
                b + 1,
                b + 2,
                b + 3,
                b + 4
            ));
        }
        let flat: Vec<&dyn rusqlite::ToSql> = to_insert
            .iter()
            .flat_map(|row| {
                let (cid, q, co, dv) = row;
                let refs: [&dyn rusqlite::ToSql; 4] = [cid, q, co, dv];
                refs
            })
            .collect();
        let res = state.db.with_conn(|c| c.execute(&sql, flat.as_slice()));
        if let Err(e) = res {
            return result_json(json!({ "ok": false, "error": e.to_string() }));
        }
    }

    result_json(json!({
        "ok": true,
        "added": added,
        "skipped": skipped,
        "total": added + skipped,
    }))
}
