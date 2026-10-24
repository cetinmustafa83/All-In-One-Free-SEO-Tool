//! /api/v1/* — public Bearer-key API. Task 14.3.
//! Ports src/app/api/v1/**/route.ts + src/lib/api-auth.ts semantics.
//! NOTE: /api/v1/clients uses the LONG 401 message; every other v1 route
//! uses plain "Unauthorized" — byte-for-byte, as in the Next sources.

use crate::auth;
use crate::error;
use crate::util::*;
use crate::AppState;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

const MSG_401_SHORT: &str = "Unauthorized";
const MSG_READ_SCOPE: &str = "Read scope required.";
const MSG_WRITE_SCOPE: &str = "Write scope required.";

struct V1Key {
    #[allow(dead_code)]
    id: i64,
    scopes: Vec<String>,
}

/// api-auth.ts authenticateRequest + requireScope + last_used_at update.
fn require_key(
    state: &AppState,
    headers: &HeaderMap,
    unauthorized_msg: &str,
    scope: &str,
    scope_denied_msg: &str,
) -> Result<V1Key, Response> {
    let Some(raw) = auth::bearer_token(headers) else {
        return Err(error::api_error(StatusCode::UNAUTHORIZED, unauthorized_msg));
    };
    if !raw.starts_with(auth::KEY_PREFIX) {
        return Err(error::api_error(StatusCode::UNAUTHORIZED, unauthorized_msg));
    }
    let hash = auth::sha256_hex(&raw);
    let now = now_secs();
    let row = state
        .db
        .with_conn(|c| {
            use rusqlite::OptionalExtension;
            c.query_row(
                "SELECT id, scopes FROM api_keys \
                 WHERE key_hash = ?1 AND revoked_at IS NULL \
                 AND (expires_at IS NULL OR expires_at > ?2) LIMIT 1",
                params![hash, now],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?)),
            )
            .optional()
        })
        .ok()
        .flatten();
    let Some((id, scopes_raw)) = row else {
        return Err(error::api_error(StatusCode::UNAUTHORIZED, unauthorized_msg));
    };
    // non-blocking last_used_at update
    let _ = state.db.with_conn(|c| {
        c.execute("UPDATE api_keys SET last_used_at = ?1 WHERE id = ?2", params![now, id])
    });
    // Drizzle text mode json: parsed array, NULL → ["read"] default
    let scopes: Vec<String> = scopes_raw
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| vec!["read".into()]);
    if !auth::scope_allows(&scopes, scope) {
        return Err(error::api_error(StatusCode::FORBIDDEN, scope_denied_msg));
    }
    Ok(V1Key { id, scopes })
}

fn ok_json(body: Value) -> Response {
    Json(body).into_response()
}

// ---------- GET /api/v1/health (+ OPTIONS) ----------
fn cors_json(body: Value) -> Response {
    let mut resp = (StatusCode::OK, Json(body)).into_response();
    let h = resp.headers_mut();
    h.insert("access-control-allow-origin", "*".parse().unwrap());
    h.insert("access-control-allow-methods", "GET, OPTIONS".parse().unwrap());
    h.insert("cache-control", "no-store".parse().unwrap());
    resp
}

/// installRoot + pid only for same-machine callers: an absolute filesystem
/// path is reconnaissance, not health.
fn v1_health_host_is_local(headers: &HeaderMap) -> bool {
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let hostname = host
        .rsplit_once(':')
        .map(|(h, _)| h) // strip :port
        .unwrap_or(&host)
        .to_lowercase();
    matches!(hostname.as_str(), "localhost" | "127.0.0.1" | "[::1]")
}

pub async fn v1_health_get(headers: HeaderMap) -> Response {
    let base = json!({
        "ok": true,
        "service": "seo-tool",
        "version": "v1",
        "time": now_iso(),
    });
    if !v1_health_host_is_local(&headers) {
        return cors_json(base);
    }
    // cwd is backend/ — the install root is the repo root above it
    let install_root = std::env::current_dir()
        .ok()
        .and_then(|p| p.join("..").canonicalize().ok())
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    cors_json(json!({ "ok": true, "service": "seo-tool", "version": "v1", "time": now_iso(),
                      "installRoot": install_root, "pid": std::process::id() }))
}

