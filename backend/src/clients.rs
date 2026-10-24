//! Clients domain — Task 14.5b. Port of the DB sections of
//! src/app/clients/actions.ts (createClient, updateClient, deleteClient,
//! quickAddClient, applyStackTemplates, applyNicheTemplates,
//! redetectTechStack) and src/app/clients/share-actions.ts
//! (generateShareToken, revokeShareToken).
//!
//! Split of responsibilities (14.5a pattern): the Next proxies own
//! guardAction, zod (UI error strings), and everything that needs an HTTP
//! client the Rust backend is not allowed to have (no new Cargo deps):
//! detectTechStack, fetchSiteMetadata, and the template-preflight site read.
//! The preflight verdicts travel with the request as `{title, evidence}`
//! pairs — a title without a verdict is kept, which is exactly what
//! templateSatisfied(null-facts) does. Everything DB-side lives here:
//! client rows, tech_stack/social_links column shapes, the template engine
//! (candidate data in client_templates.rs, skip-activity, dedupe, insert),
//! activity_log entries, share tokens.

use crate::client_templates::{niche_templates, pick_stack_templates, Template};
use crate::db::Db;
use crate::internal::{
    bad_request, db_error_response, is_url, json_number, log_activity, ok_json, result_json,
    url_hostname, Activity,
};
use crate::util::{js_string, now_secs};
use crate::AppState;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::response::Response;
use rusqlite::{params, params_from_iter, types::Value as SqlValue, OptionalExtension};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

