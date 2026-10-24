//! Backlinks domain — Task 14.5a. Port of src/app/backlinks/actions.ts:
//! addBacklink, setBacklinkStatus, deleteBacklink, logBuiltLink (including
//! the auto short-link creation ported from lib/short-links.ts
//! findUniqueSlug/generateSlug) and importAhrefsBacklinks (chunked insert,
//! sourceUrl dedupe). Validation replicates the zod v4 messages probed
//! from the installed zod (see worklog).

use crate::internal::{
    is_url, json_number, log_activity, ok_json, result_json, url_hostname, Activity,
};
use crate::util::now_secs;
use crate::AppState;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::response::Response;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

// ---------------------------------------------------------------------------
// zod v4 replica helpers (message-for-message, schema order = precedence)
// ---------------------------------------------------------------------------

fn err_nan() -> String {
    "Invalid input: expected number, received NaN".into()
}

fn v_client_id(v: Option<&Value>) -> Result<f64, String> {
    match json_number(v) {
        None => Err(err_nan()),
        Some(n) if n.is_nan() => Err(err_nan()),
        Some(n) if n.fract() != 0.0 => Err("Invalid input: expected int, received number".into()),
        Some(n) if n <= 0.0 => Err("Too small: expected number to be >0".into()),
        Some(n) => Ok(n),
    }
}

/// Number(v) && 0 <= n <= 100 — with the union fallback "Invalid input"
/// when coercion lands on NaN ('x' → NaN fails all three union branches).
fn v_domain_authority(v: Option<&Value>) -> Result<Option<f64>, String> {
    match v {
        None => Ok(None),
        Some(Value::Null) => Ok(None), // absent-equivalent for direct callers
        Some(_) => match json_number(v) {
            None => Err("Invalid input".into()),
            Some(n) if n.is_nan() => Err("Invalid input".into()),
            Some(n) if n < 0.0 => Err("Too small: expected number to be >=0".into()),
            Some(n) if n > 100.0 => Err("Too big: expected number to be <=100".into()),
            Some(n) => Ok(Some(n)),
        },
    }
}

/// z.string().trim() (+optional max) — non-strings fail the union with the
/// generic zod v4 message.
fn v_trim_optional(v: Option<&Value>, max: Option<usize>) -> Result<Option<String>, String> {
    match v {
        None => Ok(None),
        Some(Value::String(s)) => {
            let t = s.trim();
            if let Some(m) = max {
                if t.chars().count() > m {
                    return Err(format!("Too big: expected string to have <={m} characters"));
                }
            }
            Ok(Some(t.to_string()))
        }
        Some(_) => Err("Invalid input".into()),
    }
}

/// z.string().trim().min(1).transform(prepend https).pipe(url) with the
/// zod union fallback for "" handled by the CALLER (addBacklink keeps "",
/// logBuiltLink turns "" into undefined via the literal branch).
fn v_url(v: Option<&Value>) -> Result<String, String> {
    match v {
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.is_empty() {
                return Err("Too small: expected string to have >=1 character".into());
            }
            let lower = t.to_ascii_lowercase();
            let normalized = if lower.starts_with("http://") || lower.starts_with("https://") {
                t.to_string()
            } else {
                format!("https://{t}")
            };
            if is_url(&normalized) {
                Ok(normalized)
            } else {
                Err("Invalid URL".into())
            }
        }
        None => Err("Invalid input: expected string, received undefined".into()),
        Some(Value::Number(_)) => Err("Invalid input: expected string, received number".into()),
        Some(Value::Bool(_)) => Err("Invalid input: expected string, received boolean".into()),
        Some(_) => Err("Invalid input".into()), // union fallback
    }
}

fn add_result(id: i64) -> Response {
    result_json(json!({ "ok": true, "id": id }))
}

fn fail(e: String) -> Response {
    result_json(json!({ "ok": false, "error": e }))
}

// ---------------------------------------------------------------------------
// POST /api/internal/backlinks/add  (addBacklink)
// ---------------------------------------------------------------------------