pub async fn v1_health_options() -> Response {
    axum::response::Response::builder()
        .status(StatusCode::NO_CONTENT)
        .header("access-control-allow-origin", "*")
        .header("access-control-allow-methods", "GET, OPTIONS")
        .header("access-control-allow-headers", "*")
        .header("access-control-max-age", "86400")
        .body(axum::body::Body::empty())
        .unwrap()
}

// ---------- GET /api/v1/clients ----------
pub async fn clients_list(State(state): State<AppState>, headers: HeaderMap, uri: Uri) -> Response {
    if let Err(resp) = require_key(&state, &headers, error::MSG_BEARER_REQUIRED, "read", MSG_READ_SCOPE) {
        return resp;
    }
    let limit = auth::parse_limit(qparam(uri.query(), "limit"), 50, 200);
    let rows = state.db.with_conn(|c| {
        let mut stmt = c.prepare(
            "SELECT id, name, url, niche, city, country, tech_stack, created_at \
             FROM clients ORDER BY created_at DESC LIMIT ?1",
        )?;
        let list = stmt
            .query_map([limit], |r| {
                Ok(row_json(r, &[
                    ("id", "id", Col::Raw),
                    ("name", "name", Col::Raw),
                    ("url", "url", Col::Raw),
                    ("niche", "niche", Col::Raw),
                    ("city", "city", Col::Raw),
                    ("country", "country", Col::Raw),
                    ("tech_stack", "techStack", Col::Raw),
                    ("created_at", "createdAt", Col::Iso),
                ]))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(list)
    });
    match rows {
        Ok(list) => ok_json(json!({ "clients": list, "count": list.len() })),
        Err(e) => ok_json(json!({ "clients": [], "count": 0, "_err": e.to_string() })),
    }
}

// ---------- GET /api/v1/clients/:id ----------
pub async fn client_get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(resp) = require_key(&state, &headers, MSG_401_SHORT, "read", MSG_READ_SCOPE) {
        return resp;
    }
    let Some(cid) = js_number(Some(&id)) else {
        return error::api_error(StatusCode::BAD_REQUEST, "Invalid client id");
    };
    // credential blobs stripped before returning — read scope must not see
    // them even encrypted (defensive pattern in the Next source).
    let row = state.db.with_conn(|c| {
        c.query_row(
            "SELECT id, name, url, niche, tech_stack, share_token, logo_url, description, \
             address, phone, email, social_links, gbp_url, gsc_property, ga4_property_id, \
             google_connected_email, country, language, city, geo_target, business_type, \
             service_radius_km, onboarding_step, plan_generated_at, wp_endpoint, \
             branding_skipped, gbp_location_name, created_at, updated_at \
             FROM clients WHERE id = ?1 LIMIT 1",
            params![cid],
            |r| {
                Ok(row_json(r, &[
                    ("id", "id", Col::Raw),
                    ("name", "name", Col::Raw),
                    ("url", "url", Col::Raw),
                    ("niche", "niche", Col::Raw),
                    ("tech_stack", "techStack", Col::Raw),
                    ("share_token", "shareToken", Col::Raw),
                    ("logo_url", "logoUrl", Col::Raw),
                    ("description", "description", Col::Raw),
                    ("address", "address", Col::Raw),
                    ("phone", "phone", Col::Raw),
                    ("email", "email", Col::Raw),
                    ("social_links", "socialLinks", Col::Raw),
                    ("gbp_url", "gbpUrl", Col::Raw),
                    ("gsc_property", "gscProperty", Col::Raw),
                    ("ga4_property_id", "ga4PropertyId", Col::Raw),
                    ("google_connected_email", "googleConnectedEmail", Col::Raw),
                    ("country", "country", Col::Raw),
                    ("language", "language", Col::Raw),
                    ("city", "city", Col::Raw),
                    ("geo_target", "geoTarget", Col::Raw),
                    ("business_type", "businessType", Col::Raw),
                    ("service_radius_km", "serviceRadiusKm", Col::Raw),
                    ("onboarding_step", "onboardingStep", Col::Raw),
                    ("plan_generated_at", "planGeneratedAt", Col::Iso),
                    ("wp_endpoint", "wpEndpoint", Col::Raw),
                    ("branding_skipped", "brandingSkipped", Col::Raw),
                    ("gbp_location_name", "gbpLocationName", Col::Raw),
                    ("created_at", "createdAt", Col::Iso),
                    ("updated_at", "updatedAt", Col::Iso),
                ]))
            },
        )
        .optional()
    });
    match row {
        Ok(Some(client)) => ok_json(json!({ "client": client })),
        Ok(None) => error::api_error(StatusCode::NOT_FOUND, "Client not found"),
        Err(_) => error::api_error(StatusCode::NOT_FOUND, "Client not found"),
    }
}

// ---------- GET /api/v1/keywords ----------
pub async fn keywords_list(State(state): State<AppState>, headers: HeaderMap, uri: Uri) -> Response {
    if let Err(resp) = require_key(&state, &headers, MSG_401_SHORT, "read", MSG_READ_SCOPE) {
        return resp;
    }
    let limit = auth::parse_limit(qparam(uri.query(), "limit"), 100, 500);
    // Node: clientId ? Number(clientId) : null — junk binds NaN → NULL match
    // → no rows. Impossible-filter (id = -1) keeps that observable behavior.
    let cid = qparam(uri.query(), "clientId").and_then(|s| js_number(Some(s)).map(|f| f as i64));
    let where_clause = if cid.is_some() {
        format!("WHERE k.client_id = {}", cid.unwrap())
    } else {
        String::new()
    };
    let rows = state.db.with_conn(|c| {
        let sql = format!(
            "SELECT k.id, k.query, k.country, k.client_id, cl.name \
             FROM keywords k LEFT JOIN clients cl ON k.client_id = cl.id \
             {where_clause} LIMIT {limit}",
        );
        let mut stmt = c.prepare(&sql)?;
        let map_row = |r: &rusqlite::Row<'_>| {
            Ok(row_json(r, &[
                ("id", "id", Col::Raw),
                ("query", "query", Col::Raw),
                ("country", "country", Col::Raw),
                ("client_id", "clientId", Col::Raw),
                ("name", "clientName", Col::Raw),
            ]))
        };
        let list: Vec<Value> = stmt.query_map([], map_row)?.collect::<Result<Vec<_>, _>>()?;
        Ok(list)
    });
    let kw_rows = match rows {
        Ok(v) => v,
        Err(_) => Vec::new(),
    };
    // latest rank per keyword — 10 most-recent rows per keyword is plenty
    let mut latest: std::collections::HashMap<i64, (Value, Value)> = std::collections::HashMap::new();
    if !kw_rows.is_empty() {
        let ids: Vec<i64> = kw_rows
            .iter()
            .filter_map(|v| v.get("id").and_then(|x| x.as_i64()))
            .collect();
        if !ids.is_empty() {
            let marks = vec!["?"; ids.len()].join(",");
            let sql = format!(
                "SELECT keyword_id, position, checked_at FROM keyword_rankings \
                 WHERE keyword_id IN ({marks}) ORDER BY checked_at DESC LIMIT {}",
                ids.len() * 10
            );
            let _ = state.db.with_conn(|c| {
                let mut stmt = c.prepare(&sql)?;
                let mut rows = stmt.query(rusqlite::params_from_iter(ids.iter()))?;
                while let Some(r) = rows.next()? {
                    let kid: i64 = r.get(0)?;
                    if !latest.contains_key(&kid) {
                        latest.insert(kid, (sqv_to_json(r.get(1)?), sqv_to_iso(r.get(2)?)));
                    }
                }
                Ok(())
            });
        }
    }
    let enriched: Vec<Value> = kw_rows
        .into_iter()
        .map(|mut v| {
            if let Value::Object(obj) = &mut v {
                let kid = obj.get("id").and_then(|x| x.as_i64());
                let latest_entry = kid.and_then(|k| latest.get(&k));
                obj.insert("latestPosition".into(), latest_entry.map(|(p, _)| p.clone()).unwrap_or(Value::Null));
                obj.insert("lastCheckedAt".into(), latest_entry.map(|(_, c)| c.clone()).unwrap_or(Value::Null));
            }
            v
        })
        .collect();
    let count = enriched.len();
    ok_json(json!({ "keywords": enriched, "count": count }))
}

