//! Query gateway — Task 14.7a (strangler-fig phase 14.7, RSC read side).
//!
//! `POST /api/internal/query` executes ONE SQLite statement on the shared
//! connection and returns rows as POSITIONAL arrays. This is the read
//! transport for the Next-side drizzle `sqlite-proxy` driver
//! (`src/lib/db-gateway.ts`): pages keep their exact drizzle query syntax
//! and drizzle core performs all row shaping (snake→camel, timestamp→Date,
//! json, boolean) from the positional values via mapResultRow — exactly the
//! mapping better-sqlite3 produced. The gateway itself is a dumb pipe.
//!
//! Trust model: the SAME 0600 local token as every other /api/internal/*
//! endpoint (internal::require_token middleware). This is not a public API
//! and not a SQL-injection surface — callers already hold the file token,
//! i.e. the same capability as reading data.db directly. Defense in depth
//! is layered anyway:
//!
//!   1. Cheap textual guard — trimmed SQL must START with select/with and
//!      may not chain (`;` followed by any non-whitespace). Read-PRAGMAs
//!      never even reach prepare (they don't start with select/with).
//!   2. Authoritative guard — `sqlite3_stmt_readonly()` via
//!      `Statement::readonly()` rejects INSERT/UPDATE/DELETE/DDL/
//!      write-PRAGMA even smuggled through `WITH ... INSERT/DELETE`,
//!      where the textual guard deliberately passes (that is its job:
//!      cheap, over-inclusive prefix check, never the last word).
//!
//! Value mapping (JSON ↔ SQLite), matching better-sqlite3/drizzle binding:
//!   params: null→NULL, bool→0/1, integral number→INTEGER, other
//!   number→REAL, string→TEXT; objects/arrays are rejected 400
//!   (better-sqlite3 throws TypeError on them too — same surface).
//!   rows: INTEGER→JSON number, REAL→number, TEXT→string, NULL→null,
//!   BLOB→base64 (standard alphabet, padded). No schema.ts column is blob
//!   today; the encoding is documented here so consumers know nothing is
//!   auto-decoded. NaN/Inf REALs (impossible in a SQLite file) → JSON null
//!   because JSON cannot carry them.

use crate::error;
use crate::internal::{bad_request, db_error_response, result_json};
use crate::AppState;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::Connection;
use serde_json::{json, Value};

const MSG_SELECT_ONLY: &str = "query gateway is SELECT-only";

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/// Cheap textual guard: trimmed SQL must start with the SELECT or WITH
/// keyword. The character after the keyword must be whitespace, `(` (e.g.
/// `select(1)`) or `*` (`select *from t` is legal compact SQLite), so
/// `selectx ...` junk falls through to prepare's syntax error (500) rather
/// than a misleading 403.
fn select_shaped(sql: &str) -> bool {
    let lower = sql.to_ascii_lowercase();
    let keyword = if lower.starts_with("select") {
        "select"
    } else if lower.starts_with("with") {
        "with"
    } else {
        return false;
    };
    match sql.get(keyword.len()..) {
        None => false, // bare keyword — never valid SQL
        Some(rest) => rest
            .chars()
            .next()
            .is_some_and(|c| c.is_whitespace() || c == '(' || c == '*'),
    }
}

/// Cheap multi-statement guard: a `;` whose remainder contains any
/// non-whitespace character means a chained statement. Trailing `;` is fine.
/// Known false positive: a `;` inside a string literal in the SQL text —
/// acceptable for a cheap first-pass guard (drizzle binds every page value
/// as a parameter, so generated SELECT text contains no literals).
fn chained_statement(sql: &str) -> bool {
    match sql.find(';') {
        Some(i) => !sql[i + 1..].trim().is_empty(),
        None => false,
    }
}

// ---------------------------------------------------------------------------
// JSON ↔ SQLite values
// ---------------------------------------------------------------------------

