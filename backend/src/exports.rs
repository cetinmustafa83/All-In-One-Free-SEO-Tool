//! CSV exports — Task 14.8a (strangler-fig phase 14.8, wave 1).
//!
//! Ports the four golden-path CSV downloads from src/app/*/export.csv/route.ts
//! to `POST /api/internal/exports/*`, byte-for-byte against the original
//! implementation (golden fixtures in backend/fixtures/14.8/ — captured from
//! the Next routes BEFORE the swap and compared after):
//!
//!   clients      → clients.csv       (techStack JSON array → join("|"))
//!   competitors  → competitors.csv   (LEFT JOIN clients, no ?? "" wrappers)
//!   audits       → audits.csv        (nullable score/started/completed → "")
//!   backlinks    → backlinks.csv     (nullable client join cols → "")
//!
//! The Next routes stay at the same URLs and become thin proxies
//! (session → userId, ?clientId/?client → body) — the CSV bytes come from
//! here. Response envelope: {"ok":true,"filename","contentType",
//! "disposition","csv"}; the proxy re-wraps only the transport headers.
//!
//! Serializer parity (src/lib/csv-export.ts):
//!   * null/undefined → ""; numbers → String(n); strings pass through;
//!   * Date → Date.toISOString(): "YYYY-MM-DDTHH:MM:SS.mmmZ" (always 3
//!     millisecond digits — SQLite stores epoch SECONDS, drizzle
//!     mode:"timestamp" renders `new Date(v * 1000)`);
//!   * quote-wrap iff the value matches /[",\n\r]/ (byte scan — the four
//!     triggers are ASCII, so UTF-8 continuation bytes can never hide one),
//!     doubling `"` → `""` (RFC 4180);
//!   * cells joined "," / lines "\n", NO trailing newline, NO BOM, header
//!     row always present even for an empty result.
//!
//! Date formatting is hand-rolled (Howard Hinnant civil_from_days, ~25
//! lines) instead of chrono: byte-exact control of the JS surface — the
//! 4-digit year padding, the ±6-digit signed years outside 0..9999 and the
//! engine's per-component truncation of REAL (fractional-second) storage —
//! none of which chrono's RFC 3339 formatter guarantees.
//!
//! Scope parity (src/lib/client-scope.ts exportScope): see client_scope.rs.
//! `?clientId=` / legacy `?client=` normalization happens on the Next side
//! in TypeScript, where Number()/Number.isInteger() ARE the semantics being
//! mirrored — zero reimplementation risk. The body carries the resolved
//! meaning: absent/null = no filter, positive id = `= id`, anything else
//! (0 / negative / unparseable → the proxy's -1 sentinel) = the always-false
//! `IN (-1)` — the TS route turns every non-positive-integer Number(raw)
//! into exactly that filter ("an unparseable clientId yields an empty
//! export rather than everything").

use crate::client_scope::visible_client_ids;
use crate::internal::{db_error_response, result_json};
use crate::AppState;
use axum::body::Bytes;
use axum::extract::State;
use axum::response::Response;
use rusqlite::types::{Value as Sqv, ValueRef};
use serde_json::{json, Value};

// ---------------------------------------------------------------------------
// CSV serializer (byte-for-byte port of src/lib/csv-export.ts)
// ---------------------------------------------------------------------------

/// csvEscape: quote-wrap iff the value contains " , \n or \r; double the
/// inner quotes. The /[",\n\r]/ test is a byte scan in Rust — all four
/// trigger bytes are ASCII, and UTF-8 continuation bytes are ≥ 0x80, so a
/// multi-byte character can never contain one.
pub fn csv_escape(s: &str) -> String {
    if s.bytes()
        .any(|b| matches!(b, b'"' | b',' | b'\n' | b'\r'))
    {
        let mut out = String::with_capacity(s.len() + 2);
        out.push('"');
        for c in s.chars() {
            if c == '"' {
                out.push_str("\"\"");
            } else {
                out.push(c);
            }
        }
        out.push('"');
        out
    } else {
        s.to_string()
    }
}