// ---------- GET /api/v1/rankings ----------
pub async fn rankings_list(State(state): State<AppState>, headers: HeaderMap, uri: Uri) -> Response {
    if let Err(resp) = require_key(&state, &headers, MSG_401_SHORT, "read", MSG_READ_SCOPE) {
        return resp;
    }
    let keyword_id = qparam(uri.query(), "keywordId");
    let client_id = qparam(uri.query(), "clientId");
    if keyword_id.is_none() && client_id.is_none() {
        return error::api_error(StatusCode::BAD_REQUEST, "Specify keywordId or clientId");
    }
    // Node: days = Math.min(Number(days ?? 90), 365); Number("") = 0
    let days = js_number(qparam(uri.query(), "days")).map(|d| d.min(365.0)).unwrap_or(90.0);
    let limit = auth::parse_limit(qparam(uri.query(), "limit"), 500, 2000);
    // Invalid Date (NaN days) matches nothing in SQLite — mirror with empty.
    if !days.is_finite() {
        return ok_json(json!({ "rankings": [], "count": 0 }));
    }
    let since = now_secs() - (days * 86400.0) as i64;
    let kid = keyword_id.and_then(|s| js_number(Some(s)).map(|f| f as i64));
    let cid = client_id.and_then(|s| js_number(Some(s)).map(|f| f as i64));
    // since/kid/cid are validated i64s — inline is safe (no injection)
    let rows = state.db.with_conn(|c| {
        let mut sql = format!(
            "SELECT kr.keyword_id, k.query, k.country, kr.position, kr.url, kr.checked_at, \
             kr.has_ai_overview, kr.has_featured_snippet, kr.has_local_pack \
             FROM keyword_rankings kr LEFT JOIN keywords k ON kr.keyword_id = k.id \
             WHERE kr.checked_at >= {since}"
        );
        if let Some(kid) = kid {
            sql.push_str(&format!(" AND kr.keyword_id = {kid}"));
        }
        if let Some(cid) = cid {
            sql.push_str(&format!(" AND k.client_id = {cid}"));
        }
        sql.push_str(&format!(" ORDER BY kr.checked_at DESC LIMIT {limit}"));
        let mut stmt = c.prepare(&sql)?;
        let map_row = |r: &rusqlite::Row<'_>| {
            Ok(row_json(r, &[
                ("keyword_id", "keywordId", Col::Raw),
                ("query", "query", Col::Raw),
                ("country", "country", Col::Raw),
                ("position", "position", Col::Raw),
                ("url", "url", Col::Raw),
                ("checked_at", "checkedAt", Col::Iso),
                ("has_ai_overview", "hasAiOverview", Col::Raw),
                ("has_featured_snippet", "hasFeaturedSnippet", Col::Raw),
                ("has_local_pack", "hasLocalPack", Col::Raw),
            ]))
        };
        let list: Vec<Value> = stmt.query_map([], map_row)?.collect::<Result<Vec<_>, _>>()?;
        Ok(list)
    });
    match rows {
        Ok(list) => {
            let count = list.len();
            ok_json(json!({ "rankings": list, "count": count }))
        }
        Err(_) => ok_json(json!({ "rankings": [], "count": 0 })),
    }
}

