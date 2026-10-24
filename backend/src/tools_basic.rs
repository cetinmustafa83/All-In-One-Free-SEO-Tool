//! Tools wave 1 (pure-DB) — Task 14.6a.
//!
//! Ports the DB effects of the small `src/app/tools/*` server actions that
//! touch SQLite directly (no outbound HTTP, no AI calls):
//!
//!   redirects-manager  addRule / deleteRule / record404 / resolve404 /
//!                      deleteNotFound    (redirect_rules, not_found_log)
//!   uptime             addTarget / deleteTarget / toggleTarget
//!                      (uptime_targets — runPingNow stays Next: outbound pings)
//!   person-schema      savePersonSchema  (tool_runs, the saveToolRun path)
//!   migration-map      importToRedirectRules (redirect_rules; the fuzzy
//!                      mapper is COMPUTE and stays Next-side — the proxy
//!                      sends pre-shaped rows, 14.5b verdicts-over-the-wire)
//!   serp-features      removeSnapshot    (serp_feature_snapshots)
//!   robots-history     loadSnapshots     (robots_snapshots read; ISO dates)
//!   bing + youtube     save/clear API key (workspace_settings upsert/delete,
//!                      the generic settings-store path)
//!
//! These actions validate by hand (no zod); the checks below mirror each
//! branch message-for-message so direct callers get the same envelopes. The
//! Next proxies repeat the same checks first, so Rust-side validation only
//! ever guards direct API callers.
//!
//! Error style note: every primary-effect write returns Result and a failure
//! becomes 500 `{"ok":false,"error":<sqlite message>}` — bare, because the
//! original actions did not catch these and the UI shows the raw SqliteError
//! text (only savePersonSchema / importToRedirectRules catch, and they print
//! `e.message` verbatim — so bare keeps those byte-identical too).

use crate::internal::{db_error_response, json_number, ok_json, result_json, url_hostname};
use crate::util::{js_slice, js_string, now_secs, row_json, Col};
use crate::AppState;
use axum::body::Bytes;
use axum::extract::State;
use axum::response::Response;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

fn body_of(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).unwrap_or(Value::Null)
}

