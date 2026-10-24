//! Shared value/time helpers — Task 14.3.
//!
//! The Node side stores timestamps as epoch SECONDS (Drizzle
//! `mode: "timestamp"`) and renders them as ISO strings in JSON (JS Date
//! serialization). These helpers reproduce both.

use rusqlite::types::Value as Sqv;
use serde_json::{Value as Json};

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn now_secs() -> i64 {
    now_ms() / 1000
}

/// JS `Date.toISOString()`: `2026-10-24T12:00:00.000Z`.
pub fn iso_from_secs(secs: i64) -> String {
    chrono::DateTime::from_timestamp(secs, 0)
        .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        .unwrap_or_default()
}

pub fn now_iso() -> String {
    iso_from_secs(now_secs())
}

/// JS `Number(x)` semantics: `"" → 0`, junk → NaN (None here).
pub fn js_number(s: Option<&str>) -> Option<f64> {
    match s {
        None => None,
        Some("") => Some(0.0),
        Some(v) => v.trim().parse::<f64>().ok(),
    }
}

/// JS `String(x ?? "")` for JSON body values.
pub fn js_string(v: Option<&Json>) -> String {
    match v {
        None | Some(Json::Null) => String::new(),
        Some(Json::String(s)) => s.clone(),
        Some(Json::Number(n)) => n.to_string(),
        Some(Json::Bool(b)) => b.to_string(),
        Some(_) => "[object Object]".into(),
    }
}

/// SQLite value → serde_json value.
pub fn sqv_to_json(v: Sqv) -> Json {
    match v {
        Sqv::Null => Json::Null,
        Sqv::Integer(i) => Json::from(i),
        Sqv::Real(f) => Json::from(f),
        Sqv::Text(s) => Json::from(s),
        Sqv::Blob(_) => Json::Null, // none of the ported columns are blobs
    }
}

/// Epoch-seconds SQLite value → ISO string (Drizzle timestamp mode render).
pub fn sqv_to_iso(v: Sqv) -> Json {
    match v {
        Sqv::Integer(i) => Json::from(iso_from_secs(i)),
        Sqv::Null => Json::Null,
        Sqv::Text(s) => Json::from(s), // already a string in storage
        other => sqv_to_json(other),
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Col {
    /// passthrough (text/int/real)
    Raw,
    /// epoch seconds → ISO string
    Iso,
}

/// Build a JSON object from a rusqlite Row with an explicit column list.
/// Column order in the list = JSON key order = Drizzle select order.
pub fn row_json(row: &rusqlite::Row<'_>, cols: &[(&str, &str, Col)]) -> Json {
    let mut map = serde_json::Map::new();
    for (sq, json_name, kind) in cols {
        let v: Sqv = row.get(*sq).unwrap_or(Sqv::Null);
        map.insert(
            json_name.to_string(),
            match kind {
                Col::Raw => sqv_to_json(v),
                Col::Iso => sqv_to_iso(v),
            },
        );
    }
    Json::Object(map)
}

/// Parse `a=1&b=2` style query values (numeric params only — no decoding).
pub fn qparam<'a>(query: Option<&'a str>, key: &str) -> Option<&'a str> {
    query?.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then_some(v)
    })
}