// ---------- GET /api/v1/reports ----------
pub async fn reports_list(State(state): State<AppState>, headers: HeaderMap, uri: Uri) -> Response {
    if let Err(resp) = require_key(&state, &headers, MSG_401_SHORT, "read", MSG_READ_SCOPE) {
        return resp;
    }
    let limit = auth::parse_limit(qparam(uri.query(), "limit"), 50, 200);
    let cid = qparam(uri.query(), "clientId").and_then(|s| js_number(Some(s)).map(|f| f as i64));
    let cols = &[
        ("id", "id", Col::Raw),
        ("client_id", "clientId", Col::Raw),
        ("name", "clientName", Col::Raw),
        ("title", "title", Col::Raw),
        ("period_start", "periodStart", Col::Iso),
        ("period_end", "periodEnd", Col::Iso),
        ("template", "template", Col::Raw),
        ("exec_summary", "execSummary", Col::Raw),
        ("pdf_bytes", "pdfBytes", Col::Raw),
        ("pinned", "pinned", Col::Raw),
        ("created_at", "createdAt", Col::Iso),
    ];
    let sql_base = "SELECT r.id, r.client_id, cl.name, r.title, r.period_start, r.period_end, \
         r.template, r.exec_summary, r.pdf_bytes, r.pinned, r.created_at \
         FROM report_archives r LEFT JOIN clients cl ON r.client_id = cl.id";
    let rows = state.db.with_conn(|c| {
        let list: Vec<Value> = if let Some(cid) = cid {
            let mut stmt = c.prepare(&format!("{sql_base} WHERE r.client_id = ?1 ORDER BY r.created_at DESC LIMIT ?2"))?;
            let v = stmt
                .query_map(params![cid, limit], |r| Ok(row_json(r, cols)))?
                .collect::<Result<Vec<_>, _>>()?;
            v
        } else {
            let mut stmt = c.prepare(&format!("{sql_base} ORDER BY r.created_at DESC LIMIT ?1"))?;
            let v = stmt
                .query_map([limit], |r| Ok(row_json(r, cols)))?
                .collect::<Result<Vec<_>, _>>()?;
            v
        };
        Ok(list)
    });
    match rows {
        Ok(list) => {
            let count = list.len();
            ok_json(json!({ "reports": list, "count": count }))
        }
        Err(_) => ok_json(json!({ "reports": [], "count": 0 })),
    }
}