/// `if (!Number.isFinite(id) || id <= 0) return;` — a no-op, not an error,
/// exactly like the actions (same helper as tasks.rs, narrowed to i64 for
/// the row ids used here; a fractional id matched nothing in drizzle and
/// matches nothing here either).
fn path_id_ok(raw: &str) -> Option<i64> {
    match json_number(Some(&Value::String(raw.to_string()))) {
        Some(n) if n.is_finite() && n > 0.0 && n.fract() == 0.0 => Some(n as i64),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// zod-parity validators (clientInput / updateClientInput) — direct-API
// callers only; the Next proxies have already run the real zod schemas.
// ---------------------------------------------------------------------------

/// z.string().trim().min(1, "Name is required").max(120)
fn v_name(v: Option<&Value>) -> Result<String, String> {
    match v {
        Some(Value::String(s)) => {
            let t = s.trim();
            let len = t.chars().count();
            if len < 1 {
                Err("Name is required".into())
            } else if len > 120 {
                Err("Too big: expected string to have <=120 characters".into())
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

fn starts_with_http_scheme(s: &str) -> bool {
    (s.len() >= 7 && s[..7].eq_ignore_ascii_case("http://"))
        || (s.len() >= 8 && s[..8].eq_ignore_ascii_case("https://"))
}

/// z.string().trim().min(1, "URL is required").transform(prepend https).pipe(
///   z.string().url("Enter a valid URL"))
fn v_url(v: Option<&Value>) -> Result<String, String> {
    let s = match v {
        Some(Value::String(s)) => s,
        None => return Err("Invalid input: expected string, received undefined".into()),
        Some(Value::Number(_)) => {
            return Err("Invalid input: expected string, received number".into())
        }
        Some(Value::Bool(_)) => {
            return Err("Invalid input: expected string, received boolean".into())
        }
        Some(_) => return Err("Invalid input: expected string, received object".into()),
    };
    let t = s.trim();
    if t.is_empty() {
        return Err("URL is required".into());
    }
    let normalized = if starts_with_http_scheme(t) {
        t.to_string()
    } else {
        format!("https://{t}")
    };
    if is_url(&normalized) {
        Ok(normalized)
    } else {
        Err("Enter a valid URL".into())
    }
}

const NICHES: [&str; 5] = ["local", "ecommerce", "saas", "blog", "services"];

/// z.enum(niches).optional().or(literal("").transform(() => undefined)) —
/// "" falls through the failed enum branch into the literal branch → None.
/// Invalid values fail both branches → generic union message (same shape as
/// backlinks.rs v_rel for the identical .or pattern).
fn v_niche(v: Option<&Value>) -> Result<Option<String>, String> {
    match v {
        None => Ok(None),
        Some(Value::String(s)) if s.is_empty() => Ok(None),
        Some(Value::String(s)) if NICHES.contains(&s.as_str()) => Ok(Some(s.clone())),
        Some(_) => Err("Invalid input".into()),
    }
}

/// optionalString — z.string().trim().max(500).optional().or(literal("").
/// transform(() => undefined)). "" passes the LEFT branch (a valid string),
/// so it STAYS "" in the DB — the same left-branch precedence backlinks.rs
/// documents for its targetUrl.
fn v_opt_string(v: Option<&Value>) -> Result<Option<String>, String> {
    match v {
        None => Ok(None),
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.chars().count() > 500 {
                Err("Too big: expected string to have <=500 characters".into())
            } else {
                Ok(Some(t.to_string()))
            }
        }
        Some(_) => Err("Invalid input".into()),
    }
}

/// z.coerce.number().int().positive() — the updateClientInput.id field.
fn v_client_id(v: Option<&Value>) -> Result<i64, String> {
    match json_number(v) {
        None => Err("Invalid input: expected number, received NaN".into()),
        Some(n) if n.is_nan() => Err("Invalid input: expected number, received NaN".into()),
        Some(n) if n.fract() != 0.0 => {
            Err("Invalid input: expected int, received number".into())
        }
        Some(n) if n <= 0.0 => Err("Too small: expected number to be >0".into()),
        Some(n) => Ok(n as i64),
    }
}

// ---------------------------------------------------------------------------
// Body → column helpers
// ---------------------------------------------------------------------------

const SOCIAL_KEYS: [&str; 6] = ["facebook", "twitter", "instagram", "linkedin", "youtube", "tiktok"];

/// createClient/updateClient build socialLinks from the flat form fields:
/// only truthy values land in the JSON object; an empty object stores NULL.
fn social_links_from_fields(body: &Value) -> String {
    let mut map = Map::new();
    for key in SOCIAL_KEYS {
        let v = body.get(key);
        if let Some(Value::String(s)) = v {
            if !s.is_empty() {
                map.insert(key.to_string(), Value::String(s.clone()));
            }
        }
    }
    if map.is_empty() {
        "null".to_string()
    } else {
        Value::Object(map).to_string()
    }
}

/// quickAddClient stores meta.socialLinks wholesale (all ClientSocialLinks
/// keys possible — pinterest/github included): non-empty object or NULL.
fn social_links_from_meta(meta: &Value) -> String {
    match meta.get("socialLinks") {
        Some(Value::Object(m)) if !m.is_empty() => Value::Object(m.clone()).to_string(),
        _ => "null".to_string(),
    }
}

/// techStack column: array → its JSON text (drizzle text/json storage mode),
/// null/absent → NULL. Detection can legitimately yield [], which stores as
/// "[]" — parity with `JSON.stringify([])`.
fn tech_stack_json(v: Option<&Value>) -> String {
    match v {
        Some(a @ Value::Array(_)) => a.to_string(),
        _ => "null".to_string(),
    }
}

/// The same array as Option<Vec<String>> for pickStackTemplates.
fn tech_stack_names(v: Option<&Value>) -> Option<Vec<String>> {
    match v {
        Some(Value::Array(items)) => Some(
            items
                .iter()
                .filter_map(|i| i.as_str().map(|s| s.to_string()))
                .collect(),
        ),
        _ => None,
    }
}

/// Preflight verdicts from the request: [{title, evidence}] → map.
fn precheck_map(body: &Value) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some(Value::Array(items)) = body.get("precheck") {
        for item in items {
            if let (Some(title), Some(evidence)) = (
                item.get("title").and_then(|t| t.as_str()),
                item.get("evidence").and_then(|e| e.as_str()),
            ) {
                map.entry(title.to_string())
                    .or_insert_with(|| evidence.to_string());
            }
        }
    }
    map
}

// ---------------------------------------------------------------------------
// Template engine — port of src/lib/apply-task-templates.ts
// ---------------------------------------------------------------------------

/// logSkippedTemplates — "Skipped N {source} tasks this site already does:
/// title — evidence; ...", dedupe off (it is meant to accumulate).
fn log_skipped_templates(
    db: &Db,
    client_id: i64,
    source: &str,
    already_done: &[(&str, &str)],
    user_id: Option<i64>,
) {
    if already_done.is_empty() {
        return;
    }
    let lines = already_done
        .iter()
        .map(|(t, e)| format!("{t} — {e}"))
        .collect::<Vec<_>>()
        .join("; ");
    let n = already_done.len();
    let plural = if n == 1 { "" } else { "s" };
    let message =
        format!("Skipped {n} {source} task{plural} this site already does: {lines}");
    log_activity(
        db,
        &Activity {
            kind: "task.template_skipped",
            message: &message,
            level: "info",
            client_id: Some(client_id),
            entity_type: Some("client"),
            entity_id: Some(client_id),
            user_id,
            dedupe: false,
            dedupe_window_minutes: 0,
        },
    );
}

/// insertNewTemplates: split candidates by preflight verdict → log skips →
/// drop titles this client already has a task for (exact title match) →
/// insert the rest as status='todo'.
fn insert_new_templates(
    db: &Db,
    client_id: i64,
    candidates: Vec<&'static Template>,
    precheck: &HashMap<String, String>,
    source: &str,
    user_id: Option<i64>,
) -> Result<(i64, i64, i64), String> {
    if candidates.is_empty() {
        return Ok((0, 0, 0));
    }

    let mut keep: Vec<&Template> = Vec::new();
    let mut already_done: Vec<(&str, &str)> = Vec::new();
    for t in &candidates {
        match precheck.get(t.title) {
            Some(evidence) => already_done.push((t.title, evidence.as_str())),
            None => keep.push(t),
        }
    }
    log_skipped_templates(db, client_id, source, &already_done, user_id);
    if keep.is_empty() {
        return Ok((0, 0, already_done.len() as i64));
    }

    let mut select = String::from("SELECT title FROM tasks WHERE client_id = ?1 AND title IN (");
    for i in 0..keep.len() {
        if i > 0 {
            select.push(',');
        }
        select.push_str(&format!("?{}", i + 2));
    }
    select.push(')');

    let mut select_params: Vec<SqlValue> = vec![SqlValue::Integer(client_id)];
    select_params.extend(keep.iter().map(|t| SqlValue::Text(t.title.to_string())));

    let existing: HashSet<String> = db
        .with_conn(|c| {
            let mut stmt = c.prepare(&select)?;
            let rows = stmt.query_map(params_from_iter(select_params.iter()), |r| {
                r.get::<_, String>(0)
            })?;
            rows.collect::<Result<Vec<_>, _>>()
        })
        .map_err(|e| format!("template dedupe read failed: {e}"))?
        .into_iter()
        .collect();

    let to_insert: Vec<&&Template> = keep
        .iter()
        .filter(|t| !existing.contains(t.title))
        .collect();

    if !to_insert.is_empty() {
        let mut insert = String::from(
            "INSERT INTO tasks (client_id, title, description, why_it_matters, priority, status) VALUES ",
        );
        let mut bind: Vec<SqlValue> = vec![SqlValue::Integer(client_id)];
        for (i, t) in to_insert.iter().enumerate() {
            if i > 0 {
                insert.push(',');
            }
            // ?1 (client_id) is shared by every row; 4 text placeholders
            // each, 'todo' inline.
            let base = 2 + i * 4;
            insert.push_str(&format!(
                "(?1, ?{}, ?{}, ?{}, ?{}, 'todo')",
                base,
                base + 1,
                base + 2,
                base + 3
            ));
            let t = **t;
            bind.push(SqlValue::Text(t.title.to_string()));
            bind.push(SqlValue::Text(t.description.to_string()));
            bind.push(SqlValue::Text(t.why_it_matters.to_string()));
            bind.push(SqlValue::Text(t.priority.to_string()));
        }
        db.with_conn(|c| c.execute(&insert, params_from_iter(bind.iter())))
            .map_err(|e| format!("template insert failed: {e}"))?;
    }

    Ok((
        to_insert.len() as i64,
        existing.len() as i64,
        already_done.len() as i64,
    ))
}

fn apply_stack_templates(
    db: &Db,
    client_id: i64,
    detected: Option<Vec<String>>,
    precheck: &HashMap<String, String>,
    user_id: Option<i64>,
) -> Result<(i64, i64, i64), String> {
    let candidates = pick_stack_templates(detected.as_deref());
    insert_new_templates(db, client_id, candidates, precheck, "tech stack", user_id)
}

fn apply_niche_templates(
    db: &Db,
    client_id: i64,
    niche: Option<&str>,
    precheck: &HashMap<String, String>,
    user_id: Option<i64>,
) -> Result<(i64, i64, i64), String> {
    let candidates = niche_templates(niche).iter().collect();
    insert_new_templates(db, client_id, candidates, precheck, "niche", user_id)
}

// ---------------------------------------------------------------------------
// POST /api/internal/clients/create  (createClient)
// ---------------------------------------------------------------------------

pub async fn create(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);

    let name = match v_name(body.get("name")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let url = match v_url(body.get("url")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let niche = match v_niche(body.get("niche")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let logo_url = match v_opt_string(body.get("logoUrl")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let description = match v_opt_string(body.get("description")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let address = match v_opt_string(body.get("address")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let phone = match v_opt_string(body.get("phone")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let email = match v_opt_string(body.get("email")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let gbp_url = match v_opt_string(body.get("gbpUrl")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let social_links = social_links_from_fields(&body);
    let tech_stack = tech_stack_json(body.get("techStack"));
    let precheck = precheck_map(&body);
    let user_id = body.get("userId").and_then(|v| v.as_i64());

    let client_id = match state.db.with_conn(|c| {
        c.execute(
            "INSERT INTO clients (name, url, niche, tech_stack, logo_url, description, \
             address, phone, email, gbp_url, social_links) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                name,
                url,
                niche,
                tech_stack,
                logo_url,
                description,
                address,
                phone,
                email,
                gbp_url,
                social_links,
            ],
        )?;
        Ok(c.last_insert_rowid())
    }) {
        Ok(id) => id,
        Err(e) => return db_error_response(&format!("client insert failed: {e}")),
    };

    // Auto-seed niche-specific tasks first, then the tech-stack checklist —
    // the createClient order (CLAUDE.md Part 3.3, then Part 3.2 + Part 10).
    if let Err(e) = apply_niche_templates(
        &state.db,
        client_id,
        niche.as_deref(),
        &precheck,
        user_id,
    ) {
        return db_error_response(&e);
    }
    if let Err(e) = apply_stack_templates(
        &state.db,
        client_id,
        tech_stack_names(body.get("techStack")),
        &precheck,
        user_id,
    ) {
        return db_error_response(&e);
    }

    let message = format!("Added client {name} ({url}).");
    log_activity(
        &state.db,
        &Activity {
            kind: "client.created",
            message: &message,
            level: "success",
            client_id: Some(client_id),
            entity_type: Some("client"),
            entity_id: Some(client_id),
            user_id,
            dedupe: true,
            dedupe_window_minutes: 60 * 24,
        },
    );

    result_json(json!({
        "ok": true,
        "id": client_id,
        "redirect": format!("/clients/{client_id}/onboarding"),
    }))
}

// ---------------------------------------------------------------------------
// POST /api/internal/clients/quick-add  (quickAddClient DB section)
// ---------------------------------------------------------------------------

/// quickAddClient's niche inference from the detected stack.
fn infer_niche_from_stack(detected: Option<&Vec<String>>) -> Option<&'static str> {
    let names = detected?;
    let set: HashSet<String> = names.iter().map(|s| s.to_lowercase()).collect();
    if set.contains("shopify")
        || set.contains("woocommerce")
        || set.contains("magento")
        || set.contains("bigcommerce")
    {
        return Some("ecommerce");
    }
    if set.contains("ghost") || set.contains("hugo") || set.contains("jekyll") {
        return Some("blog");
    }
    None
}

/// new URL(meta.url).hostname.replace(/^www\./, ""), catch → normalized.
fn fallback_name(meta_url: &str, normalized: &str) -> String {
    url_hostname(meta_url)
        .map(|h| {
            if h.len() >= 4 && h.as_bytes()[0..4].eq_ignore_ascii_case(b"www.") {
                h[4..].to_string()
            } else {
                h
            }
        })
        .unwrap_or_else(|| normalized.to_string())
}

pub async fn quick_add(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);

    let normalized = js_string(body.get("url")).trim().to_string();
    if normalized.is_empty() {
        return bad_request("URL is required");
    }
    let meta = body.get("meta").cloned().unwrap_or(Value::Null);
    let meta_url = {
        let u = js_string(meta.get("url"));
        if u.is_empty() {
            normalized.clone()
        } else {
            u
        }
    };

    let name = match meta.get("name") {
        Some(Value::String(s)) => s.clone(),
        _ => fallback_name(&meta_url, &normalized),
    };
    let detected = tech_stack_names(body.get("techStack"));
    let niche = infer_niche_from_stack(detected.as_ref()).map(|s| s.to_string());
    let social_links = social_links_from_meta(&meta);
    let tech_stack = tech_stack_json(body.get("techStack"));
    // meta.logoUrl etc. are string|null in SiteMetadata; null → NULL column.
    let meta_text = |key: &str| -> Option<String> {
        match meta.get(key) {
            Some(Value::String(s)) => Some(s.clone()),
            _ => None,
        }
    };
    let logo_url = meta_text("logoUrl");
    let description = meta_text("description");
    let address = meta_text("address");
    let phone = meta_text("phone");
    let email = meta_text("email");
    let gbp_url = meta_text("gbpUrl");
    let precheck = precheck_map(&body);
    let user_id = body.get("userId").and_then(|v| v.as_i64());

    let client_id = match state.db.with_conn(|c| {
        c.execute(
            "INSERT INTO clients (name, url, niche, tech_stack, logo_url, description, \
             address, phone, email, gbp_url, social_links) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                name,
                meta_url,
                niche,
                tech_stack,
                logo_url,
                description,
                address,
                phone,
                email,
                gbp_url,
                social_links,
            ],
        )?;
        Ok(c.last_insert_rowid())
    }) {
        Ok(id) => id,
        Err(e) => return db_error_response(&format!("client insert failed: {e}")),
    };

    // Seed niche + tech-stack tasks, minus anything the site already does.
    if let Err(e) = apply_niche_templates(
        &state.db,
        client_id,
        niche.as_deref(),
        &precheck,
        user_id,
    ) {
        return db_error_response(&e);
    }
    if let Err(e) = apply_stack_templates(&state.db, client_id, detected, &precheck, user_id) {
        return db_error_response(&e);
    }

    let message = format!("Quick-added {name} ({meta_url}).");
    log_activity(
        &state.db,
        &Activity {
            kind: "client.created",
            message: &message,
            level: "success",
            client_id: Some(client_id),
            entity_type: Some("client"),
            entity_id: Some(client_id),
            user_id,
            dedupe: true,
            dedupe_window_minutes: 60 * 24,
        },
    );

    result_json(json!({ "ok": true, "id": client_id }))
}

// ---------------------------------------------------------------------------
// POST /api/internal/clients/:id/update  (updateClient)
// ---------------------------------------------------------------------------

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    bytes: Bytes,
) -> Response {
    let _route_id = path_id_ok(&id); // route sanity only; body.id governs (zod input)
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);

    let client_id = match v_client_id(body.get("id")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let name = match v_name(body.get("name")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let url = match v_url(body.get("url")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let niche = match v_niche(body.get("niche")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let logo_url = match v_opt_string(body.get("logoUrl")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let description = match v_opt_string(body.get("description")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let address = match v_opt_string(body.get("address")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let phone = match v_opt_string(body.get("phone")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let email = match v_opt_string(body.get("email")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let gbp_url = match v_opt_string(body.get("gbpUrl")) {
        Ok(v) => v,
        Err(e) => return bad_request(&e),
    };
    let social_links = social_links_from_fields(&body);
    let user_id = body.get("userId").and_then(|v| v.as_i64());

    if let Err(e) = state.db.with_conn(|c| {
        c.execute(
            "UPDATE clients SET name = ?2, url = ?3, niche = ?4, logo_url = ?5, \
             description = ?6, address = ?7, phone = ?8, email = ?9, gbp_url = ?10, \
             social_links = ?11, updated_at = ?12 WHERE id = ?1",
            params![
                client_id,
                name,
                url,
                niche,
                logo_url,
                description,
                address,
                phone,
                email,
                gbp_url,
                social_links,
                now_secs(),
            ],
        )
    }) {
        return db_error_response(&format!("client update failed: {e}"));
    }

    // Reuses "client.created" for now since edit isn't a kind — the comment
    // (and the kind) are copied from the action.
    let message = format!("Updated client {name}.");
    log_activity(
        &state.db,
        &Activity {
            kind: "client.created",
            message: &message,
            level: "info",
            client_id: Some(client_id),
            entity_type: Some("client"),
            entity_id: Some(client_id),
            user_id,
            dedupe: true,
            dedupe_window_minutes: 60 * 24,
        },
    );

    result_json(json!({
        "ok": true,
        "id": client_id,
        "redirect": format!("/clients/{client_id}"),
    }))
}

// ---------------------------------------------------------------------------
// POST /api/internal/clients/:id/delete  (deleteClient)
// ---------------------------------------------------------------------------

pub async fn delete(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    match path_id_ok(&id) {
        Some(client_id) => {
            // The action deletes only the clients row — related rows go via
            // the schema's ON DELETE cascade (PRAGMA foreign_keys=ON, set in
            // Db::open to match the better-sqlite3 driver).
            match state
                .db
                .with_conn(|c| c.execute("DELETE FROM clients WHERE id = ?1", params![client_id]))
            {
                Ok(_) => result_json(json!({ "ok": true, "redirect": "/clients" })),
                Err(e) => db_error_response(&format!("client delete failed: {e}")),
            }
        }
        // NaN/non-positive id: the drizzle delete bound NULL and matched
        // nothing, then still redirected — same here.
        None => result_json(json!({ "ok": true, "redirect": "/clients" })),
    }
}

// ---------------------------------------------------------------------------
// POST /api/internal/clients/:id/redetect-stack  (redetectTechStack)
// ---------------------------------------------------------------------------

pub async fn redetect_stack(
    State(state): State<AppState>,
    Path(id): Path<String>,
    bytes: Bytes,
) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let Some(client_id) = path_id_ok(&id) else {
        return ok_json(json!({ "noop": true }));
    };
    // Existence check mirrors `if (!client) return;` — the action loads the
    // client first and silently no-ops when it is gone.
    let exists: Option<i64> = state
        .db
        .with_conn(|c| {
            c.query_row(
                "SELECT id FROM clients WHERE id = ?1 LIMIT 1",
                params![client_id],
                |r| r.get(0),
            )
            .optional()
        })
        .ok()
        .flatten();
    if exists.is_none() {
        return ok_json(json!({ "noop": true }));
    }

    // The Next proxy runs detectTechStack (needs TLS — no HTTP client here)
    // and posts the detected names; on detection failure it does not call,
    // so an absent/invalid array is a caller error rather than a wipe.
    let tech_stack = match tech_stack_names(body.get("technologies")) {
        Some(names) => Value::Array(names.into_iter().map(Value::String).collect()).to_string(),
        None => return bad_request("technologies must be an array of names"),
    };

    if let Err(e) = state.db.with_conn(|c| {
        c.execute(
            "UPDATE clients SET tech_stack = ?2, updated_at = ?3 WHERE id = ?1",
            params![client_id, tech_stack, now_secs()],
        )
    }) {
        return db_error_response(&format!("tech stack update failed: {e}"));
    }

    // No activity entry — the action has none (verified against source).
    ok_json(json!({}))
}

// ---------------------------------------------------------------------------
// POST /api/internal/clients/:id/apply-templates  (applyStackTemplates /
// applyNicheTemplates)
// ---------------------------------------------------------------------------

pub async fn apply_templates(
    State(state): State<AppState>,
    Path(id): Path<String>,
    bytes: Bytes,
) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let Some(client_id) = path_id_ok(&id) else {
        return ok_json(json!({ "noop": true }));
    };
    let kind = js_string(body.get("kind"));
    if kind != "stack" && kind != "niche" {
        return bad_request("Invalid input");
    }

    let row: Option<(Option<String>, Option<String>)> = state
        .db
        .with_conn(|c| {
            c.query_row(
                "SELECT niche, tech_stack FROM clients WHERE id = ?1 LIMIT 1",
                params![client_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
        })
        .ok()
        .flatten();
    let Some((niche, tech_stack_col)) = row else {
        // `if (!client) return;` — silent no-op.
        return ok_json(json!({ "noop": true }));
    };

    let precheck = precheck_map(&body);
    let user_id = body.get("userId").and_then(|v| v.as_i64());

    let result = match kind.as_str() {
        "stack" => {
            // Drizzle text/json storage mode: the column is a JSON array
            // (possibly "[]"), or NULL.
            let detected: Option<Vec<String>> = tech_stack_col
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok());
            apply_stack_templates(&state.db, client_id, detected, &precheck, user_id)
        }
        _ => {
            apply_niche_templates(&state.db, client_id, niche.as_deref(), &precheck, user_id)
        }
    };

    match result {
        Ok((added, skipped, already_done)) => result_json(json!({
            "ok": true,
            "added": added,
            "skipped": skipped,
            "alreadyDone": already_done,
        })),
        Err(e) => db_error_response(&e),
    }
}

// ---------------------------------------------------------------------------
// POST /api/internal/clients/:id/share-token  (generateShareToken /
// revokeShareToken)
// ---------------------------------------------------------------------------

/// 24 random bytes → 32 chars base64 with +→- and /→_ (padding can't occur
/// at 32 chars, but the strip is kept for exactness with the source).
fn generate_token() -> String {
    use base64::Engine;
    let mut buf = [0u8; 24];
    rand::Rng::fill(&mut rand::thread_rng(), &mut buf);
    base64::engine::general_purpose::STANDARD
        .encode(buf)
        .replace('+', "-")
        .replace('/', "_")
        .trim_end_matches('=')
        .to_string()
}

pub async fn share_token(
    State(state): State<AppState>,
    Path(id): Path<String>,
    bytes: Bytes,
) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let Some(client_id) = path_id_ok(&id) else {
        return ok_json(json!({ "noop": true }));
    };
    match js_string(body.get("action")).as_str() {
        "generate" => {
            // Up to 5 attempts; every failure just increments the counter
            // in the original loop.
            for _ in 0..5 {
                let token = generate_token();
                match state.db.with_conn(|c| {
                    c.execute(
                        "UPDATE clients SET share_token = ?2, updated_at = ?3 WHERE id = ?1",
                        params![client_id, token, now_secs()],
                    )
                }) {
                    Ok(_) => return ok_json(json!({})),
                    Err(_) => continue,
                }
            }
            db_error_response("share token generation failed after 5 attempts")
        }
        "revoke" => match state.db.with_conn(|c| {
            c.execute(
                "UPDATE clients SET share_token = NULL, updated_at = ?2 WHERE id = ?1",
                params![client_id, now_secs()],
            )
        }) {
            Ok(_) => ok_json(json!({})),
            Err(e) => db_error_response(&format!("share token revoke failed: {e}")),
        },
        _ => bad_request("Invalid input"),
    }
}
