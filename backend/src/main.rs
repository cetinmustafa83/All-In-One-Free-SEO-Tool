//! SEO Tool Rust backend — scaffold (Task 14.0).
//!
//! Three-part split (docs/architecture-split-plan.md):
//!   frontend (Next.js, unchanged) -> backend (Rust, THIS service) -> db (SQLite, unchanged)
//!
//! Phase 0 scope: service skeleton + `/health` with a live DB smoke check.
//! Later phases port API domains behind the same contract (R4 parity).

use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc, time::Instant};

#[derive(Clone)]
struct AppState {
    db_path: Arc<PathBuf>,
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

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3100);
    let db_path = std::env::var("DATABASE_PATH").unwrap_or_else(|_| "../data.db".into());

    let state = AppState {
        db_path: Arc::new(PathBuf::from(&db_path)),
        started_at: Instant::now(),
    };

    let app = Router::new()
        .route("/", get(root))
        .route("/health", get(health))
        .route("/api/health", get(health)) // alias so the frontend contract can stay /api/*
        .with_state(state)
        .layer(tower_http::trace::TraceLayer::new_for_http());

    let addr = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("failed to bind {addr}: {e}"));
    tracing::info!("seo-backend listening on {addr} (db: {db_path})");
    axum::serve(listener, app).await.expect("server error");
}

async fn root() -> Json<Value> {
    Json(json!({
        "service": "seo-backend",
        "role": "backend",
        "split": ["frontend:nextjs", "backend:rust", "db:sqlite"],
        "plan": "docs/architecture-split-plan.md",
    }))
}

async fn health(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    let db = check_db(&state.db_path);
    let ok = db.ok;
    (
        if ok { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE },
        Json(json!({
            "status": if ok { "ok" } else { "degraded" },
            "service": "seo-backend",
            "version": env!("CARGO_PKG_VERSION"),
            "uptime_secs": state.started_at.elapsed().as_secs(),
            "db": db,
        })),
    )
}

#[derive(Serialize)]
struct DbHealth {
    ok: bool,
    path: String,
    tables: Option<i64>,
    journal_mode: Option<String>,
    error: Option<String>,
}

fn check_db(path: &PathBuf) -> DbHealth {
    let path_str = path.display().to_string();
    match Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) {
        Ok(conn) => {
            let _ = conn.busy_timeout(std::time::Duration::from_millis(5000));
            let tables: Result<i64, _> = conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'",
                [],
                |r| r.get(0),
            );
            let journal: Result<String, _> =
                conn.query_row("PRAGMA journal_mode", [], |r| r.get(0));
            match (tables, journal) {
                (Ok(t), Ok(j)) => DbHealth {
                    ok: true,
                    path: path_str,
                    tables: Some(t),
                    journal_mode: Some(j),
                    error: None,
                },
                (Err(e), _) | (_, Err(e)) => DbHealth {
                    ok: false,
                    path: path_str,
                    tables: None,
                    journal_mode: None,
                    error: Some(e.to_string()),
                },
            }
        }
        Err(e) => DbHealth {
            ok: false,
            path: path_str,
            tables: None,
            journal_mode: None,
            error: Some(e.to_string()),
        },
    }
}