/// JS `String(n)` for a float cell. Rust `{}` on f64 is shortest-round-trip
/// like JS for the plain-decimal range; JS switches to exponent notation at
/// ≥ 1e21 / < 1e-6 where Rust keeps printing digits (documented deviation —
/// no export column can hold such values today).
fn js_float(f: f64) -> String {
    format!("{f}")
}

/// JS `Array.prototype.join` element coercion (null/undefined → "", nested
/// arrays join with ",", objects → "[object Object]").
fn join_element(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Array(items) => items
            .iter()
            .map(join_element)
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// clients.techStack cell: drizzle `mode:"json"` JSON.parses the TEXT and
/// the route does `Array.isArray(v) ? v.join("|") : ""`. A non-array JSON
/// value (string/number/object) or unparsable text → "" (the route only
/// every sees valid JSON because drizzle would have thrown first).
fn tech_stack_cell(raw: Option<&str>) -> String {
    match raw.and_then(|t| serde_json::from_str::<Value>(t).ok()) {
        Some(Value::Array(items)) => items
            .iter()
            .map(join_element)
            .collect::<Vec<_>>()
            .join("|"),
        _ => String::new(),
    }
}

// ---------------------------------------------------------------------------
// Timestamps: epoch seconds → Date.toISOString()
// ---------------------------------------------------------------------------

/// Howard Hinnant civil_from_days (days since 1970-01-01 → y/m/d) — the
/// inverse of days_from_civil, valid across the whole i64 range.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (y + i64::from(m <= 2), m, d)
}

/// JS Date.toISOString() from an epoch-ms time value. `None` ⇔ the JS Date
/// would be invalid (|t| > 8.64e15 ms): toISOString throws "Invalid time
/// value" there and the original route surfaced that as a 500.
pub fn iso_from_ms(t: i64) -> Option<String> {
    if t.unsigned_abs() > 8_640_000_000_000_000 {
        return None;
    }
    let days = t.div_euclid(86_400_000);
    let sod = t.rem_euclid(86_400_000); // 0..86_399_999 (ECMA modulo: sign of divisor)
    let ms = (sod % 1000) as u32;
    let sec = sod / 1000;
    let (y, mo, d) = civil_from_days(days);
    let (hh, mm, ss) = (sec / 3600, (sec % 3600) / 60, sec % 60);
    let date = if (0..=9999).contains(&y) {
        format!("{y:04}-{mo:02}-{d:02}")
    } else {
        // JS pads the year to 6 digits with an explicit sign outside 0..9999.
        let sign = if y < 0 { '-' } else { '+' };
        format!("{sign}{:06}", y.abs())
    };
    Some(format!("{date}T{hh:02}:{mm:02}:{ss:02}.{ms:03}Z"))
}

/// Drizzle renders a REAL (fractional seconds) as `new Date(v * 1000)` and
/// the engine extracts components per ECMA: SecFromTime = ⌊t/1000⌋,
/// msFromTime = t mod 1000 (floored modulo) truncated to whole ms by the
/// engine's int cast. Rebuilding the time value from those parts matches
/// V8 for every integral-ms Date, including negatives.
fn real_to_ms(f: f64) -> i64 {
    let t = f * 1000.0;
    if !t.is_finite() {
        return i64::MAX; // Date(NaN) → invalid → throws, mirrored as 500
    }
    let secs = (t / 1000.0).floor();
    let ms = t - secs * 1000.0; // 0 ≤ ms < 1000
    (secs * 1000.0 + ms.trunc()) as i64
}

/// A timestamp column cell → CSV text. Err ⇔ the TS route would have thrown
/// (TEXT in a timestamp column: `value * 1000` → NaN → invalid Date).
fn iso_cell(v: ValueRef<'_>) -> Result<String, ()> {
    Ok(match v {
        ValueRef::Null => String::new(), // TS `r.startedAt ?? ""` family
        ValueRef::Integer(i) => i
            .checked_mul(1000)
            .and_then(iso_from_ms)
            .ok_or(())?,
        ValueRef::Real(f) => iso_from_ms(real_to_ms(f)).ok_or(())?,
        ValueRef::Text(_) => return Err(()),
        ValueRef::Blob(_) => return Err(()),
    })
}