// ---------- GET /api/v1/snapshots ----------
pub async fn snapshots_list(State(state): State<AppState>, headers: HeaderMap, uri: Uri) -> Response {
    if let Err(resp) = require_key(&state, &headers, MSG_401_SHORT, "read", MSG_READ_SCOPE) {
        return resp;
    }
    let limit = auth::parse_limit(qparam(uri.query(), "limit"), 90, 365);
    let cid = qparam(uri.query(), "clientId").and_then(|s| js_number(Some(s)).map(|f| f as i64));
    let cols = &[
        ("client_id", "clientId", Col::Raw),
        ("name", "clientName", Col::Raw),
        ("kind", "kind", Col::Raw),
        ("health_score", "healthScore", Col::Raw),
        ("organic_clicks", "organicClicks", Col::Raw),
        ("organic_impressions", "organicImpressions", Col::Raw),
        ("organic_avg_position_x100", "organicAvgPositionX100", Col::Raw),
        ("ga4_sessions", "ga4Sessions", Col::Raw),
        ("ga4_conversions", "ga4Conversions", Col::Raw),
        ("ga4_revenue_x100", "ga4RevenueX100", Col::Raw),
        ("keyword_count", "keywordCount", Col::Raw),
        ("avg_rank_x100", "avgRankX100", Col::Raw),
        ("top10_count", "top10Count", Col::Raw),
        ("critical_issues", "criticalIssues", Col::Raw),
        ("high_issues", "highIssues", Col::Raw),
        ("backlink_count", "backlinkCount", Col::Raw),
        ("gbp_score", "gbpScore", Col::Raw),
        ("mention_count", "mentionCount", Col::Raw),
        ("captured_at", "capturedAt", Col::Iso),
    ];
    let sql_base = "SELECT s.client_id, cl.name, s.kind, s.health_score, s.organic_clicks, \
         s.organic_impressions, s.organic_avg_position_x100, s.ga4_sessions, s.ga4_conversions, \
         s.ga4_revenue_x100, s.keyword_count, s.avg_rank_x100, s.top10_count, s.critical_issues, \
         s.high_issues, s.backlink_count, s.gbp_score, s.mention_count, s.captured_at \
         FROM client_metric_snapshots s LEFT JOIN clients cl ON s.client_id = cl.id";
    let rows = state.db.with_conn(|c| {
        let list: Vec<Value> = if let Some(cid) = cid {
            let mut stmt = c.prepare(&format!("{sql_base} WHERE s.client_id = ?1 ORDER BY s.captured_at DESC LIMIT ?2"))?;
            let v = stmt
                .query_map(params![cid, limit], |r| Ok(row_json(r, cols)))?
                .collect::<Result<Vec<_>, _>>()?;
            v
        } else {
            let mut stmt = c.prepare(&format!("{sql_base} ORDER BY s.captured_at DESC LIMIT ?1"))?;
            let v = stmt
                .query_map([limit], |r| Ok(row_json(r, cols)))?
                .collect::<Result<Vec<_>, _>>()?;
            v
        };
        Ok(list)
    });
    match rows {
        Ok(list) => {
            let count = list.len();
            ok_json(json!({ "snapshots": list, "count": count }))
        }
        Err(_) => ok_json(json!({ "snapshots": [], "count": 0 })),
    }
}