/// `/^https?:\/\//i.test(s)` — the actions' scheme sniff, no regex crate.
fn has_http_scheme(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// Id for the void delete/toggle actions. Drizzle binds a JS number as-is:
/// 5.0 matches INTEGER row 5 via column affinity, 5.5 (and NaN → JSON null →
/// the JS Number(null)=0 path) matches nothing. Keep f64 end-to-end so the
/// same rows match/miss.
fn row_id_f(v: Option<&Value>) -> f64 {
    json_number(v).filter(|n| n.is_finite()).unwrap_or(0.0)
}

// ---------------------------------------------------------------------------
// redirects-manager: addRule
// ---------------------------------------------------------------------------

const RULE_STATUS_CODES: [f64; 5] = [301.0, 302.0, 307.0, 308.0, 410.0];

// ---------- POST /api/internal/tools/redirects/add ----------
pub async fn redirect_add(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body = body_of(&bytes);
    let source_path = js_string(body.get("sourcePath")).trim().to_string();
    let target_url = js_string(body.get("targetUrl")).trim().to_string();
    if source_path.is_empty() || target_url.is_empty() {
        return result_json(json!({
            "ok": false,
            "error": "Source path + target URL required."
        }));
    }
    if !source_path.starts_with('/') {
        return result_json(json!({
            "ok": false,
            "error": "Source path must start with /"
        }));
    }
    if !has_http_scheme(&target_url) && !target_url.starts_with('/') {
        return result_json(json!({
            "ok": false,
            "error": "Target must be absolute URL or /-prefixed path."
        }));
    }
    let status = json_number(body.get("statusCode"));
    // Number(...) NaN arrives as JSON null → None → same "must be" error the
    // action's includes() check produces.
    if !status.map(|n| RULE_STATUS_CODES.contains(&n)).unwrap_or(false) {
        return result_json(json!({
            "ok": false,
            "error": "Status code must be 301/302/307/308/410."
        }));
    }
    let note = body.get("note").and_then(|v| v.as_str()).map(String::from);
    match state.db.with_conn(|c| {
        c.execute(
            "INSERT INTO redirect_rules (source_path, target_url, status_code, note) \
             VALUES (?1, ?2, ?3, ?4)",
            params![source_path, target_url, status, note],
        )
    }) {
        Ok(_) => ok_json(json!({ "ok": true })),
        Err(e) => db_error_response(&e.to_string()),
    }
}

// ---------- POST /api/internal/tools/redirects/delete ----------
pub async fn redirect_delete(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body = body_of(&bytes);
    let id = row_id_f(body.get("id"));
    match state
        .db
        .with_conn(|c| c.execute("DELETE FROM redirect_rules WHERE id = ?1", params![id]))
    {
        Ok(_) => ok_json(json!({})),
        Err(e) => db_error_response(&e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// redirects-manager: record404 / resolve404 / deleteNotFound
// ---------------------------------------------------------------------------

// ---------- POST /api/internal/tools/redirects/404/record ----------
pub async fn notfound_record(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body = body_of(&bytes);
    let source_path = js_string(body.get("sourcePath")).trim().to_string();
    if source_path.is_empty() {
        // The action returns `{ ok: false }` with NO error field here.
        return result_json(json!({ "ok": false }));
    }
    let existing: Option<i64> = state
        .db
        .with_conn(|c| {
            c.query_row(
                "SELECT id FROM not_found_log WHERE source_path = ?1 LIMIT 1",
                params![source_path],
                |r| r.get(0),
            )
            .optional()
        })
        .ok()
        .flatten();
    // Existing: hits+1 and lastSeen = new Date() (drizzle timestamp mode →
    // epoch SECONDS). New row: hits/first_seen/last_seen take the DDL
    // defaults (1 / unixepoch / unixepoch).
    let res = match existing {
        Some(id) => state.db.with_conn(|c| {
            c.execute(
                "UPDATE not_found_log SET hits = hits + 1, last_seen = ?2 WHERE id = ?1",
                params![id, now_secs()],
            )
        }),
        None => state.db.with_conn(|c| {
            c.execute(
                "INSERT INTO not_found_log (source_path) VALUES (?1)",
                params![source_path],
            )
        }),
    };
    match res {
        Ok(_) => ok_json(json!({ "ok": true })),
        Err(e) => db_error_response(&e.to_string()),
    }
}

// ---------- POST /api/internal/tools/redirects/404/resolve ----------
pub async fn notfound_resolve(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body = body_of(&bytes);
    let target_url = js_string(body.get("targetUrl")).trim().to_string();
    // `if (!Number.isFinite(id) || !targetUrl) return { ok: false }` — note
    // there is NO id>0 check in the action; 0/negative just find no row.
    let id = json_number(body.get("id")).filter(|n| n.is_finite());
    if id.is_none() || target_url.is_empty() {
        return result_json(json!({ "ok": false }));
    }
    let id = id.unwrap();
    let row: Option<(String, i64)> = state
        .db
        .with_conn(|c| {
            c.query_row(
                "SELECT source_path, hits FROM not_found_log WHERE id = ?1 LIMIT 1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
        })
        .ok()
        .flatten();
    let Some((source_path, hits)) = row else {
        return result_json(json!({ "ok": false }));
    };
    let note = format!("Auto-created from 404 log ({hits} hits)");
    if let Err(e) = state.db.with_conn(|c| {
        c.execute(
            "INSERT INTO redirect_rules (source_path, target_url, status_code, note) \
             VALUES (?1, ?2, 301, ?3)",
            params![source_path, target_url, note],
        )
    }) {
        return db_error_response(&e.to_string());
    }
    if let Err(e) = state.db.with_conn(|c| {
        c.execute(
            "UPDATE not_found_log SET resolved = ?2, resolved_to_url = ?3 WHERE id = ?1",
            params![id, true, target_url],
        )
    }) {
        return db_error_response(&e.to_string());
    }
    ok_json(json!({ "ok": true }))
}

// ---------- POST /api/internal/tools/redirects/404/delete ----------
pub async fn notfound_delete(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body = body_of(&bytes);
    let id = row_id_f(body.get("id"));
    match state
        .db
        .with_conn(|c| c.execute("DELETE FROM not_found_log WHERE id = ?1", params![id]))
    {
        Ok(_) => ok_json(json!({})),
        Err(e) => db_error_response(&e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// uptime: addTarget / deleteTarget / toggleTarget (runPingNow stays Next —
// pingAll does outbound HTTP)
// ---------------------------------------------------------------------------

// ---------- POST /api/internal/tools/uptime/add ----------
pub async fn uptime_add(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body = body_of(&bytes);
    let url = js_string(body.get("url")).trim().to_string();
    if url.is_empty() {
        return result_json(json!({ "ok": false, "error": "URL required." }));
    }
    if !has_http_scheme(&url) {
        return result_json(json!({
            "ok": false,
            "error": "URL must start with http(s)://"
        }));
    }
    let label = body.get("label").and_then(|v| v.as_str()).map(String::from);
    let expected_text = body
        .get("expectedText")
        .and_then(|v| v.as_str())
        .map(String::from);
    // The action coerces Number(formData.get("expectedStatus") ?? 200): an
    // ABSENT field is 200, but Number(junk) is NaN and JSON cannot carry NaN
    // — the proxy sends explicit null for that. The original then failed the
    // insert with SQLite's NOT NULL error; an absent field from a direct
    // caller mirrors `?? 200`.
    let expected_status: Option<f64> = match body.get("expectedStatus") {
        None => Some(200.0),
        Some(Value::Null) => None,
        Some(v) => json_number(Some(v)).filter(|n| n.is_finite()),
    };
    match state.db.with_conn(|c| {
        c.execute(
            "INSERT INTO uptime_targets (url, label, expected_status, expected_text, enabled) \
             VALUES (?1, ?2, ?3, ?4, 1)",
            params![url, label, expected_status, expected_text],
        )
    }) {
        Ok(_) => ok_json(json!({ "ok": true })),
        Err(e) => db_error_response(&e.to_string()),
    }
}

// ---------- POST /api/internal/tools/uptime/delete ----------
pub async fn uptime_delete(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body = body_of(&bytes);
    let id = row_id_f(body.get("id"));
    match state.db.with_conn(|c| {
        c.execute("DELETE FROM uptime_targets WHERE id = ?1", params![id])
    }) {
        Ok(_) => ok_json(json!({})),
        Err(e) => db_error_response(&e.to_string()),
    }
}

// ---------- POST /api/internal/tools/uptime/toggle ----------
pub async fn uptime_toggle(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body = body_of(&bytes);
    let id = row_id_f(body.get("id"));
    let enabled = body.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
    match state.db.with_conn(|c| {
        c.execute(
            "UPDATE uptime_targets SET enabled = ?2 WHERE id = ?1",
            params![id, enabled],
        )
    }) {
        Ok(_) => ok_json(json!({})),
        Err(e) => db_error_response(&e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// person-schema: savePersonSchema — the saveToolRun({toolId:"person-schema"})
// path. label = name.slice(0,200); input/result stored as the JSON text
// drizzle's mode:"json" would produce.
// ---------------------------------------------------------------------------

// ---------- POST /api/internal/tools/person-schema/save ----------
pub async fn person_schema_save(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body = body_of(&bytes);
    let name = js_string(body.get("name")).trim().to_string();
    let jsonld = js_string(body.get("jsonld")).trim().to_string();
    if name.is_empty() {
        return result_json(json!({ "ok": false, "error": "Person name is required." }));
    }
    if jsonld.is_empty() {
        return result_json(json!({ "ok": false, "error": "Generate the JSON-LD first." }));
    }
    let label = js_slice(&name, 200);
    let input_text = serde_json::to_string(&json!({ "name": name })).unwrap_or_default();
    let result_text = serde_json::to_string(&json!({ "jsonld": jsonld })).unwrap_or_default();
    // Resolved Next-side (clientIdFromRequest / currentUserId) and passed
    // through — the Rust process has no request cookie on this channel.
    let client_id = body.get("clientId").and_then(|v| v.as_i64());
    let user_id = body.get("userId").and_then(|v| v.as_i64());
    match state.db.with_conn(|c| {
        c.query_row(
            "INSERT INTO tool_runs (client_id, tool_id, label, input_json, result_json, user_id) \
             VALUES (?1, 'person-schema', ?2, ?3, ?4, ?5) RETURNING id",
            params![client_id, label, input_text, result_text, user_id],
            |r| r.get::<_, i64>(0),
        )
    }) {
        Ok(id) => result_json(json!({ "ok": true, "runId": id })),
        Err(e) => db_error_response(&e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// migration-map: importToRedirectRules — rows are pre-shaped Next-side
// (buildMigrationMap + new URL pathname/search happen in the proxy, exact
// WHATWG semantics); 301 + the confidence note are baked in there too.
// ---------------------------------------------------------------------------

// ---------- POST /api/internal/tools/migration-map/import ----------
pub async fn migration_import(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body = body_of(&bytes);
    let Some(Value::Array(rows)) = body.get("rows") else {
        return result_json(json!({ "ok": false, "error": "rows must be an array" }));
    };
    let mut inserted: i64 = 0;
    for row in rows {
        // Missing/non-string sourcePath/targetUrl bind NULL → NOT NULL
        // violation, exactly like drizzle binding undefined.
        let source_path = row.get("sourcePath").and_then(|v| v.as_str());
        let target_url = row.get("targetUrl").and_then(|v| v.as_str());
        let note = row.get("note").and_then(|v| v.as_str());
        if let Err(e) = state.db.with_conn(|c| {
            c.execute(
                "INSERT INTO redirect_rules (source_path, target_url, status_code, note) \
                 VALUES (?1, ?2, 301, ?3)",
                params![source_path, target_url, note],
            )
        }) {
            return db_error_response(&e.to_string());
        }
        inserted += 1;
    }
    result_json(json!({ "ok": true, "inserted": inserted }))
}

// ---------------------------------------------------------------------------
// serp-features: removeSnapshot (runCapture stays Next — scanSerp is NET)
// ---------------------------------------------------------------------------

// ---------- POST /api/internal/tools/serp-features/delete ----------
pub async fn serp_snapshot_delete(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body = body_of(&bytes);
    let id = row_id_f(body.get("id"));
    match state.db.with_conn(|c| {
        c.execute("DELETE FROM serp_feature_snapshots WHERE id = ?1", params![id])
    }) {
        Ok(_) => result_json(json!({ "ok": true })),
        Err(e) => db_error_response(&e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// robots-history: loadSnapshots — listSnapshots(host, limit = 20). fetchedAt
// leaves as an ISO string; the Next proxy converts back to Date.
// ---------------------------------------------------------------------------

/// Port of parseHost in src/lib/robots-snapshots.ts: trim, prepend https://
/// when scheme-less, WHATWG hostname, strip ONE leading "www.", lowercase.
fn parse_host(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    let with_scheme = if has_http_scheme(s) {
        s.to_string()
    } else {
        format!("https://{s}")
    };
    let host = url_hostname(&with_scheme)?;
    let host = host.strip_prefix("www.").unwrap_or(&host);
    if host.is_empty() {
        return None; // JS falsy "" → the caller returns []
    }
    Some(host.to_string())
}

// ---------- POST /api/internal/tools/robots-history/list ----------
pub async fn robots_list(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body = body_of(&bytes);
    let Some(host) = body
        .get("host")
        .and_then(|v| v.as_str())
        .and_then(parse_host)
    else {
        return result_json(json!([]));
    };
    const COLS: [(&str, &str, Col); 7] = [
        ("id", "id", Col::Raw),
        ("client_id", "clientId", Col::Raw),
        ("hostname", "hostname", Col::Raw),
        ("content", "content", Col::Raw),
        ("content_hash", "contentHash", Col::Raw),
        ("status", "status", Col::Raw),
        ("fetched_at", "fetchedAt", Col::Iso),
    ];
    match state.db.with_conn(|c| {
        let mut stmt = c.prepare(
            "SELECT id, client_id, hostname, content, content_hash, status, fetched_at \
             FROM robots_snapshots WHERE hostname = ?1 \
             ORDER BY fetched_at DESC LIMIT 20",
        )?;
        let it = stmt.query_map(params![host], |r| Ok(row_json(r, &COLS)))?;
        it.collect::<Result<Vec<_>, _>>()
    }) {
        Ok(list) => result_json(Value::Array(list)),
        Err(e) => db_error_response(&e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// settings store (bing + youtube API keys): setSetting / deleteSetting
// ---------------------------------------------------------------------------

// ---------- POST /api/internal/tools/settings/set ----------
pub async fn settings_set(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body = body_of(&bytes);
    let key = js_string(body.get("key"));
    // JS: JSON.stringify(undefined) → undefined → drizzle binds NULL; an
    // explicit JSON null stringifies as the 4-char text "null".
    let value_text: Option<String> = match body.get("value") {
        None => None,
        Some(v) => Some(serde_json::to_string(v).unwrap_or_else(|_| "null".into())),
    };
    match state.db.with_conn(|c| {
        c.execute(
            "INSERT INTO workspace_settings (key, value, updated_at) VALUES (?1, ?2, ?3) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value_text, now_secs()],
        )
    }) {
        Ok(_) => ok_json(json!({ "ok": true })),
        Err(e) => db_error_response(&e.to_string()),
    }
}

// ---------- POST /api/internal/tools/settings/delete ----------
pub async fn settings_delete(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body = body_of(&bytes);
    let key = js_string(body.get("key"));
    match state.db.with_conn(|c| {
        c.execute("DELETE FROM workspace_settings WHERE key = ?1", params![key])
    }) {
        Ok(_) => ok_json(json!({ "ok": true })),
        Err(e) => db_error_response(&e.to_string()),
    }
}
