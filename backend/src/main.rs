//! SEO Tool Rust backend — core infra (Task 14.2) + auth domain (14.4).
//!
//! Three-part split (docs/architecture-split-plan.md):
//!   frontend (Next.js, unchanged) -> backend (Rust, THIS service) -> db (SQLite, unchanged)
//!
//! 14.2 scope: config, shared SQLite handle, error-envelope parity, the
//! auth middleware port (CSRF / local-socket / admin modes / bearer keys)
//! and `/__dev/*` probe routes that exercise each mechanism. The probes
//! are clearly-namespaced scaffolding — they are NOT part of the public
//! contract and never will be.
//!
//! 14.3 scope: health-ping, errors/env, edge/fixes and the full /api/v1
//! Bearer API.
//!
//! 14.4 scope: the auth web domain (login/logout/mode/register/status)
//! and the error sink (/api/errors, /api/errors/by-digest) — sessions,
//! scrypt passwords, invite acceptance, rate limiting.
//!
//! 14.5a scope: the internal action API (/api/internal/*) behind the
//! X-Internal-Token middleware — the DB effects of the ported Next server
//! actions (tasks, notifications, keywords, backlinks, audit issues).
//!
//! 14.5b scope: the clients domain (CRUD, quick-add, template seeding,
//! redetect-stack, share tokens) on the same internal API.
//!
//! 14.6a scope: tools wave 1 — the pure-DB `tools/*` action effects
//! (redirects + 404 log, uptime targets, person-schema tool-run,
//! migration-map import, serp snapshot delete, robots snapshot list,
//! settings set/delete for the bing/youtube API keys) in tools_basic.rs.
//!
//! 14.6b scope: tools wave 2 — the COMPUTE half of the provably-local
//! `tools/*` actions (utm-attribution runAttribution over pasted touch
//! data, migration-map runMapping fuzzy mapper + renderers) plus their
//! saveToolRun bookkeeping, in tools_compute.rs.
//!
//! 14.7a scope: the query gateway (/api/internal/query) — the read
//! transport for the Next-side drizzle sqlite-proxy driver: pages keep
//! their exact drizzle syntax, rows come back as positional arrays and
//! drizzle core maps them as before. SELECT-only, two-layer guard, in
//! query.rs.

mod audits;
mod auth;
mod authweb;
mod backlinks;
mod client_templates;
mod clients;
mod config;
mod db;
mod errlog;
mod error;
mod internal;
mod keywords;
mod misc;
mod notifications;
mod password;
mod query;
mod ratelimit;
mod session;
mod tasks;
mod tools_basic;
mod tools_compute;
mod util;
mod v1;

use axum::{extract::State, http::HeaderMap, http::StatusCode, response::IntoResponse, routing::get, routing::post, Json, Router};
use config::Config;
use db::Db;
use error::MSG_BEARER_REQUIRED;
use ratelimit::Limiter;
use serde_json::{json, Value};
use std::{sync::Arc, time::Instant};