// ---------- GET /api/v1/audits ----------
pub async fn audits_list(State(state): State<AppState>, headers: HeaderMap, uri: Uri) -> Response {
    if let Err(resp) = require_key(&state, &headers, MSG_401_SHORT, "read", MSG_READ_SCOPE) {
        return resp;
    }
    let limit = auth::parse_limit(qparam(uri.query(), "limit"), 50, 200);
    let cid = qparam(uri.query(), "clientId").and_then(|s| js_number(Some(s)).map(|f| f as i64));
    let cols = &[
        ("id", "id", Col::Raw),
        ("client_id", "clientId", Col::Raw),
        ("name", "clientName", Col::Raw),
        ("score", "score", Col::Raw),
        ("issues_count", "issuesCount", Col::Raw),
        ("status", "status", Col::Raw),
        ("started_at", "startedAt", Col::Iso),
        ("completed_at", "completedAt", Col::Iso),
    ];
    let sql_base = "SELECT a.id, a.client_id, cl.name, a.score, a.issues_count, a.status, \
         a.started_at, a.completed_at \
         FROM audits a LEFT JOIN clients cl ON a.client_id = cl.id";
    let rows = state.db.with_conn(|c| {
        let list: Vec<Value> = if let Some(cid) = cid {
            let mut stmt = c.prepare(&format!("{sql_base} WHERE a.client_id = ?1 ORDER BY a.created_at DESC LIMIT ?2"))?;
            let v = stmt
                .query_map(params![cid, limit], |r| Ok(row_json(r, cols)))?
                .collect::<Result<Vec<_>, _>>()?;
            v
        } else {
            let mut stmt = c.prepare(&format!("{sql_base} ORDER BY a.created_at DESC LIMIT ?1"))?;
            let v = stmt
                .query_map([limit], |r| Ok(row_json(r, cols)))?
                .collect::<Result<Vec<_>, _>>()?;
            v
        };
        Ok(list)
    });
    match rows {
        Ok(list) => {
            let count = list.len();
            ok_json(json!({ "audits": list, "count": count }))
        }
        Err(_) => ok_json(json!({ "audits": [], "count": 0 })),
    }
}