pub async fn add(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);

    let client_id = match v_client_id(body.get("clientId")) {
        Ok(n) => n as i64,
        Err(e) => return fail(e),
    };
    let source_url = match v_url(body.get("sourceUrl")) {
        Ok(s) => s,
        Err(e) => return fail(e),
    };
    // targetUrl: z.string().trim().optional().or(literal("")) — "" passes
    // the LEFT branch, so it stays "" (unlike logBuiltLink's min-1 chain).
    let target_url = match v_trim_optional(body.get("targetUrl"), None) {
        Ok(v) => v,
        Err(e) => return fail(e),
    };
    let anchor_text = match v_trim_optional(body.get("anchorText"), Some(200)) {
        Ok(v) => v,
        Err(e) => return fail(e),
    };
    let domain_authority = match v_domain_authority(body.get("domainAuthority")) {
        Ok(v) => v,
        Err(e) => return fail(e),
    };
    let notes = match v_trim_optional(body.get("notes"), Some(500)) {
        Ok(v) => v,
        Err(e) => return fail(e),
    };

    let Some(source_domain) = url_hostname(&source_url)
        .map(|h| h.strip_www())
    else {
        return fail("Invalid URL".into());
    };

    let insert = state.db.with_conn(|c| {
        c.execute(
            "INSERT INTO backlinks (client_id, source_url, source_domain, target_url, \
             anchor_text, domain_authority, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![client_id, source_url, source_domain, target_url, anchor_text,
                    domain_authority, notes],
        )?;
        Ok(c.last_insert_rowid())
    });
    match insert {
        Ok(id) => add_result(id),
        Err(e) => fail(e.to_string()),
    }
}

trait StripWww {
    fn strip_www(self) -> String;
}
impl StripWww for String {
    // .replace(/^www\./i, "") — case-insensitive, first occurrence
    fn strip_www(self) -> String {
        if self.len() >= 4 && self.as_bytes()[0..4].eq_ignore_ascii_case(b"www.") {
            self[4..].to_string()
        } else {
            self
        }
    }
}

// ---------------------------------------------------------------------------
// POST /api/internal/backlinks/:id/status  (setBacklinkStatus)
// ---------------------------------------------------------------------------

pub async fn status(State(state): State<AppState>, Path(id): Path<String>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let backlink_id = json_number(Some(&Value::String(id)));
    let st = crate::util::js_string(body.get("status"));
    if let Some(id) = backlink_id {
        // The action sets status/updatedAt unconditionally — no validity
        // guard, no existence check; a NaN id binds as NULL and matches
        // nothing, same effect here.
        let _ = state.db.with_conn(|c| {
            c.execute(
                "UPDATE backlinks SET status = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, st, now_secs()],
            )
        });
    }
    ok_json(json!({}))
}

// ---------------------------------------------------------------------------
// POST /api/internal/backlinks/:id/delete  (deleteBacklink)
// ---------------------------------------------------------------------------

pub async fn delete(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let backlink_id = json_number(Some(&Value::String(id)));
    if let Some(id) = backlink_id {
        let _ = state
            .db
            .with_conn(|c| c.execute("DELETE FROM backlinks WHERE id = ?1", params![id]));
    }
    ok_json(json!({}))
}

// ---------------------------------------------------------------------------
// POST /api/internal/backlinks/log-built  (logBuiltLink)
// ---------------------------------------------------------------------------

const METHODS: [&str; 10] = [
    "guest_post",
    "outreach",
    "citation",
    "broken_link",
    "resource_page",
    "directory",
    "social_profile",
    "podcast",
    "interview",
    "other",
];

const RELS: [&str; 4] = ["dofollow", "nofollow", "ugc", "sponsored"];

fn v_method(v: Option<&Value>) -> Result<String, String> {
    match v {
        // raw uses `formData.get("method") || "other"` — absent → "other"
        None => Ok("other".into()),
        Some(Value::String(s)) if METHODS.contains(&s.as_str()) => Ok(s.clone()),
        Some(_) => Err(format!(
            "Invalid option: expected one of {}",
            METHODS
                .iter()
                .map(|m| format!("\"{m}\""))
                .collect::<Vec<_>>()
                .join("|")
        )),
    }
}

/// z.enum([...]).optional().or(literal("")) — "" → undefined via the right
/// branch; invalid values → generic union message.
fn v_rel(v: Option<&Value>) -> Result<Option<String>, String> {
    match v {
        None => Ok(None),
        Some(Value::String(s)) if s.is_empty() => Ok(None),
        Some(Value::String(s)) if RELS.contains(&s.as_str()) => Ok(Some(s.clone())),
        Some(_) => Err("Invalid input".into()),
    }
}

