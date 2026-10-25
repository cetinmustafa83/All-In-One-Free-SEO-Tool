//! Client visibility scope — Task 14.8a. Port of the export half of
//! src/lib/client-scope.ts (exportScope → scopedClientIds) plus the
//! src/lib/auth.ts pieces it leans on (visibleClientIds, seesAllClients).
//!
//! Semantics mirrored EXACTLY:
//!   * role strings are the users.role enum: "owner" | "manager" |
//!     "member" | "viewer" (schema.ts Role). owner/manager → unrestricted
//!     (None here = drizzle's null scope = no WHERE term);
//!   * member/viewer → the client_members assignments → `IN (ids)`;
//!   * an EMPTY assignment list → `IN (-1)` — "no clients", not "all
//!     clients" (client-scope.ts's documented always-false filter);
//!   * no user (anonymous / solo install / user vanished since the proxy
//!     resolved it) → unrestricted, exactly like scopedClientIds()'s
//!     `if (!me) return null`.
//!
//! The Rust process has no request cookie; the Next proxy resolves the
//! user through the same currentUser() helper exportScope used and passes
//! `userId` in the body (null = anonymous).

use crate::db::Db;
use rusqlite::OptionalExtension;

/// Port of seesAllClients() — owners and managers see every client.
fn sees_all_clients(role: &str) -> bool {
    role == "owner" || role == "manager"
}

/// Port of visibleClientIds(user) for a user the caller already resolved:
/// `None` = unrestricted (mirrors the TS null), `Some(vec)` = the
/// assignment list (possibly empty = sees nothing).
pub fn visible_client_ids(db: &Db, user_id: Option<i64>) -> Option<Vec<i64>> {
    let uid = user_id?; // scopedClientIds(): `if (!me) return null`
    let role: Option<String> = db
        .with_conn(|c| {
            c.query_row(
                "SELECT role FROM users WHERE id = ?1",
                [uid],
                |r| r.get(0),
            )
            .optional()
        })
        .ok()
        .flatten();
    // A user id that no longer exists behaves like "no user": currentUser()
    // would have returned null one request earlier, and the TS scope for a
    // null user is unrestricted.
    let role = role?;
    if sees_all_clients(&role) {
        return None;
    }
    let rows: Vec<i64> = db
        .with_conn(|c| {
            let mut stmt = c.prepare(
                "SELECT client_id FROM client_members WHERE user_id = ?1",
            )?;
            let mut it = stmt.query_map([uid], |r| r.get(0))?;
            let mut out = Vec::new();
            while let Some(id) = it.next() {
                out.push(id?);
            }
            Ok(out)
        })
        .unwrap_or_default();
    Some(rows)
}
