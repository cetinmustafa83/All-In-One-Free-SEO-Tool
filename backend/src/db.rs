//! SQLite layer — Task 14.2 (plan rule R3: db stays as-is).
//!
//! One shared connection behind a Mutex. SQLite in WAL mode handles the
//! Node↔Rust coexistence during migration; busy_timeout matches the
//! single-writer discipline documented in the plan's risk table.

use rusqlite::{Connection, OpenFlags};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
    /// Port of accountsEnabled()'s sticky cache (src/lib/auth.ts): once
    /// accounts are seen, they stay enabled for the process lifetime.
    sticky_accounts: Arc<AtomicBool>,
}

impl Db {
    pub fn open(path: &str) -> rusqlite::Result<Self> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.busy_timeout(std::time::Duration::from_millis(5000))?;
        // Node side (better-sqlite3) runs WAL — match it exactly.
        let _: String = conn.query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            sticky_accounts: Arc::new(AtomicBool::new(false)),
        })
    }

    /// Run `f` with the shared connection.
    pub fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, rusqlite::Error> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        f(&conn)
    }

    /// Port of accountsEnabled(): `SELECT COUNT(*) FROM users` > 0.
    /// Missing table (pre-migration install) counts as disabled, exactly
    /// like the Next catch block.
    pub fn accounts_enabled(&self) -> bool {
        if self.sticky_accounts.load(Ordering::Relaxed) {
            return true;
        }
        let enabled = self
            .with_conn(|c| {
                let n: i64 = c.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
                Ok(n > 0)
            })
            .unwrap_or(false);
        if enabled {
            self.sticky_accounts.store(true, Ordering::Relaxed);
        }
        enabled
    }

    /// Table count + journal mode for /health.
    pub fn smoke(&self) -> Result<(i64, String), rusqlite::Error> {
        self.with_conn(|c| {
            let tables: i64 =
                c.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table'", [], |r| r.get(0))?;
            let journal: String = c.query_row("PRAGMA journal_mode", [], |r| r.get(0))?;
            Ok((tables, journal))
        })
    }
}
