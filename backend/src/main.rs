//! SEO Tool Rust backend — core infra (Task 14.2).
//!
//! Three-part split (docs/architecture-split-plan.md):
//!   frontend (Next.js, unchanged) -> backend (Rust, THIS service) -> db (SQLite, unchanged)
//!
//! 14.2 scope: config, shared SQLite handle, error-envelope parity, the
//! auth middleware port (CSRF / local-socket / admin modes / bearer keys)
//! and `/__dev/*` probe routes that exercise each mechanism. The probes
//! are clearly-namespaced scaffolding — they are NOT part of the public
//! contract and never will be.

mod auth;
mod config;
mod db;
mod error;
mod misc;
mod util;
mod v1;

use axum::{extract::State, http::HeaderMap, http::StatusCode, response::IntoResponse, routing::get, routing::post, Json, Router};
use config::Config;
use db::Db;
use error::MSG_BEARER_REQUIRED;
use serde_json::{json, Value};
use std::{sync::Arc, time::Instant};

#[derive(Clone)]
struct AppState {
    cfg: Arc<Config>,
    db: Db,
    started_at: Instant,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=info".into()),
        )
        .init();

    let cfg = Config::from_env();
    let db = Db::open(&cfg.db_path)
        .unwrap_or_else(|e| panic!("cannot open database {}: {e}", cfg.db_path));
    let port = cfg.port;

    let state = AppState {
        cfg: Arc::new(cfg),
        db,
        started_at: Instant::now(),
    };

    let app = Router::new()
        .route("/", get(root))
        .route("/health", get(health))
        .route("/api/health", get(health)) // alias so the frontend contract can stay /api/*
        // ---- 14.3: misc open endpoints + edge worker contract ----
        .route("/api/health-ping", get(misc::health_ping))
        .route("/api/errors/env", get(misc::errors_env))
        .route("/api/edge/fixes", get(misc::edge_fixes))
        // ---- 14.3: /api/v1 public Bearer API ----
        .route("/api/v1/health", get(v1::v1_health_get).options(v1::v1_health_options))
        .route("/api/v1/clients", get(v1::clients_list))
        .route("/api/v1/clients/:id", get(v1::client_get))
        .route("/api/v1/keywords", get(v1::keywords_list))
        .route("/api/v1/rankings", get(v1::rankings_list))
        .route("/api/v1/reports", get(v1::reports_list))
        .route("/api/v1/snapshots", get(v1::snapshots_list))
        .route("/api/v1/audits", get(v1::audits_list))
        .route("/api/v1/audits/:id", get(v1::audit_get))
        .route("/api/v1/track-404", post(v1::track_404_post))
        .route("/api/v1/capture", get(v1::capture_get).post(v1::capture_post))
        // ---- /__dev/* scaffolding probes (14.2) — middleware regression checks ----
        .route("/__dev/admin-guard", post(dev_admin_guard))
        .route("/__dev/bearer", get(dev_bearer))
        .with_state(state)
        .layer(tower_http::trace::TraceLayer::new_for_http());

    let addr = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("failed to bind {addr}: {e}"));
    tracing::info!("seo-backend listening on {addr}");
    axum::serve(listener, app).await.expect("server error");
}

async fn root() -> Json<Value> {
    Json(json!({
        "service": "seo-backend",
        "role": "backend",
        "split": ["frontend:nextjs", "backend:rust", "db:sqlite"],
        "plan": "docs/architecture-split-plan.md",
        "phase": "14.3",
    }))
}

async fn health(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    let (tables, journal) = state
        .db
        .smoke()
        .map(|(t, j)| (Some(t), Some(j)))
        .unwrap_or((None, None));
    let ok = tables.is_some();
    (
        if ok { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE },
        Json(json!({
            "status": if ok { "ok" } else { "degraded" },
            "service": "seo-backend",
            "version": env!("CARGO_PKG_VERSION"),
            "phase": "14.3",
            "uptime_secs": state.started_at.elapsed().as_secs(),
            "db": { "ok": ok, "path": state.cfg.db_path, "tables": tables, "journal_mode": journal },
        })),
    )
}

/// Exercises the full guardAdminRequest port: cross-site → mode → local.
/// 200 {"ok":true,"mode":...} on pass, byte-identical envelopes on denial.
async fn dev_admin_guard(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> axum::response::Response {
    match auth::guard_admin(&headers, &state.db, &state.cfg) {
        Ok(mode) => Json(json!({ "ok": true, "mode": format!("{mode:?}").to_lowercase() })).into_response(),
        Err(resp) => resp,
    }
}

/// Exercises the bearer path of src/lib/api-auth.ts authenticateRequest():
/// parse header → seo_live_ prefix → sha256 → api_keys row (not revoked,
/// not expired) → scope echo. 401 with the exact Next message otherwise.
async fn dev_bearer(State(state): State<AppState>, headers: HeaderMap) -> axum::response::Response {
    let Some(raw) = auth::bearer_token(&headers) else {
        return error::api_error(StatusCode::UNAUTHORIZED, MSG_BEARER_REQUIRED);
    };
    if !raw.starts_with(auth::KEY_PREFIX) {
        return error::api_error(StatusCode::UNAUTHORIZED, MSG_BEARER_REQUIRED);
    }
    let hash = auth::sha256_hex(&raw);
    let row = state
        .db
        .with_conn(|c| {
            c.query_row(
                "SELECT id, scopes FROM api_keys WHERE key_hash = ?1 \
                 AND revoked_at IS NULL \
                 AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')) \
                 LIMIT 1",
                [&hash],
                |r| {
                    let scopes_json: String = r.get::<_, String>(1)?;
                    Ok((r.get::<_, i64>(0)?, scopes_json))
                },
            )
        })
        .ok();
    match row {
        Some((id, scopes_json)) => {
            // scopes column is TEXT JSON (Drizzle text storage mode)
            let scopes: Vec<String> = serde_json::from_str(&scopes_json).unwrap_or_default();
            Json(json!({ "ok": true, "key_id": id, "scopes": scopes })).into_response()
        }
        None => error::api_error(StatusCode::UNAUTHORIZED, MSG_BEARER_REQUIRED),
    }
}