fn param_to_sql(v: &Value) -> Result<SqlValue, ()> {
    Ok(match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(if *b { 1 } else { 0 }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else if let Some(f) = n.as_f64() {
                SqlValue::Real(f)
            } else {
                SqlValue::Null // unreachable for serde_json numbers
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        _ => return Err(()), // objects/arrays: better-sqlite3 throws too
    })
}

fn json_from_cell(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::Number(i.into()),
        ValueRef::Real(f) => serde_json::Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => {
            use base64::Engine;
            Value::String(base64::engine::general_purpose::STANDARD.encode(b))
        }
    }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

enum QueryReject {
    /// Textual guard or sqlite3_stmt_readonly refusal → 403.
    NotSelectOnly,
    /// prepare/query failure → 500 with the bare sqlite message (same
    /// surface as the original un-caught SqliteError in pages).
    Sql(String),
}

fn execute_select(
    conn: &Connection,
    sql: &str,
    params: &[SqlValue],
) -> Result<(Vec<String>, Vec<Vec<Value>>), QueryReject> {
    // Layer 1: cheap textual guard (over-inclusive by design).
    if !select_shaped(sql) || chained_statement(sql) {
        return Err(QueryReject::NotSelectOnly);
    }
    // Layer 2: the authoritative sqlite3_stmt_readonly check.
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| QueryReject::Sql(e.to_string()))?;
    if !stmt.readonly() {
        return Err(QueryReject::NotSelectOnly);
    }
    let columns: Vec<String> = stmt
        .column_names()
        .into_iter()
        .map(String::from)
        .collect();
    let ncols = columns.len();
    let mut rows_stmt = stmt
        .query(rusqlite::params_from_iter(params.iter()))
        .map_err(|e| QueryReject::Sql(e.to_string()))?;
    let mut rows: Vec<Vec<Value>> = Vec::new();
    while let Some(row) = rows_stmt
        .next()
        .map_err(|e| QueryReject::Sql(e.to_string()))?
    {
        let mut out = Vec::with_capacity(ncols);
        for i in 0..ncols {
            let cell = row
                .get_ref(i)
                .map_err(|e| QueryReject::Sql(e.to_string()))?;
            out.push(json_from_cell(cell));
        }
        rows.push(out);
    }
    Ok((columns, rows))
}

/// POST /api/internal/query — body `{"sql": string, "params": [..]}`.
pub async fn run(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);

    // Body contract: sql non-empty string; params array (default empty).
    let Some(sql_raw) = body.get("sql").and_then(Value::as_str) else {
        return bad_request("sql must be a non-empty string.");
    };
    let sql = sql_raw.trim();
    if sql.is_empty() {
        return bad_request("sql must be a non-empty string.");
    }
    let raw_params: Vec<Value> = match body.get("params") {
        None => Vec::new(), // default empty
        Some(v) => match v.as_array() {
            Some(arr) => arr.clone(),
            None => return bad_request("params must be an array."),
        },
    };
    let mut params: Vec<SqlValue> = Vec::with_capacity(raw_params.len());
    for p in &raw_params {
        match param_to_sql(p) {
            Ok(v) => params.push(v),
            Err(()) => {
                return bad_request(
                    "params must be JSON scalars (null, bool, number, string).",
                )
            }
        }
    }

    match state.db.with_conn(|conn| Ok(execute_select(conn, sql, &params))) {
        Ok(Ok((columns, rows))) => {
            result_json(json!({ "ok": true, "columns": columns, "rows": rows }))
        }
        Ok(Err(reject)) => match reject {
            QueryReject::NotSelectOnly => {
                error::admin_error(StatusCode::FORBIDDEN, MSG_SELECT_ONLY)
            }
            QueryReject::Sql(msg) => db_error_response(&msg),
        },
        // with_conn only errs if the closure errs — it never does here —
        // but the match must stay total.
        Err(_) => db_error_response("database unavailable"),
    }
}