#[derive(Clone)]
struct AppState {
    cfg: Arc<Config>,
    db: Db,
    started_at: Instant,
    /// Port of the module-level buckets map in src/lib/rate-limit.ts.
    rl: Arc<Limiter>,
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
        rl: Arc::new(Limiter::default()),
    };

    // ---- 14.5a: internal action API — X-Internal-Token guarded ----
    // Built as a separate router so route_layer scopes the token check to
    // exactly these routes; the existing public routes are untouched.
    let internal = Router::new()
        .route("/api/internal/tasks/:id/status", post(tasks::task_status))
        .route("/api/internal/tasks/:id/delete", post(tasks::task_delete))
        .route("/api/internal/tasks/create", post(tasks::task_create))
        .route("/api/internal/tasks/:id/time", post(tasks::task_time))
        .route("/api/internal/tasks/bulk-status", post(tasks::bulk_status))
        .route("/api/internal/tasks/bulk-priority", post(tasks::bulk_priority))
        .route("/api/internal/tasks/bulk-delete", post(tasks::bulk_delete))
        .route(
            "/api/internal/notifications/recent",
            get(notifications::recent),
        )
        .route("/api/internal/keywords/track", post(keywords::track))
        .route("/api/internal/keywords/:id/untrack", post(keywords::untrack))
        .route("/api/internal/keywords/import", post(keywords::import))
        .route("/api/internal/backlinks/add", post(backlinks::add))
        .route("/api/internal/backlinks/:id/status", post(backlinks::status))
        .route("/api/internal/backlinks/:id/delete", post(backlinks::delete))
        .route("/api/internal/backlinks/log-built", post(backlinks::log_built))
        .route(
            "/api/internal/backlinks/import-ahrefs",
            post(backlinks::import_ahrefs),
        )
        .route(
            "/api/internal/audits/issues/:id/status",
            post(audits::issue_status),
        )
        .route(
            "/api/internal/audits/:id/issues-type",
            post(audits::issues_type),
        )
        // ---- 14.5b: clients domain ----
        .route("/api/internal/clients/create", post(clients::create))
        .route("/api/internal/clients/quick-add", post(clients::quick_add))
        .route("/api/internal/clients/:id/update", post(clients::update))
        .route("/api/internal/clients/:id/delete", post(clients::delete))
        .route(
            "/api/internal/clients/:id/redetect-stack",
            post(clients::redetect_stack),
        )
        .route(
            "/api/internal/clients/:id/apply-templates",
            post(clients::apply_templates),
        )
        .route(
            "/api/internal/clients/:id/share-token",
            post(clients::share_token),
        )
        // ---- 14.6a: tools wave 1 (pure-DB tool actions) ----
        .route(
            "/api/internal/tools/redirects/add",
            post(tools_basic::redirect_add),
        )
        .route(
            "/api/internal/tools/redirects/delete",
            post(tools_basic::redirect_delete),
        )
        .route(
            "/api/internal/tools/redirects/404/record",
            post(tools_basic::notfound_record),
        )
        .route(
            "/api/internal/tools/redirects/404/resolve",
            post(tools_basic::notfound_resolve),
        )
        .route(
            "/api/internal/tools/redirects/404/delete",
            post(tools_basic::notfound_delete),
        )
        .route("/api/internal/tools/uptime/add", post(tools_basic::uptime_add))
        .route(
            "/api/internal/tools/uptime/delete",
            post(tools_basic::uptime_delete),
        )
        .route(
            "/api/internal/tools/uptime/toggle",
            post(tools_basic::uptime_toggle),
        )
        .route(
            "/api/internal/tools/person-schema/save",
            post(tools_basic::person_schema_save),
        )
        .route(
            "/api/internal/tools/migration-map/import",
            post(tools_basic::migration_import),
        )
        .route(
            "/api/internal/tools/serp-features/delete",
            post(tools_basic::serp_snapshot_delete),
        )
        .route(
            "/api/internal/tools/robots-history/list",
            post(tools_basic::robots_list),
        )
        .route(
            "/api/internal/tools/settings/set",
            post(tools_basic::settings_set),
        )
        .route(
            "/api/internal/tools/settings/delete",
            post(tools_basic::settings_delete),
        )
        // ---- 14.6b: tools wave 2 (compute tool actions) ----
        .route(
            "/api/internal/tools/utm-attribution/run",
            post(tools_compute::utm_run),
        )
        // ---- 14.7a: query gateway (drizzle sqlite-proxy read path) ----
        .route("/api/internal/query", post(query::run))
        .route(
            "/api/internal/tools/migration-map/run",
            post(tools_compute::migration_run),
        )
        .route_layer(axum::middleware::from_fn_with_state(
            state.clone(),
            internal::require_token,
        ));

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
        // ---- 14.4: auth web domain ----
        .route("/api/auth/login", post(authweb::login))
        .route("/api/auth/logout", post(authweb::logout))
        .route("/api/auth/mode", get(authweb::mode))
        .route("/api/auth/register", post(authweb::register))
        .route("/api/auth/status", get(authweb::status))
        // ---- 14.4: error sink ----
        .route("/api/errors", post(errlog::errors_post))
        .route("/api/errors/by-digest", get(errlog::errors_by_digest))
        // ---- /__dev/* scaffolding probes (14.2) — middleware regression checks ----
        .route("/__dev/admin-guard", post(dev_admin_guard))
        .route("/__dev/bearer", get(dev_bearer))
        .route("/__dev/session", get(authweb::dev_session))
        .route("/__dev/scrypt", get(authweb::dev_scrypt))
        .merge(internal)
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
        "phase": "14.4",
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
            "phase": "14.4",
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
