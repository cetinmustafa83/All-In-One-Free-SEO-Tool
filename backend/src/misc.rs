//! Misc open endpoints + edge worker contract — Task 14.3.
//! Ports: /api/health-ping, /api/errors/env, /api/edge/fixes (+ lib/edge-fixes.ts, lib/edge-token.ts).

use crate::auth;
use crate::db::Db;
use crate::error;
use crate::util::*;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Map, Value};

// ---------- GET /api/health-ping ----------
// Next side-effect (writing .seo-port for the launcher) stays Node-side;
// the response shape is the contract.
pub async fn health_ping() -> Response {
    Json(json!({ "ok": true, "t": now_ms() })).into_response()
}

// ---------- GET /api/errors/env ----------
fn git_commit() -> Option<String> {
    std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir("..")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

fn package_version() -> Option<String> {
    let raw = std::fs::read_to_string("../package.json").ok()?;
    serde_json::from_str::<Value>(&raw)
        .ok()?
        .get("version")?
        .as_str()
        .map(String::from)
}

fn node_version() -> Option<String> {
    std::process::Command::new("node")
        .arg("-v")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

fn os_release() -> String {
    std::fs::read_to_string("/proc/sys/kernel/osrelease")
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

pub async fn errors_env() -> Response {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    Json(json!({
        "version": package_version(),
        "commit": git_commit(),
        "node": node_version(),
        "platform": format!("{} {}", std::env::consts::OS, os_release()),
        "arch": arch,
        "mode": std::env::var("NODE_ENV").unwrap_or_else(|_| "unknown".into()),
    }))
    .into_response()
}

// ---------- GET /api/edge/fixes ----------
/// lib/edge-token.ts edgeTokenMatches: constant-time, false when unset.
/// The alternative — "no token set" meaning "allow anything" — is the
/// auth bug that ships most often; the Node comment says exactly this.
fn edge_token_matches(db: &Db, candidate: &str) -> bool {
    if candidate.is_empty() {
        return false;
    }
    let stored_raw: Option<String> = db
        .with_conn(|c| {
            use rusqlite::OptionalExtension;
            c.query_row(
                "SELECT value FROM workspace_settings WHERE key = 'edge.token'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()
        })
        .ok()
        .flatten();
    let Some(raw) = stored_raw else { return false };
    // settings-store JSON-stringifies values; getSetting parses them back.
    let stored: String = serde_json::from_str::<String>(&raw).unwrap_or(raw);
    if stored.is_empty() {
        return false;
    }
    // constantTimeEqual: hash both to fixed width on length mismatch so the
    // compare never leaks a length signal.
    if candidate.len() == stored.len() {
        auth::ct_eq(candidate.as_bytes(), stored.as_bytes())
    } else {
        auth::ct_eq(
            auth::sha256_hex(candidate).as_bytes(),
            auth::sha256_hex(&stored).as_bytes(),
        )
    }
}

const KIND_TO_FIELD: [(&str, &str); 4] = [
    ("write_title", "title"),
    ("write_meta_description", "meta_description"),
    ("write_canonical", "canonical"),
    ("write_social_meta", "og_title"),
];

/// isLiveFix: head-tag kinds only, status applied or verified.
/// "reverted" is the one that matters — a taken-back fix must stop being
/// served, or undo appears to work while the edge keeps the old value.
fn is_live_fix(kind: &str, status: &str) -> Option<&'static str> {
    if status != "applied" && status != "verified" {
        return None;
    }
    KIND_TO_FIELD
        .iter()
        .find(|(k, _)| *k == kind)
        .map(|(_, f)| *f)
}

/// pathOf: URL → pathname+search (fragment dropped); a string that is
/// already a path passes through as-is ("/blog" and "/blog/" stay distinct).
fn path_of(url: &str) -> Option<String> {
    if let Some(rest) = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
    {
        let auth_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
        let tail = &rest[auth_end..];
        let (path_q, _) = tail.split_once('#').unwrap_or((tail, ""));
        let path = if path_q.starts_with('/') || path_q.starts_with('?') {
            path_q.to_string()
        } else {
            format!("/{path_q}")
        };
        return Some(path);
    }
    url.starts_with('/').then(|| url.to_string())
}

/// buildFixSet: newest first, first value per path+field wins; og_title
/// also carries twitter_title (written together by the agent).
fn build_fix_set(rows: &[(i64, String, String, String)]) -> Value {
    let mut pages: Map<String, Value> = Map::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut count = 0i64;
    for (_id, kind, target_url, after_value) in rows {
        let Some(field) = KIND_TO_FIELD
            .iter()
            .find(|(k, _)| k == kind)
            .map(|(_, f)| *f)
        else {
            continue;
        };
        let Some(path) = path_of(target_url) else { continue };
        let key = format!("{path}\u{0}{field}");
        if !seen.insert(key) {
            continue;
        }
        let page = pages
            .entry(path.clone())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Value::Object(obj) = page {
            obj.insert(field.to_string(), Value::String(after_value.clone()));
        }
        count += 1;
        if field == "og_title" {
            if let Value::Object(obj) = page {
                obj.insert("twitter_title".into(), Value::String(after_value.clone()));
            }
            count += 1;
        }
    }
    json!({ "pages": Value::Object(pages), "generatedAt": now_iso(), "count": count })
}

pub async fn edge_fixes(
    State(state): State<crate::AppState>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    let client = qparam(uri.query(), "client")
        .and_then(|s| js_number(Some(s)))
        .map(|f| f as i64);
    match client {
        Some(c) if c > 0 => {}
        _ => return error::api_error(StatusCode::BAD_REQUEST, error::MSG_CLIENT_REQUIRED),
    }
    // lib: auth.replace(/^Bearer\s+/i, "").trim() — case-insensitive scheme,
    // REQUIRED whitespace separator, anchored at start; else unchanged.
    let auth_header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let token = if auth_header.len() >= 6
        && auth_header[..6].eq_ignore_ascii_case("bearer")
        && auth_header[6..].starts_with(char::is_whitespace)
    {
        auth_header[6..].trim()
    } else {
        auth_header.trim()
    };
    if !edge_token_matches(&state.db, token) {
        // Nothing about the client id may leak to an unauthenticated caller.
        return error::api_error(StatusCode::UNAUTHORIZED, error::MSG_UNAUTHORIZED);
    }
    let rows = state.db.with_conn(|c| {
        let mut stmt = c.prepare(
            "SELECT id, kind, status, target_url, after_value FROM agent_actions \
             WHERE client_id = ?1 AND after_value IS NOT NULL \
             ORDER BY id DESC LIMIT 5000",
        )?;
        let list = stmt
            .query_map([client.unwrap()], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(list)
    });
    match rows {
        Ok(list) => {
            let live: Vec<(i64, String, String, String)> = list
                .into_iter()
                .filter(|(_, kind, status, url, val)| {
                    is_live_fix(kind, status).is_some() && url.is_some() && val.is_some()
                })
                .map(|(id, kind, _s, url, val)| (id, kind, url.unwrap(), val.unwrap()))
                .collect();
            let body = build_fix_set(&live);
            let mut resp = Json(body).into_response();
            if let Ok(v) = "public, max-age=60".parse() {
                resp.headers_mut().insert("cache-control", v);
            }
            resp
        }
        // graceful-empty: a 200 keeps the worker's cache warm instead of
        // hammering a struggling origin.
        Err(_) => Json(json!({ "pages": {}, "generatedAt": now_iso(), "count": 0 })).into_response(),
    }
}
