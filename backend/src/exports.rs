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

/// Generalized envelope (14.8b): same shape, caller-supplied filename and
/// content type (the disavow.txt route serves text/plain; the keywords
/// route's filename carries the current UTC date). The body key stays
/// "csv" for envelope uniformity — documented quirk, the disavow body is
/// not CSV.
fn envelope(filename: &str, content_type: &str, body: String) -> Response {
    result_json(json!({
        "ok": true,
        "filename": filename,
        "contentType": content_type,
        "disposition": format!("attachment; filename=\"{filename}\""),
        "csv": body,
    }))
}

// ---------------------------------------------------------------------------
// Bespoke keywords serializer (byte-for-byte port of the csvEscape local to
// src/app/keywords/export.csv/route.ts)
// ---------------------------------------------------------------------------

/// The keywords route declares its OWN csvEscape instead of importing the
/// canonical one: trigger class /[",\n]/ — NO \r (a lone CR cell passes
/// through unquoted, unlike csv_escape above) and no Date branch (the
/// route pre-renders timestamps to ISO strings itself).
pub fn csv_escape_bespoke(s: &str) -> String {
    if s.bytes().any(|b| matches!(b, b'"' | b',' | b'\n')) {
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

/// Serialize keywords rows: the route builds `const csvLines =
/// [header.join(",")]` — the header is joined RAW, no csvEscape pass
/// (unlike csvResponse which escapes headers; same bytes for these literal
/// headers, but the mechanism is mirrored exactly).
fn render_bespoke(header: &[&str], rows: Vec<Vec<String>>) -> String {
    let mut lines = Vec::with_capacity(rows.len() + 1);
    lines.push(header.join(","));
    for row in rows {
        lines.push(
            row.iter()
                .map(|c| csv_escape_bespoke(c))
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    lines.join("\n")
}

/// JS Date semantics on an owned ranking cell: `None` marks a value whose
/// `Date.toISOString()` would throw ("Invalid time value") — deferred to
/// render time because the TS fold stores Date objects and only VISIBLE
/// keywords ever render their winning row's checkedAt.
enum Epoch {
    Iso(String),
    Invalid,
}

fn epoch_cell(v: ValueRef<'_>) -> Epoch {
    match v {
        ValueRef::Null => Epoch::Iso(String::new()), // notNull column; drizzle null → ""
        ValueRef::Integer(i) => i
            .checked_mul(1000)
            .and_then(iso_from_ms)
            .map(Epoch::Iso)
            .unwrap_or(Epoch::Invalid),
        ValueRef::Real(f) => iso_from_ms(real_to_ms(f)).map_or(Epoch::Invalid, Epoch::Iso),
        // TEXT in a timestamp column: `value * 1000` → NaN → Invalid Date →
        // toISOString() throws RangeError at render.
        ValueRef::Text(_) | ValueRef::Blob(_) => Epoch::Invalid,
    }
}

/// Current UTC civil date, `new Date().toISOString().split("T")[0]` —
/// reuses the 14.8a epoch→ISO helper and takes the date-only part.
fn utc_today() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    match iso_from_ms(ms) {
        Some(iso) => iso.split('T').next().unwrap_or("").to_string(),
        None => String::new(),
    }
}

/// Pragmatic mirror of JS `a.localeCompare(b)` (default locale) for the
/// backlinks disavow domain sort — validated pairwise against Node's ICU on
/// a 370-string [A-Za-z0-9.-] corpus (139k ordered pairs, 0 mismatches):
///   1. primary: case-FOLD (ICU compares letters case-insensitively —
///      "a".localeCompare("B") === -1);
///   2. tertiary, per char: LOWERCASE before UPPERCASE (ICU root collation
///      orders "b" < "B"; the corpus test proves it);
///   3. original bytes (stable-sort tiebreak; JS sort is stable since
///      ES2019, Rust sort_by is stable — insertion order kept on 0).
/// Documented deviation: full ICU collation for NON-ASCII (é/ß/İ….) and for
/// exotic punctuation (ICU ranks '_' before '-' before '.', unlike ASCII
/// byte order) is NOT mirrored — realistic hostnames are ASCII with only
/// letters/digits/dots/hyphens (IDN lives in URLs as punycode), where the
/// mirror is exact. No ICU dependency is acceptable here; recorded honestly.
fn locale_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let (fa, fb) = (a.to_lowercase(), b.to_lowercase());
    if fa != fb {
        return fa.cmp(&fb);
    }
    for (ca, cb) in a.chars().zip(b.chars()) {
        let (ra, rb) = (u8::from(ca.is_uppercase()), u8::from(cb.is_uppercase()));
        if ra != rb {
            return ra.cmp(&rb);
        }
    }
    a.cmp(&b)
}

/// JS Number(value) for the reports pinned cell: drizzle's boolean column
/// maps driver values with `Number(value) === 1`, then the route does
/// `r.pinned ? "true" : "false"`.
fn js_number(v: ValueRef<'_>) -> f64 {
    match v {
        ValueRef::Null => 0.0, // Number(null) === 0
        ValueRef::Integer(i) => i as f64,
        ValueRef::Real(f) => f,
        ValueRef::Text(t) => std::str::from_utf8(t)
            .ok()
            .and_then(|s| {
                let s = s.trim(); // Number() trims whitespace
                if s.is_empty() {
                    Some(0.0)
                } else {
                    s.parse::<f64>().ok()
                }
            })
            .unwrap_or(f64::NAN),
        ValueRef::Blob(_) => 0.0, // Number(Uint8Array) === 0
    }
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
/// Returns the bare conditions so callers that AND extra terms (disavow's
/// `eq(backlinks.status, "disavow")`) can compose them in the same order
/// drizzle's `and()` produces.
fn build_scope_conds(
    db: &crate::db::Db,
    column: &str,
    user_id: Option<i64>,
    client_id: Option<i64>,
) -> (Vec<String>, Vec<Sqv>) {
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
    (conds, params)
}

fn build_scope(
    db: &crate::db::Db,
    column: &str,
    user_id: Option<i64>,
    client_id: Option<i64>,
) -> Scope {
    let (conds, params) = build_scope_conds(db, column, user_id, client_id);
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

// ---------------------------------------------------------------------------
// POST /api/internal/exports/tasks — 14.8b (src/app/tasks/export.csv/route.ts)
// ---------------------------------------------------------------------------

pub async fn tasks(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let (user_id, client_id) = body_ids(&body);
    const HEADER: &[&str] = &[
        "id",
        "client",
        "client_url",
        "title",
        "why_it_matters",
        "priority",
        "status",
        "due_date",
        "recurring",
        "estimated_minutes",
        "actual_minutes",
        "created_at",
        "updated_at",
    ];
    let scope = build_scope(&state.db, "tasks.client_id", user_id, client_id);
    let sql = format!(
        "SELECT tasks.id, clients.name, clients.url, tasks.title, \
         tasks.why_it_matters, tasks.priority, tasks.status, tasks.due_date, \
         tasks.recurring_interval, tasks.estimated_minutes, \
         tasks.actual_minutes, tasks.created_at, tasks.updated_at \
         FROM tasks LEFT JOIN clients ON tasks.client_id = clients.id{} \
         ORDER BY tasks.created_at DESC",
        scope.where_sql
    );
    let params = scope.params.clone();
    let rows = run_export(&state.db, &sql, &params, |r| {
        let g =
            |i: usize| -> Result<String, String> {
                Ok(cell(r.get_ref(i).map_err(|e| e.to_string())?))
            };
        // dueDate is a nullable timestamp column: Date → toISOString, null → ""
        let invalid = || "Invalid time value".to_string();
        let due = iso_cell(r.get_ref(7).map_err(|e| e.to_string())?)
            .map_err(|_| invalid())?;
        let created = iso_cell(r.get_ref(11).map_err(|e| e.to_string())?)
            .map_err(|_| invalid())?;
        let updated = iso_cell(r.get_ref(12).map_err(|e| e.to_string())?)
            .map_err(|_| invalid())?;
        Ok(vec![
            g(0)?,
            g(1)?, // clientName ?? "" — csvEscape(null) → ""
            g(2)?, // clientUrl ?? ""
            g(3)?, // title
            g(4)?, // whyItMatters
            g(5)?, // priority
            g(6)?, // status
            due,
            g(8)?, // recurringInterval
            g(9)?, // estimatedMinutes
            g(10)?, // actualMinutes
            created,
            updated,
        ])
    });
    match rows {
        Ok(rows) => csv_envelope("tasks.csv", render(HEADER, rows)),
        Err(msg) => db_fail(&msg),
    }
}

// ---------------------------------------------------------------------------
// POST /api/internal/exports/outreach — 14.8b
// (src/app/outreach/export.csv/route.ts)
// ---------------------------------------------------------------------------

pub async fn outreach(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let (user_id, client_id) = body_ids(&body);
    const HEADER: &[&str] = &[
        "id",
        "client",
        "client_url",
        "name",
        "email",
        "website",
        "status",
        "notes",
        "last_contacted_at",
        "created_at",
    ];
    let scope = build_scope(&state.db, "outreach_contacts.client_id", user_id, client_id);
    let sql = format!(
        "SELECT outreach_contacts.id, clients.name, clients.url, \
         outreach_contacts.name, outreach_contacts.email, \
         outreach_contacts.website, outreach_contacts.status, \
         outreach_contacts.notes, outreach_contacts.last_contacted_at, \
         outreach_contacts.created_at \
         FROM outreach_contacts LEFT JOIN clients ON outreach_contacts.client_id = clients.id{} \
         ORDER BY outreach_contacts.created_at DESC",
        scope.where_sql
    );
    let params = scope.params.clone();
    let rows = run_export(&state.db, &sql, &params, |r| {
        let g =
            |i: usize| -> Result<String, String> {
                Ok(cell(r.get_ref(i).map_err(|e| e.to_string())?))
            };
        let invalid = || "Invalid time value".to_string();
        let last = iso_cell(r.get_ref(8).map_err(|e| e.to_string())?)
            .map_err(|_| invalid())?;
        let created = iso_cell(r.get_ref(9).map_err(|e| e.to_string())?)
            .map_err(|_| invalid())?;
        Ok(vec![
            g(0)?,
            g(1)?, // clientName
            g(2)?, // clientUrl
            g(3)?, // name
            g(4)?, // email
            g(5)?, // website
            g(6)?, // status
            g(7)?, // notes
            last,
            created,
        ])
    });
    match rows {
        Ok(rows) => csv_envelope("outreach.csv", render(HEADER, rows)),
        Err(msg) => db_fail(&msg),
    }
}

// ---------------------------------------------------------------------------
// POST /api/internal/exports/reports — 14.8b
// (src/app/reports/export.csv/route.ts — pinned → "true"/"false" strings,
// pdfBytes cell count NOT the pdfBase64 payload)
// ---------------------------------------------------------------------------

pub async fn reports(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let (user_id, client_id) = body_ids(&body);
    const HEADER: &[&str] = &[
        "id",
        "clientName",
        "title",
        "template",
        "periodStart",
        "periodEnd",
        "execSummary",
        "pdfBytes",
        "pinned",
        "createdAt",
    ];
    let scope = build_scope(&state.db, "report_archives.client_id", user_id, client_id);
    let sql = format!(
        "SELECT report_archives.id, clients.name, report_archives.title, \
         report_archives.template, report_archives.period_start, \
         report_archives.period_end, report_archives.exec_summary, \
         report_archives.pdf_bytes, report_archives.pinned, \
         report_archives.created_at \
         FROM report_archives LEFT JOIN clients ON report_archives.client_id = clients.id{} \
         ORDER BY report_archives.created_at DESC",
        scope.where_sql
    );
    let params = scope.params.clone();
    let rows = run_export(&state.db, &sql, &params, |r| {
        let g =
            |i: usize| -> Result<String, String> {
                Ok(cell(r.get_ref(i).map_err(|e| e.to_string())?))
            };
        let invalid = || "Invalid time value".to_string();
        let start = iso_cell(r.get_ref(4).map_err(|e| e.to_string())?)
            .map_err(|_| invalid())?;
        let end = iso_cell(r.get_ref(5).map_err(|e| e.to_string())?)
            .map_err(|_| invalid())?;
        let created = iso_cell(r.get_ref(9).map_err(|e| e.to_string())?)
            .map_err(|_| invalid())?;
        // drizzle SQLiteBoolean.mapFromDriverValue: Number(value) === 1,
        // then `r.pinned ? "true" : "false"` — never empty, even on NULL.
        let pinned = if js_number(r.get_ref(8).map_err(|e| e.to_string())?) == 1.0 {
            "true"
        } else {
            "false"
        };
        Ok(vec![
            g(0)?,
            g(1)?, // clientName ?? ""
            g(2)?, // title
            g(3)?, // template ?? ""
            start,
            end,
            g(6)?, // execSummary ?? ""
            g(7)?, // pdfBytes ?? ""
            pinned.to_string(),
            created,
        ])
    });
    match rows {
        Ok(rows) => csv_envelope("reports.csv", render(HEADER, rows)),
        Err(msg) => db_fail(&msg),
    }
}

// ---------------------------------------------------------------------------
// POST /api/internal/exports/monitor — 14.8b
// (src/app/monitor/export.csv/route.ts — filename page-changes.csv,
// INNER JOIN monitored_pages + LEFT JOIN clients)
// ---------------------------------------------------------------------------

pub async fn monitor(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let (user_id, client_id) = body_ids(&body);
    const HEADER: &[&str] = &[
        "id",
        "client",
        "client_url",
        "page_url",
        "page_label",
        "field",
        "severity",
        "old_value",
        "new_value",
        "detected_at",
    ];
    let scope = build_scope(&state.db, "monitored_pages.client_id", user_id, client_id);
    let sql = format!(
        "SELECT page_changes.id, clients.name, clients.url, monitored_pages.url, \
         monitored_pages.label, page_changes.field, page_changes.severity, \
         page_changes.old_value, page_changes.new_value, page_changes.detected_at \
         FROM page_changes \
         INNER JOIN monitored_pages ON page_changes.monitored_page_id = monitored_pages.id \
         LEFT JOIN clients ON monitored_pages.client_id = clients.id{} \
         ORDER BY page_changes.detected_at DESC",
        scope.where_sql
    );
    let params = scope.params.clone();
    let rows = run_export(&state.db, &sql, &params, |r| {
        let g =
            |i: usize| -> Result<String, String> {
                Ok(cell(r.get_ref(i).map_err(|e| e.to_string())?))
            };
        let detected = iso_cell(r.get_ref(9).map_err(|e| e.to_string())?)
            .map_err(|_| "Invalid time value".to_string())?;
        Ok(vec![
            g(0)?,
            g(1)?, // clientName
            g(2)?, // clientUrl
            g(3)?, // url
            g(4)?, // label
            g(5)?, // field
            g(6)?, // severity
            g(7)?, // oldValue
            g(8)?, // newValue
            detected,
        ])
    });
    match rows {
        Ok(rows) => csv_envelope("page-changes.csv", render(HEADER, rows)),
        Err(msg) => db_fail(&msg),
    }
}

// ---------------------------------------------------------------------------
// POST /api/internal/exports/keywords — 14.8b
// (src/app/keywords/export.csv/route.ts — BESPOKE local csvEscape, LEFT JOIN
// clients, full keyword_rankings scan folded to the latest row per keyword,
// filename keywords-<UTC date>.csv)
// ---------------------------------------------------------------------------

/// A ranking row as stored in the fold map (owned — ValueRef borrows the
/// row). position/url are pre-rendered with csvEscape's String(value)
/// semantics (cannot fail); checkedAt keeps JS-Date semantics because only
/// the WINNING row of a VISIBLE keyword ever reaches toISOString().
struct Latest {
    position: String,
    url: String,
    checked: Epoch,
}

pub async fn keywords(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let (user_id, client_id) = body_ids(&body);
    const HEADER: &[&str] = &[
        "client",
        "client_url",
        "query",
        "country",
        "device",
        "latest_position",
        "ranking_url",
        "last_checked",
        "added",
    ];
    let scope = build_scope(&state.db, "keywords.client_id", user_id, client_id);
    let sql = format!(
        "SELECT keywords.id, keywords.query, keywords.country, keywords.device, \
         clients.name, clients.url, keywords.created_at \
         FROM keywords LEFT JOIN clients ON keywords.client_id = clients.id{} \
         ORDER BY keywords.created_at DESC",
        scope.where_sql
    );
    let params = scope.params.clone();
    let kw_rows = run_export(&state.db, &sql, &params, |r| {
        Ok(vec![
            cell(r.get_ref(0).map_err(|e| e.to_string())?),
            cell(r.get_ref(1).map_err(|e| e.to_string())?),
            cell(r.get_ref(2).map_err(|e| e.to_string())?),
            cell(r.get_ref(3).map_err(|e| e.to_string())?),
            cell(r.get_ref(4).map_err(|e| e.to_string())?), // clientName ?? ""
            cell(r.get_ref(5).map_err(|e| e.to_string())?), // clientUrl ?? ""
            match r.get_ref(6).map_err(|e| e.to_string())? {
                // createdAt is notNull; render at fold exit like iso_cell would.
                ValueRef::Integer(i) => i
                    .checked_mul(1000)
                    .and_then(iso_from_ms)
                    .ok_or_else(|| "Invalid time value".to_string())?,
                ValueRef::Real(f) => iso_from_ms(real_to_ms(f))
                    .ok_or_else(|| "Invalid time value".to_string())?,
                ValueRef::Null => String::new(),
                // TEXT in a timestamp column: `value * 1000` → NaN → the
                // route's r.createdAt.toISOString() throws RangeError → 500.
                _ => return Err("Invalid time value".to_string()),
            },
        ])
    });
    let kw_rows = match kw_rows {
        Ok(rows) => rows,
        Err(msg) => return db_fail(&msg),
    };

    // Full keyword_rankings scan (NO scope filter — the TS route queries the
    // whole table) ordered by checked_at ASC; fold into a map keeping the
    // LAST row per keyword — exactly `latest.set(r.keywordId, {...})` in an
    // ascending scan (Map.set overwrite; the winner is the last scan row,
    // so equal checked_at resolves to scan order, identically on both
    // stacks because the engine and statement shape are the same).
    let fold: Result<std::collections::HashMap<i64, Latest>, String> = state
        .db
        .with_conn(|c| {
            Ok((|| -> Result<std::collections::HashMap<i64, Latest>, String> {
            let mut stmt = c
                .prepare(
                    "SELECT keyword_id, position, url, checked_at FROM keyword_rankings                      ORDER BY keyword_rankings.checked_at",
                )
                .map_err(|e| e.to_string())?;
            let mut q = stmt.query([]).map_err(|e| e.to_string())?;
            let mut map: std::collections::HashMap<i64, Latest> = std::collections::HashMap::new();
            while let Some(r) = q.next().map_err(|e| e.to_string())? {
                let kid: i64 = r.get(0).map_err(|e| e.to_string())?;
                map.insert(
                    kid,
                    Latest {
                        position: cell(r.get_ref(1).map_err(|e| e.to_string())?),
                        url: cell(r.get_ref(2).map_err(|e| e.to_string())?),
                        checked: epoch_cell(r.get_ref(3).map_err(|e| e.to_string())?),
                    },
                );
            }
            Ok(map)
            })())
        })
        .map_err(|e| e.to_string())
        .flatten();
    let latest = match fold {
        Ok(map) => map,
        Err(msg) => return db_fail(&msg),
    };

    let mut rows: Vec<Vec<String>> = Vec::with_capacity(kw_rows.len());
    for k in &kw_rows {
        let kid: i64 = match k[0].parse() {
            Ok(v) => v,
            Err(_) => return db_fail("bad keyword id"),
        };
        let lp = latest.get(&kid);
        let invalid = || "Invalid time value".to_string();
        // lp?.checkedAt?.toISOString() ?? "" — the fold value exists but the
        // winning row's checkedAt is what renders (its own toISOString).
        let checked = match lp.map(|l| &l.checked) {
            None => String::new(), // no ranking rows at all → undefined → ""
            Some(Epoch::Iso(s)) => s.clone(),
            Some(Epoch::Invalid) => return db_fail(&invalid()),
        };
        rows.push(vec![
            k[4].clone(), // clientName ?? ""
            k[5].clone(), // clientUrl ?? ""
            k[1].clone(), // query
            k[2].clone(), // country
            k[3].clone(), // device
            lp.map(|l| l.position.clone()).unwrap_or_default(), // ?? ""
            lp.map(|l| l.url.clone()).unwrap_or_default(),      // ?? ""
            checked,
            k[6].clone(), // createdAt.toISOString()
        ]);
    }

    let filename = format!("keywords-{}.csv", utc_today());
    csv_envelope_dyn(filename, render_bespoke(HEADER, rows))
}

fn csv_envelope_dyn(filename: String, csv: String) -> Response {
    result_json(json!({
        "ok": true,
        "filename": filename,
        "contentType": "text/csv; charset=utf-8",
        "disposition": format!("attachment; filename=\"{filename}\""),
        "csv": csv,
    }))
}

// ---------------------------------------------------------------------------
// POST /api/internal/exports/disavow — 14.8b
// (src/app/backlinks/disavow.txt/route.ts — text/plain disavow file:
// status='disavow' backlinks grouped by source_domain, localeCompare-sorted
// domain blocks, first-link notes inlined with newlines collapsed)
// ---------------------------------------------------------------------------

pub async fn disavow(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let (user_id, client_id) = body_ids(&body);
    // The FILENAME is raw-query-string semantics (`?clientId=` truthiness +
    // `replace(/[^0-9]/g, "")` — "?clientId=abc" yields disavow-client-.txt),
    // so the proxy computes it in TypeScript where that regex IS the
    // semantics, and the body carries it. Default = the no-param branch.
    let filename = body
        .get("filename")
        .and_then(Value::as_str)
        .unwrap_or("disavow-all.txt")
        .to_string();

    // drizzle `and(eq(backlinks.status, "disavow"), scope)` — the scope term
    // is only present when the filter/visibility produced a condition.
    let (mut conds, mut params) = build_scope_conds(&state.db, "backlinks.client_id", user_id, client_id);
    conds.insert(0, "backlinks.status = 'disavow'".to_string());
    let sql = format!(
        "SELECT backlinks.source_domain, backlinks.notes \
         FROM backlinks LEFT JOIN clients ON backlinks.client_id = clients.id WHERE {}",
        conds.join(" AND ")
    );
    // No ORDER BY — the TS route scans without one; both stacks therefore
    // observe the engine's natural rowid scan order, which is what the
    // grouping (first-link notes) and the stable sort tie on.
    let scanned: Result<Vec<(Option<String>, Option<String>)>, String> = state
        .db
        .with_conn(|c| {
            Ok((|| -> Result<Vec<(Option<String>, Option<String>)>, String> {
            let mut stmt = c.prepare(&sql).map_err(|e| e.to_string())?;
            let mut q = stmt
                .query(rusqlite::params_from_iter(params.drain(..)))
                .map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            while let Some(r) = q.next().map_err(|e| e.to_string())? {
                let domain: Option<String> = r.get(0).map_err(|e| e.to_string())?;
                let notes: Option<String> = r.get(1).map_err(|e| e.to_string())?;
                out.push((domain, notes));
            }
            Ok(out)
            })())
        })
        .map_err(|e| e.to_string())
        .flatten();
    let rows = match scanned {
        Ok(rows) => rows,
        Err(msg) => return db_fail(&msg),
    };

    // Group by domain preserving first-encounter order. The Map key is the
    // string sourceDomain — a NULL sourceDomain makes `a.localeCompare(b)`
    // throw TypeError on the sort comparator in TS (null has no method),
    // surfaced here as the same 500.
    let mut domains: Vec<(Option<String>, String)> = Vec::new(); // (key, first link's notes)
    for (domain, notes) in &rows {
        if domains.iter().any(|(k, _)| k == domain) {
            continue; // later links only append to links[] — links[0] never changes
        }
        domains.push((domain.clone(), notes.clone().unwrap_or_default()));
    }
    if domains.iter().any(|(k, _)| k.is_none()) {
        return db_fail("Cannot read properties of null (reading 'localeCompare')");
    }

    // Sort domains alphabetically — JS localeCompare semantics (locale_cmp).
    let mut sorted = domains;
    sorted.sort_by(|(a, _), (b, _)| {
        let (sa, sb) = (
            a.as_deref().unwrap_or(""),
            b.as_deref().unwrap_or(""),
        );
        locale_cmp(sa, sb)
    });

    let mut lines: Vec<String> = vec![
        "# Google Disavow file generated by SEO tool".to_string(),
        format!("# Generated: {}", iso_from_ms(now_ms()).unwrap_or_default()),
        format!("# {} entries across {} domains", rows.len(), sorted.len()),
        "#".to_string(),
        "# Submit at: https://search.google.com/search-console/disavow-links-tool".to_string(),
        "# Only use this if you've identified clearly spammy/manipulative links.".to_string(),
        "# Most modern sites should NOT submit a disavow file unless under manual action.".to_string(),
        String::new(),
    ];
    for (domain, first_notes) in &sorted {
        // links[0]?.notes truthiness: null and "" both skip the note line.
        // `notes.replace(/[\r\n]+/g, " ")` collapses each RUN to one space.
        let notes = first_notes.as_str();
        if !notes.is_empty() {
            lines.push(format!("# {}", collapse_newlines(notes)));
        }
        lines.push(format!("domain:{}", domain.as_deref().unwrap_or("null")));
        lines.push(String::new());
    }

    envelope(&filename, "text/plain; charset=utf-8", lines.join("\n"))
}

/// `now_ms` for the `# Generated:` line — JS new Date().toISOString() of the
/// wall clock (fixture compares normalize this line; the format must match:
/// 24-char UTC ISO-8601).
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// JS `s.replace(/[\r\n]+/g, " ")` — each maximal run of CR/LF → one space.
fn collapse_newlines(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_run = false;
    for c in s.chars() {
        if c == '\r' || c == '\n' {
            if !in_run {
                out.push(' ');
                in_run = true;
            }
        } else {
            in_run = false;
            out.push(c);
        }
    }
    out
}