/// new Date(placedAt) — the shapes the action actually receives from the
/// HTML date input / browsers: YYYY-MM-DD (UTC midnight), RFC3339 with
/// offset, and local date-times (this install runs TZ=UTC, where local
/// equals UTC). Unparseable → NULL, matching NaN → NULL binding in
/// better-sqlite3 (verified against the project's own driver).
fn js_parse_date(s: &str) -> Option<i64> {
    // date-only form — UTC midnight per spec
    if let Ok(d) = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return d.and_hms_opt(0, 0, 0).map(|t| t.and_utc().timestamp());
    }
    // full RFC3339 with Z / ±offset
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.timestamp());
    }
    // local date-time without offset (V8 treats it as LOCAL; sandbox = UTC)
    for fmt in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%d %H:%M"] {
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, fmt) {
            return Some(dt.and_utc().timestamp());
        }
    }
    None
}

pub async fn log_built(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);

    let client_id = match v_client_id(body.get("clientId")) {
        Ok(n) => n as i64,
        Err(e) => return fail(e),
    };
    let source_url = match v_url(body.get("sourceUrl")) {
        Ok(s) => s,
        Err(e) => return fail(e),
    };
    // targetUrl for the LOG path: "" → undefined (literal branch wins
    // because the left chain's min(1) rejects ""), other strings must be
    // URLs, absent → undefined.
    let target_url = match body.get("targetUrl") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s.trim().is_empty() => None,
        Some(_) => match v_url(body.get("targetUrl")) {
            Ok(s) => Some(s),
            Err(e) => return fail(e),
        },
    };
    let anchor_text = match v_trim_optional(body.get("anchorText"), Some(200)) {
        Ok(v) => v,
        Err(e) => return fail(e),
    };
    let method = match v_method(body.get("method")) {
        Ok(m) => m,
        Err(e) => return fail(e),
    };
    let rel = match v_rel(body.get("rel")) {
        Ok(v) => v,
        Err(e) => return fail(e),
    };
    let domain_authority = match v_domain_authority(body.get("domainAuthority")) {
        Ok(v) => v,
        Err(e) => return fail(e),
    };
    // placedAt: "" passes the LEFT branch (string trim), then is falsy in
    // the `parsed.data.placedAt ? new Date(...) : new Date()` ternary.
    let placed_at_raw = match v_trim_optional(body.get("placedAt"), None) {
        Ok(v) => v,
        Err(e) => return fail(e),
    };
    let notes = match v_trim_optional(body.get("notes"), Some(500)) {
        Ok(v) => v,
        Err(e) => return fail(e),
    };

    let Some(source_domain) = url_hostname(&source_url).map(|h| h.strip_www()) else {
        return fail("Invalid URL".into());
    };

    // Invalid date strings → NULL (NaN → NULL binding, verified on the
    // project's better-sqlite3); absent/empty → now.
    let placed_date: Option<i64> = match &placed_at_raw {
        Some(s) if !s.is_empty() => js_parse_date(s),
        _ => Some(now_secs()),
    };

    let insert = state.db.with_conn(|c| {
        c.execute(
            "INSERT INTO backlinks (client_id, source_url, source_domain, target_url, \
             anchor_text, domain_authority, notes, source, method, rel, placed_at, \
             first_seen, last_seen) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'manual', ?8, ?9, ?10, ?10, ?10)",
            params![client_id, source_url, source_domain, target_url, anchor_text,
                    domain_authority, notes, method, rel, placed_date],
        )?;
        Ok(c.last_insert_rowid())
    });
    let row_id = match insert {
        Ok(id) => id,
        Err(e) => return fail(e.to_string()),
    };

    // Auto-create a short link when a target URL was provided — port of
    // the `await import("@/lib/short-links")` block, errors swallowed
    // exactly like its try/catch.
    let mut short_slug: Option<String> = None;
    if target_url.is_some() {
        let target = target_url.clone().unwrap();
        let attempt = (|| -> rusqlite::Result<String> {
            let slug = find_unique_slug(&state)?;
            state.db.with_conn(|c| {
                c.execute(
                    "INSERT INTO short_links (client_id, slug, destination, label, \
                     utm_source, utm_medium, utm_campaign) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        client_id,
                        slug,
                        target,
                        format!("Auto: {source_domain}"),
                        source_domain,
                        "backlink",
                        format!("link-build-{method}"),
                    ],
                )
            })?;
            Ok(slug)
        })();
        if let Ok(slug) = attempt {
            // notes: (notes ?? "") + (notes ? "\n" : "") + "Tracking: /r/slug"
            let prefix = match &notes {
                Some(n) if !n.is_empty() => format!("{n}\n"),
                _ => notes.clone().unwrap_or_default(),
            };
            let new_notes = format!("{prefix}Tracking: /r/{slug}");
            let _ = state.db.with_conn(|c| {
                c.execute(
                    "UPDATE backlinks SET notes = ?2 WHERE id = ?1",
                    params![row_id, new_notes],
                )
            });
            short_slug = Some(slug);
        }
    }

    log_activity(
        &state.db,
        &Activity {
            kind: "task.completed",
            message: &format!(
                "Logged link from {source_domain} (method: {method}){}",
                short_slug
                    .as_ref()
                    .map(|s| format!(" · short link /r/{s}"))
                    .unwrap_or_default()
            ),
            level: "success",
            client_id: Some(client_id),
            entity_type: Some("backlink"),
            entity_id: Some(row_id),
            user_id: body.get("userId").and_then(|v| v.as_i64()),
            dedupe: true,
            dedupe_window_minutes: 60 * 24,
        },
    );

    add_result(row_id)
}