/// A plain value cell → CSV text (csvEscape's String(value) input path).
fn cell(v: ValueRef<'_>) -> String {
    match v {
        ValueRef::Null => String::new(),
        ValueRef::Integer(i) => i.to_string(),
        ValueRef::Real(f) => js_float(f),
        ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned(),
        ValueRef::Blob(_) => String::new(),
    }
}

/// A TEXT cell → CSV text (identity; NULL → "").
fn text_cell(v: ValueRef<'_>) -> String {
    match v {
        ValueRef::Null => String::new(),
        ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned(),
        _ => cell(v),
    }
}

/// Serialize rows: escape each cell, join with ",", join lines with "\n".
/// No trailing newline, no BOM — mirrors `lines.join("\n")`.
fn render(header: &[&str], rows: Vec<Vec<String>>) -> String {
    let mut lines = Vec::with_capacity(rows.len() + 1);
    lines.push(
        header
            .iter()
            .map(|h| csv_escape(h))
            .collect::<Vec<_>>()
            .join(","),
    );
    for row in rows {
        lines.push(
            row.iter()
                .map(|c| csv_escape(c))
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    lines.join("\n")
}

fn csv_envelope(filename: &'static str, csv: String) -> Response {
    result_json(json!({
        "ok": true,
        "filename": filename,
        "contentType": "text/csv; charset=utf-8",
        "disposition": format!("attachment; filename=\"{filename}\""),
        "csv": csv,
    }))
}

// ---------------------------------------------------------------------------
// Scope → WHERE clause (exportScope port)
// ---------------------------------------------------------------------------

struct Scope {
    /// "" when unrestricted, else " WHERE cond1 AND cond2".
    where_sql: String,
    params: Vec<Sqv>,
}

/// Port of exportScope(column, req): the requested client filter
/// (`= id` for a positive integer, `IN (-1)` otherwise) AND the visibility
/// filter (`IN (ids)` / empty-assignment `IN (-1)` / nothing at all).
/// `column` is table-qualified exactly like drizzle's generated SQL.
fn build_scope(
    db: &crate::db::Db,
    column: &str,
    user_id: Option<i64>,
    client_id: Option<i64>,
) -> Scope {
    let mut conds: Vec<String> = Vec::new();
    let mut params: Vec<Sqv> = Vec::new();
    if let Some(id) = client_id {
        // TS: Number.isInteger(id) && id > 0 ? eq(column, id) : inArray(column, [-1])
        // The proxy only sends integers; a non-positive one (0 / negative /
        // its -1 sentinel for unparseable raw params) is the always-false arm.
        if id > 0 {
            conds.push(format!("{column} = ?"));
            params.push(Sqv::Integer(id));
        } else {
            conds.push(format!("{column} IN (-1)"));
        }
    }
    if let Some(ids) = visible_client_ids(db, user_id) {
        if ids.is_empty() {
            conds.push(format!("{column} IN (-1)"));
        } else {
            let list = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            conds.push(format!("{column} IN ({list})"));
            params.extend(ids.into_iter().map(Sqv::Integer));
        }
    }
    let where_sql = if conds.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conds.join(" AND "))
    };
    Scope { where_sql, params }
}

fn body_ids(body: &Value) -> (Option<i64>, Option<i64>) {
    (
        body.get("userId").and_then(Value::as_i64),
        body.get("clientId").and_then(Value::as_i64),
    )
}

fn db_fail(msg: &str) -> Response {
    db_error_response(msg)
}