// ---------- GET /api/v1/audits/:id ----------
pub async fn audit_get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(resp) = require_key(&state, &headers, MSG_401_SHORT, "read", MSG_READ_SCOPE) {
        return resp;
    }
    let Some(aid) = js_number(Some(&id)) else {
        return error::api_error(StatusCode::BAD_REQUEST, "Invalid audit id");
    };
    let audit = state.db.with_conn(|c| {
        use rusqlite::OptionalExtension;
        c.query_row(
            "SELECT id, client_id, status, score, issues_count, started_at, completed_at, \
             created_at, updated_at, kind, target_url, summary, pages_crawled \
             FROM audits WHERE id = ?1 LIMIT 1",
            params![aid],
            |r| {
                Ok(row_json(r, &[
                    ("id", "id", Col::Raw),
                    ("client_id", "clientId", Col::Raw),
                    ("status", "status", Col::Raw),
                    ("score", "score", Col::Raw),
                    ("issues_count", "issuesCount", Col::Raw),
                    ("started_at", "startedAt", Col::Iso),
                    ("completed_at", "completedAt", Col::Iso),
                    ("created_at", "createdAt", Col::Iso),
                    ("updated_at", "updatedAt", Col::Iso),
                    ("kind", "kind", Col::Raw),
                    ("target_url", "targetUrl", Col::Raw),
                    ("summary", "summary", Col::Raw),
                    ("pages_crawled", "pagesCrawled", Col::Raw),
                ]))
            },
        )
        .optional()
    });
    let audit = match audit {
        Ok(Some(a)) => a,
        Ok(None) => return error::api_error(StatusCode::NOT_FOUND, "Audit not found"),
        Err(_) => return error::api_error(StatusCode::NOT_FOUND, "Audit not found"),
    };
    let issues = state.db.with_conn(|c| {
        let mut stmt = c.prepare(
            "SELECT id, severity, type, url, message, status, category, ai_generated \
             FROM audit_issues WHERE audit_id = ?1 ORDER BY severity ASC",
        )?;
        let list = stmt
            .query_map([aid], |r| {
                Ok(row_json(r, &[
                    ("id", "id", Col::Raw),
                    ("severity", "severity", Col::Raw),
                    ("type", "type", Col::Raw),
                    ("url", "url", Col::Raw),
                    ("message", "message", Col::Raw),
                    ("status", "status", Col::Raw),
                    ("category", "category", Col::Raw),
                    ("ai_generated", "aiGenerated", Col::Raw),
                ]))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(list)
    });
    let mut issues = issues.unwrap_or_default();
    // SEVERITY_RANK { critical:0, high:1, medium:2, low:3, default 9 } —
    // stable sort over the SQL's alphabetical order, exactly like the JS.
    issues.sort_by_key(|v| match v.get("severity").and_then(|s| s.as_str()) {
        Some("critical") => 0,
        Some("high") => 1,
        Some("medium") => 2,
        Some("low") => 3,
        _ => 9,
    });
    let issue_count = issues.len();
    ok_json(json!({ "audit": audit, "issues": issues, "issueCount": issue_count }))
}

// ---------- POST /api/v1/track-404 ----------
pub async fn track_404_post(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    if let Err(resp) = require_key(&state, &headers, MSG_401_SHORT, "write", MSG_WRITE_SCOPE) {
        return resp;
    }
    let parsed: Result<Value, _> = serde_json::from_slice(&body);
    let Ok(body) = parsed else {
        return error::api_error(StatusCode::BAD_REQUEST, "Body must be JSON.");
    };
    let obj = body.as_object();
    let source_path = js_string(obj.and_then(|o| o.get("sourcePath"))).trim().to_string();
    if source_path.is_empty() || !source_path.starts_with('/') {
        return error::api_error(StatusCode::BAD_REQUEST, "sourcePath required (must start with /).");
    }
    let client_id = obj
        .and_then(|o| o.get("clientId"))
        .and_then(|v| v.as_i64());
    let existing = state.db.with_conn(|c| {
        use rusqlite::OptionalExtension;
        c.query_row(
            "SELECT id, hits FROM not_found_log WHERE source_path = ?1 LIMIT 1",
            params![source_path],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
        )
        .optional()
    });
    match existing {
        Ok(Some((id, hits))) => {
            let _ = state.db.with_conn(|c| {
                c.execute(
                    "UPDATE not_found_log SET hits = hits + 1, last_seen = ?1 WHERE id = ?2",
                    params![now_secs(), id],
                )
            });
            ok_json(json!({ "ok": true, "id": id, "hits": hits + 1 }))
        }
        _ => {
            let inserted = state.db.with_conn(|c| {
                c.query_row(
                    "INSERT INTO not_found_log (source_path, client_id) VALUES (?1, ?2) RETURNING id",
                    params![source_path, client_id],
                    |r| r.get::<_, i64>(0),
                )
            });
            match inserted {
                Ok(id) => ok_json(json!({ "ok": true, "id": id, "hits": 1 })),
                Err(_) => ok_json(json!({ "ok": true, "id": Value::Null, "hits": 1 })),
            }
        }
    }
}

// ---------- GET + POST /api/v1/capture ----------
pub async fn capture_get(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(resp) = require_key(&state, &headers, MSG_401_SHORT, "read", MSG_READ_SCOPE) {
        return resp;
    }
    ok_json(json!({
        "ok": true,
        "note": "POST JSON to this endpoint with { type, url, title, payload }",
    }))
}

pub async fn capture_post(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    if let Err(resp) = require_key(&state, &headers, MSG_401_SHORT, "write", MSG_WRITE_SCOPE) {
        return resp;
    }
    let parsed: Result<Value, _> = serde_json::from_slice(&body);
    let Ok(body) = parsed else {
        return error::api_error(StatusCode::BAD_REQUEST, "Body must be JSON.");
    };
    let obj = body.as_object();
    let type_ = {
        let t = js_string(obj.and_then(|o| o.get("type")));
        if t.is_empty() { "generic".to_string() } else { t }
    };
    let url = js_string(obj.and_then(|o| o.get("url")));
    let title = js_string(obj.and_then(|o| o.get("title")));
    if url.is_empty() {
        return error::api_error(StatusCode::BAD_REQUEST, "url is required.");
    }
    // logActivity FIRST (order matters in the Next source), with the 24h
    // (kind, message) dedupe window.
    let title80: String = title.chars().take(80).collect();
    let message = format!("Browser-ext capture: {type_} from {url} — {title80}");
    let kind = "outreach.contacted";
    let cutoff = now_secs() - 24 * 60 * 60;
    let _ = state.db.with_conn(|c| {
        use rusqlite::OptionalExtension;
        let dupe: Option<i64> = c
            .query_row(
                "SELECT id FROM activity_log WHERE kind = ?1 AND message = ?2 AND created_at >= ?3 LIMIT 1",
                params![kind, message, cutoff],
                |r| r.get(0),
            )
            .optional()?;
        if dupe.is_none() {
            c.execute(
                "INSERT INTO activity_log (kind, message, level, entity_type, created_at) \
                 VALUES (?1, ?2, 'info', 'capture', ?3)",
                params![kind, message, now_secs()],
            )?;
        }
        Ok(())
    });
    let payload = obj.and_then(|o| o.get("payload")).cloned().unwrap_or(Value::Null);
    let size = serde_json::to_string(&payload).map(|s| s.len()).unwrap_or(2); // "null" = 4; JS {} = 2
    if size > 1_000_000 {
        return error::api_error(StatusCode::PAYLOAD_TOO_LARGE, "Payload >1MB — strip the HTML before sending.");
    }
    ok_json(json!({
        "ok": true,
        "type": type_,
        "url": url,
        "storedAt": now_iso(),
        "payloadSize": size,
    }))
}