/// Port of generateSlug: random bytes mapped through the no-confusion
/// alphabet with the same `% len` bias.
fn generate_slug(length: usize) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let mut out = String::new();
    for _ in 0..length {
        out.push(ALPHABET[(rng.gen::<u8>() % ALPHABET.len() as u8) as usize] as char);
    }
    out
}

/// Port of findUniqueSlug: 6 attempts growing from 6 to 8 chars, then a
/// 10-char fallback.
fn find_unique_slug(state: &AppState) -> rusqlite::Result<String> {
    for attempt in 0..6 {
        let slug = generate_slug(6 + attempt / 2);
        let existing: Option<i64> = state.db.with_conn(|c| {
            c.query_row(
                "SELECT id FROM short_links WHERE slug = ?1 LIMIT 1",
                params![slug],
                |r| r.get(0),
            )
            .optional()
        })?;
        if existing.is_none() {
            return Ok(slug);
        }
    }
    Ok(generate_slug(10))
}

// ---------------------------------------------------------------------------
// POST /api/internal/backlinks/import-ahrefs  (importAhrefsBacklinks)
// ---------------------------------------------------------------------------

/// The backlinks parseCsv variant: lone \r terminates a row here (the
/// keywords variant skips it — ported separately on purpose).
fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut cur: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut in_quote = false;
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        let c = chars[i];
        if in_quote {
            if c == '"' {
                if i + 1 < chars.len() && chars[i + 1] == '"' {
                    field.push('"');
                    i += 1;
                } else {
                    in_quote = false;
                }
            } else {
                field.push(c);
            }
        } else {
            match c {
                '"' => in_quote = true,
                ',' => cur.push(std::mem::take(&mut field)),
                '\n' | '\r' => {
                    if c == '\r' && i + 1 < chars.len() && chars[i + 1] == '\n' {
                        i += 1;
                    }
                    cur.push(std::mem::take(&mut field));
                    rows.push(std::mem::take(&mut cur));
                }
                _ => field.push(c),
            }
        }
        i += 1;
    }
    if !field.is_empty() || !cur.is_empty() {
        cur.push(field);
        rows.push(cur);
    }
    rows
}

/// u.trim().toLowerCase().replace(/\/$/, "") — ONE trailing slash only.
fn normalize_url(u: &str) -> String {
    let t = u.trim().to_lowercase();
    match t.strip_suffix('/') {
        Some(s) => s.to_string(),
        None => t,
    }
}

fn find_column(header: &[String], needles: &[&str]) -> i64 {
    for n in needles {
        if let Some(i) = header.iter().position(|h| h == n) {
            return i as i64;
        }
    }
    -1
}