/// Run one export query on the shared connection, mapping each row to its
/// CSV cells through `map_row`. Errors collapse to strings for the 500
/// envelope (bare sqlite message, or "Invalid time value" where the TS
/// route's Date.toISOString() would have thrown).
fn run_export(
    db: &crate::db::Db,
    sql: &str,
    params: &[Sqv],
    map_row: impl Fn(&rusqlite::Row<'_>) -> Result<Vec<String>, String>,
) -> Result<Vec<Vec<String>>, String> {
    let inner = db.with_conn(|c| {
        Ok((|| -> Result<Vec<Vec<String>>, String> {
            let mut stmt = c.prepare(sql).map_err(|e| e.to_string())?;
            let mut q = stmt
                .query(rusqlite::params_from_iter(params.iter()))
                .map_err(|e| e.to_string())?;
            let mut out: Vec<Vec<String>> = Vec::new();
            while let Some(r) = q.next().map_err(|e| e.to_string())? {
                out.push(map_row(r)?);
            }
            Ok(out)
        })())
    });
    inner.map_err(|e| e.to_string()).flatten()
}

// ---------------------------------------------------------------------------
// POST /api/internal/exports/clients
// ---------------------------------------------------------------------------

pub async fn clients(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let (user_id, client_id) = body_ids(&body);
    const HEADER: &[&str] = &[
        "id",
        "name",
        "url",
        "niche",
        "country",
        "city",
        "language",
        "businessType",
        "email",
        "phone",
        "address",
        "gbpUrl",
        "gscProperty",
        "ga4PropertyId",
        "techStack",
        "createdAt",
    ];
    let scope = build_scope(&state.db, "clients.id", user_id, client_id);
    let sql = format!(
        "SELECT clients.id, clients.name, clients.url, clients.niche, clients.country, \
         clients.city, clients.language, clients.business_type, clients.email, \
         clients.phone, clients.address, clients.gbp_url, clients.gsc_property, \
         clients.ga4_property_id, clients.tech_stack, clients.created_at \
         FROM clients{} ORDER BY clients.created_at DESC",
        scope.where_sql
    );
    let params = scope.params.clone();
    let rows = run_export(&state.db, &sql, &params, |r| {
        let g =
            |i: usize| -> Result<String, String> {
                Ok(cell(r.get_ref(i).map_err(|e| e.to_string())?))
            };
        let t =
            |i: usize| -> Result<String, String> {
                Ok(text_cell(r.get_ref(i).map_err(|e| e.to_string())?))
            };
        let tech = match r.get_ref(14).map_err(|e| e.to_string())? {
            ValueRef::Null => None,
            ValueRef::Text(txt) => Some(String::from_utf8_lossy(txt).into_owned()),
            other => Some(cell(other)), // non-text JSON storage: parsed below
        };
        let created = iso_cell(r.get_ref(15).map_err(|e| e.to_string())?)
            .map_err(|_| "Invalid time value".to_string())?;
        Ok(vec![
            g(0)?,
            t(1)?,
            t(2)?,
            t(3)?,
            t(4)?,
            t(5)?,
            t(6)?,
            t(7)?,
            t(8)?,
            t(9)?,
            t(10)?,
            t(11)?,
            t(12)?,
            t(13)?,
            tech_stack_cell(tech.as_deref()),
            created,
        ])
    });
    match rows {
        Ok(rows) => csv_envelope("clients.csv", render(HEADER, rows)),
        Err(msg) => db_fail(&msg),
    }
}

// ---------------------------------------------------------------------------
// POST /api/internal/exports/competitors
// ---------------------------------------------------------------------------

pub async fn competitors(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let (user_id, client_id) = body_ids(&body);
    const HEADER: &[&str] = &[
        "id", "client", "client_url", "name", "url", "notes", "created_at",
    ];
    let scope = build_scope(&state.db, "competitors.client_id", user_id, client_id);
    let sql = format!(
        "SELECT competitors.id, clients.name, clients.url, competitors.name, \
         competitors.url, competitors.notes, competitors.created_at \
         FROM competitors LEFT JOIN clients ON competitors.client_id = clients.id{} \
         ORDER BY competitors.created_at DESC",
        scope.where_sql
    );
    let params = scope.params.clone();
    let rows = run_export(&state.db, &sql, &params, |r| {
        let g =
            |i: usize| -> Result<String, String> {
                Ok(cell(r.get_ref(i).map_err(|e| e.to_string())?))
            };
        let created = iso_cell(r.get_ref(6).map_err(|e| e.to_string())?)
            .map_err(|_| "Invalid time value".to_string())?;
        Ok(vec![g(0)?, g(1)?, g(2)?, g(3)?, g(4)?, g(5)?, created])
    });
    match rows {
        Ok(rows) => csv_envelope("competitors.csv", render(HEADER, rows)),
        Err(msg) => db_fail(&msg),
    }
}

// ---------------------------------------------------------------------------
// POST /api/internal/exports/audits
// ---------------------------------------------------------------------------

pub async fn audits(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let (user_id, client_id) = body_ids(&body);
    const HEADER: &[&str] = &[
        "id",
        "clientName",
        "clientUrl",
        "kind",
        "status",
        "score",
        "issuesCount",
        "startedAt",
        "completedAt",
        "targetUrl",
    ];
    let scope = build_scope(&state.db, "audits.client_id", user_id, client_id);
    let sql = format!(
        "SELECT audits.id, clients.name, clients.url, audits.kind, audits.status, \
         audits.score, audits.issues_count, audits.started_at, audits.completed_at, \
         audits.target_url \
         FROM audits LEFT JOIN clients ON audits.client_id = clients.id{} \
         ORDER BY audits.created_at DESC",
        scope.where_sql
    );
    let params = scope.params.clone();
    let rows = run_export(&state.db, &sql, &params, |r| {
        let g =
            |i: usize| -> Result<String, String> {
                Ok(cell(r.get_ref(i).map_err(|e| e.to_string())?))
            };
        let t =
            |i: usize| -> Result<String, String> {
                Ok(text_cell(r.get_ref(i).map_err(|e| e.to_string())?))
            };
        let invalid = || "Invalid time value".to_string();
        let started = iso_cell(r.get_ref(7).map_err(|e| e.to_string())?).map_err(|_| invalid())?;
        let completed =
            iso_cell(r.get_ref(8).map_err(|e| e.to_string())?).map_err(|_| invalid())?;
        Ok(vec![
            g(0)?,
            g(1)?, // clientName ?? ""
            g(2)?, // clientUrl ?? ""
            t(3)?, // kind
            t(4)?, // status
            g(5)?, // score ?? ""
            g(6)?, // issuesCount
            started,
            completed,
            t(9)?, // targetUrl ?? ""
        ])
    });
    match rows {
        Ok(rows) => csv_envelope("audits.csv", render(HEADER, rows)),
        Err(msg) => db_fail(&msg),
    }
}

// ---------------------------------------------------------------------------
// POST /api/internal/exports/backlinks
// ---------------------------------------------------------------------------

pub async fn backlinks(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let (user_id, client_id) = body_ids(&body);
    const HEADER: &[&str] = &[
        "id",
        "clientName",
        "sourceUrl",
        "sourceDomain",
        "targetUrl",
        "anchorText",
        "domainAuthority",
        "status",
        "source",
        "notes",
        "createdAt",
    ];
    let scope = build_scope(&state.db, "backlinks.client_id", user_id, client_id);
    let sql = format!(
        "SELECT backlinks.id, clients.name, backlinks.source_url, \
         backlinks.source_domain, backlinks.target_url, backlinks.anchor_text, \
         backlinks.domain_authority, backlinks.status, backlinks.source, \
         backlinks.notes, backlinks.created_at \
         FROM backlinks LEFT JOIN clients ON backlinks.client_id = clients.id{} \
         ORDER BY backlinks.created_at DESC",
        scope.where_sql
    );
    let params = scope.params.clone();
    let rows = run_export(&state.db, &sql, &params, |r| {
        let g =
            |i: usize| -> Result<String, String> {
                Ok(cell(r.get_ref(i).map_err(|e| e.to_string())?))
            };
        let created = iso_cell(r.get_ref(10).map_err(|e| e.to_string())?)
            .map_err(|_| "Invalid time value".to_string())?;
        Ok(vec![
            g(0)?,
            g(1)?,  // clientName ?? ""
            g(2)?,  // sourceUrl
            g(3)?,  // sourceDomain
            g(4)?,  // targetUrl ?? ""
            g(5)?,  // anchorText ?? ""
            g(6)?,  // domainAuthority ?? ""
            g(7)?,  // status
            g(8)?,  // source
            g(9)?,  // notes ?? ""
            created,
        ])
    });
    match rows {
        Ok(rows) => csv_envelope("backlinks.csv", render(HEADER, rows)),
        Err(msg) => db_fail(&msg),
    }
}