pub async fn import_ahrefs(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);

    let client_id = match json_number(body.get("clientId")) {
        Some(n) if n.is_finite() && n > 0.0 => n as i64,
        _ => return fail("Invalid clientId".into()),
    };
    let csv_text = crate::util::js_string(body.get("csvText"));
    if csv_text.chars().count() < 10 {
        return fail("CSV is empty or too short".into());
    }

    let rows = parse_csv(&csv_text);
    if rows.len() < 2 {
        return fail("CSV must have a header row and at least one data row".into());
    }

    let header: Vec<String> = rows[0].iter().map(|h| h.to_lowercase().trim().to_string()).collect();
    let idx_source = find_column(&header, &["referring page url", "source url", "source"]);
    let idx_target = find_column(&header, &["target url", "target"]);
    let idx_anchor = find_column(&header, &["anchor", "anchor text"]);
    let idx_dr = find_column(&header, &["domain rating", "dr"]);

    if idx_source < 0 {
        return fail(
            "CSV is missing a 'Referring page URL' column — this doesn't look like an Ahrefs WMT export."
                .into(),
        );
    }

    // Pre-load existing source URLs for this client so we can dedup.
    let existing: Vec<String> = state
        .db
        .with_conn(|c| {
            let mut stmt = c.prepare("SELECT source_url FROM backlinks WHERE client_id = ?1")?;
            let it = stmt.query_map(params![client_id], |r| r.get::<_, String>(0))?;
            it.collect::<Result<Vec<_>, _>>()
        })
        .unwrap_or_default();
    let mut existing_set: std::collections::HashSet<String> =
        existing.iter().map(|u| normalize_url(u)).collect();

    let mut skipped = 0i64;
    let mut duplicates = 0i64;
    let mut batch: Vec<(i64, String, String, Option<String>, Option<String>, Option<f64>)> =
        Vec::new();

    let is: usize = idx_source as usize;
    for row in rows.iter().skip(1) {
        if row.is_empty() {
            continue;
        }
        let source_url_raw = row.get(is).map(|s| s.trim().to_string()).unwrap_or_default();
        if source_url_raw.is_empty() {
            skipped += 1;
            continue;
        }
        let source_url = if source_url_raw.starts_with("http") {
            source_url_raw.clone()
        } else {
            format!("https://{source_url_raw}")
        };
        let Some(source_domain) = url_hostname(&source_url).map(|h| h.strip_www()) else {
            skipped += 1;
            continue;
        };
        let norm = normalize_url(&source_url);
        if existing_set.contains(&norm) {
            duplicates += 1;
            continue;
        }
        let target_url = match idx_target {
            t if t >= 0 => row
                .get(t as usize)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            _ => None,
        };
        let anchor_text = match idx_anchor {
            a if a >= 0 => row
                .get(a as usize)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            _ => None,
        };
        let mut domain_authority: Option<f64> = None;
        if idx_dr >= 0 {
            if let Some(cell) = row.get(idx_dr as usize) {
                if !cell.is_empty() {
                    if let Some(n) = json_number(Some(&Value::String(cell.clone()))) {
                        if n.is_finite() && (0.0..=100.0).contains(&n) {
                            domain_authority = Some(n);
                        }
                    }
                }
            }
        }
        batch.push((client_id, source_url, source_domain, target_url, anchor_text, domain_authority));
        existing_set.insert(norm);
    }

    let inserted = batch.len() as i64;
    if !batch.is_empty() {
        // Insert in chunks of 500 to stay safely under SQLite limits.
        const CHUNK: usize = 500;
        for chunk in batch.chunks(CHUNK) {
            let mut sql = String::from(
                "INSERT INTO backlinks (client_id, source_url, source_domain, target_url, \
                 anchor_text, domain_authority, source) VALUES ",
            );
            for i in 0..chunk.len() {
                if i > 0 {
                    sql.push(',');
                }
                let b = i * 7;
                sql.push_str(&format!(
                    "(?{},?{},?{},?{},?{},?{},'ahrefs_wmt')",
                    b + 1,
                    b + 2,
                    b + 3,
                    b + 4,
                    b + 5,
                    b + 6
                ));
            }
            let flat: Vec<&dyn rusqlite::ToSql> = chunk
                .iter()
                .flat_map(|(cid, su, sd, tu, at, da)| {
                    let refs: [&dyn rusqlite::ToSql; 6] = [cid, su, sd, tu, at, da];
                    refs
                })
                .collect();
            if let Err(e) = state.db.with_conn(|c| c.execute(&sql, flat.as_slice())) {
                return fail(e.to_string());
            }
        }
    }

    log_activity(
        &state.db,
        &Activity {
            kind: "task.completed",
            message: &format!(
                "Ahrefs WMT import: +{inserted} new backlink{} ({duplicates} duplicates, {skipped} skipped)",
                if inserted == 1 { "" } else { "s" }
            ),
            level: "success",
            client_id: Some(client_id),
            entity_type: Some("backlink"),
            entity_id: None,
            user_id: body.get("userId").and_then(|v| v.as_i64()),
            dedupe: true,
            dedupe_window_minutes: 60 * 24,
        },
    );

    result_json(json!({
        "ok": true,
        "inserted": inserted,
        "skipped": skipped,
        "duplicates": duplicates,
    }))
}
