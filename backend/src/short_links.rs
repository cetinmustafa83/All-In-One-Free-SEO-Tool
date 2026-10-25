//! Short-links domain — Task 14.13 (write-gateway wave 1). Port of
//! src/lib/short-links.ts `recordClick` + src/app/links/actions.ts
//! `createShortLink` / `deleteShortLink` onto /api/internal/short-links/*.
//!
//! With this wave the public redirector (/r/<slug>) has zero direct SQLite
//! on the Next side: the slug lookup reads through the 14.7 query gateway
//! and the click write goes through `click` below. The CSV import action
//! stays Next-side for now (presentation-level CSV row parsing); its rows
//! keep the direct insert until a later wave.
//!
//! Parity notes:
//! - click: UA truncated to 200, referer to 500, country guessed from the
//!   first accept-language tag's "-XX" suffix (regex /-([A-Z]{2})\b/i port,
//!   byte-scanned — ASCII-safe under UTF-8). JS `slice` counts UTF-16 code
//!   units vs Rust chars here; every realistic UA/referer is ASCII so the
//!   results agree.
//! - create: the zod v4 schema (createSchema in links/actions.ts) is mirrored
//!   message-for-message in field order (clientId → destination → label →
//!   customSlug → utm*). Slug generation mirrors findUniqueSlug: 6 attempts
//!   at length 6/6/7/7/8/8, then a length-10 fallback without a check.
//! - delete: FK cascade removes the click rows (foreign_keys pragma is on,
//!   see db.rs).

use crate::internal::{is_url, json_number, log_activity, result_json, Activity};
use crate::util::now_ms;
use crate::AppState;
use axum::body::Bytes;
use axum::extract::State;
use axum::response::Response;
use rand::Rng;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/// Port of generateSlug — crypto.randomBytes over the same 56-char
/// alphabet (no 0/O/1/l look-alikes).
fn generate_slug(length: usize) -> String {
    let mut rng = rand::thread_rng();
    (0..length)
        .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
        .collect()
}

/// Port of findUniqueSlug — 6 collision-checked attempts (length grows
/// 6,6,7,7,8,8), then the unchecked length-10 fallback.
fn generate_unique_slug(db: &crate::db::Db) -> String {
    for attempt in 0..6 {
        let length = 6 + attempt / 2;
        let slug = generate_slug(length);
        let taken: Option<i64> = db
            .with_conn(|c| {
                c.query_row(
                    "SELECT id FROM short_links WHERE slug = ?1 LIMIT 1",
                    params![slug],
                    |r| r.get(0),
                )
                .optional()
            })
            .ok()
            .flatten();
        if taken.is_none() {
            return slug;
        }
    }
    generate_slug(10)
}

// ---------------------------------------------------------------------------
// Body validation — mirrors the zod v4 schemas message-for-message.
// ---------------------------------------------------------------------------

fn err_invalid_number_nan() -> String {
    "Invalid input: expected number, received NaN".into()
}

/// z.coerce.number().int().positive() — used for shortLinkId and the
/// delete id.
fn v_positive_id(v: Option<&Value>) -> Result<i64, String> {
    match json_number(v) {
        None => Err(err_invalid_number_nan()),
        Some(n) if n.is_nan() => Err(err_invalid_number_nan()),
        Some(n) if n.fract() != 0.0 => {
            Err("Invalid input: expected int, received number".into())
        }
        Some(n) if n <= 0.0 => Err("Too small: expected number to be >0".into()),
        Some(n) => Ok(n as i64),
    }
}

/// clientId: `.optional().or(z.literal("").transform(() => undefined))` —
/// "" is consumed by the right branch and becomes absent; otherwise the
/// coerce number path applies.
fn v_opt_client_id(v: Option<&Value>) -> Result<Option<i64>, String> {
    match v {
        None => Ok(None),
        Some(Value::String(s)) if s.is_empty() => Ok(None),
        Some(inner) => Ok(Some(v_positive_id(Some(inner))?)),
    }
}

/// z.string().trim().max(N).optional().or(literal("").transform) — "" stays
/// "" (left branch consumes it), matching v_max_len_optional in tasks.rs.
fn v_cap_optional(v: Option<&Value>, max: usize) -> Result<Option<String>, String> {
    match v {
        None => Ok(None),
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.chars().count() > max {
                Err(format!("Too big: expected string to have <={max} characters"))
            } else {
                Ok(Some(t.to_string()))
            }
        }
        Some(_) => Err("Invalid input".into()), // union fallback, zod v4
    }
}

/// customSlug: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/)
/// .optional().or(literal("").transform) — "" → absent.
fn v_slug(v: Option<&Value>) -> Result<Option<String>, String> {
    match v {
        None => Ok(None),
        Some(Value::String(s)) if s.is_empty() => Ok(None),
        Some(Value::String(s)) => {
            let t = s.trim();
            let n = t.chars().count();
            if n < 2 {
                Err("Too small: expected string to have >=2 characters".into())
            } else if n > 40 {
                Err("Too big: expected string to have <=40 characters".into())
            } else if !t
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            {
                Err("Invalid input".into())
            } else {
                Ok(Some(t.to_string()))
            }
        }
        Some(_) => Err("Invalid input".into()),
    }
}

/// destination: z.string().trim().min(1) + https:// prefix + z.string().url()
/// — the prefixing happens Next-side in the zod transform; what arrives here
/// must already be absolute, so only the URL shape is re-checked.
fn v_destination(v: Option<&Value>) -> Result<String, String> {
    match v {
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.is_empty() {
                Err("Too small: expected string to have >=1 characters".into())
            } else if !is_url(t) {
                Err("Invalid url".into())
            } else {
                Ok(t.to_string())
            }
        }
        None => Err("Invalid input: expected string, received undefined".into()),
        Some(_) => Err("Invalid input".into()),
    }
}

/// Port of guessCountryFromAcceptLanguage: first comma-separated tag, first
/// "-XX" run of exactly two ASCII letters followed by a word boundary.
fn country_hint(accept_language: Option<&str>) -> Option<String> {
    let al = accept_language?;
    let first = al.split(',').next()?.trim();
    let b = first.as_bytes();
    for i in 0..b.len() {
        if b[i] != b'-' || i + 3 > b.len() {
            continue;
        }
        let (a, c) = (b[i + 1], b[i + 2]);
        if !(a.is_ascii_alphabetic() && c.is_ascii_alphabetic()) {
            continue;
        }
        // \b — the char after the two letters must be a non-word char.
        if i + 3 < b.len() && b[i + 3].is_ascii_alphanumeric() {
            continue;
        }
        return Some(
            format!("{}{}", (a as char).to_ascii_uppercase(), (c as char).to_ascii_uppercase())
        );
    }
    None
}

fn opt_str_trunc(v: Option<&Value>, max: usize) -> Option<String> {
    v.and_then(|x| x.as_str())
        .map(|s| s.chars().take(max).collect())
}

// ---------------------------------------------------------------------------
// POST /api/internal/short-links/click
// ---------------------------------------------------------------------------

pub async fn click(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);

    let link_id = match v_positive_id(body.get("shortLinkId")) {
        Ok(n) => n,
        Err(e) => return result_json(json!({ "ok": false, "error": e })),
    };
    let ua = opt_str_trunc(body.get("userAgent"), 200);
    let referer = opt_str_trunc(body.get("referer"), 500);
    let country = country_hint(body.get("acceptLanguage").and_then(|v| v.as_str()));
    let now_secs = now_ms() / 1000;

    // Both writes commit or fail together — a counted click with no click
    // row (or the reverse) would break the analytics joins.
    let res = state.db.with_conn(|c| {
        let tx = c.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO short_link_clicks (short_link_id, user_agent, referer, country_hint) \
             VALUES (?1, ?2, ?3, ?4)",
            params![link_id, ua, referer, country],
        )?;
        tx.execute(
            "UPDATE short_links SET click_count = click_count + 1, last_click_at = ?2 \
             WHERE id = ?1",
            params![link_id, now_secs],
        )?;
        tx.commit()?;
        Ok(())
    });
    match res {
        Ok(()) => result_json(json!({ "ok": true })),
        // FK violation lands here when the link was deleted between the
        // redirector's read and the click write — a lost click is fine.
        Err(e) => result_json(json!({ "ok": false, "error": e.to_string() })),
    }
}

// ---------------------------------------------------------------------------
// POST /api/internal/short-links/create
// ---------------------------------------------------------------------------

pub async fn create(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);

    // Field order = the zod schema's error precedence order.
    let client_id = match v_opt_client_id(body.get("clientId")) {
        Ok(v) => v,
        Err(e) => return result_json(json!({ "ok": false, "error": e })),
    };
    let destination = match v_destination(body.get("destination")) {
        Ok(v) => v,
        Err(e) => return result_json(json!({ "ok": false, "error": e })),
    };
    let label = match v_cap_optional(body.get("label"), 120) {
        Ok(v) => v,
        Err(e) => return result_json(json!({ "ok": false, "error": e })),
    };
    let custom_slug = match v_slug(body.get("customSlug")) {
        Ok(v) => v,
        Err(e) => return result_json(json!({ "ok": false, "error": e })),
    };
    let utm_source = match v_cap_optional(body.get("utmSource"), 120) {
        Ok(v) => v,
        Err(e) => return result_json(json!({ "ok": false, "error": e })),
    };
    let utm_medium = match v_cap_optional(body.get("utmMedium"), 120) {
        Ok(v) => v,
        Err(e) => return result_json(json!({ "ok": false, "error": e })),
    };
    let utm_campaign = match v_cap_optional(body.get("utmCampaign"), 120) {
        Ok(v) => v,
        Err(e) => return result_json(json!({ "ok": false, "error": e })),
    };
    let utm_term = match v_cap_optional(body.get("utmTerm"), 120) {
        Ok(v) => v,
        Err(e) => return result_json(json!({ "ok": false, "error": e })),
    };
    let utm_content = match v_cap_optional(body.get("utmContent"), 120) {
        Ok(v) => v,
        Err(e) => return result_json(json!({ "ok": false, "error": e })),
    };

    if let Some(slug) = &custom_slug {
        let taken: Option<i64> = state
            .db
            .with_conn(|c| {
                c.query_row(
                    "SELECT id FROM short_links WHERE slug = ?1 LIMIT 1",
                    params![slug],
                    |r| r.get(0),
                )
                .optional()
            })
            .ok()
            .flatten();
        if taken.is_some() {
            return result_json(json!({
                "ok": false,
                "error": format!("Slug \"{slug}\" is already taken — pick another.")
            }));
        }
    }

    let slug = custom_slug.unwrap_or_else(|| generate_unique_slug(&state.db));

    let insert = state.db.with_conn(|c| {
        c.execute(
            "INSERT INTO short_links \
             (client_id, slug, destination, label, utm_source, utm_medium, utm_campaign, utm_term, utm_content) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                client_id,
                slug,
                destination,
                label,
                utm_source,
                utm_medium,
                utm_campaign,
                utm_term,
                utm_content,
            ],
        )?;
        Ok(c.last_insert_rowid())
    });
    let row_id = match insert {
        Ok(id) => id,
        Err(e) => return result_json(json!({ "ok": false, "error": e.to_string() })),
    };

    if let Some(cid) = client_id {
        log_activity(
            &state.db,
            &Activity {
                kind: "task.created",
                message: &format!("Created short link /r/{slug}"),
                level: "info",
                client_id: Some(cid),
                entity_type: Some("short_link"),
                entity_id: Some(row_id),
                user_id: None,
                dedupe: true,
                dedupe_window_minutes: 60 * 24,
            },
        );
    }

    result_json(json!({ "ok": true, "id": row_id, "slug": slug }))
}

// ---------------------------------------------------------------------------
// POST /api/internal/short-links/delete
// ---------------------------------------------------------------------------

pub async fn delete_link(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);

    let id = match v_positive_id(body.get("id")) {
        Ok(n) => n,
        Err(e) => return result_json(json!({ "ok": false, "error": e })),
    };

    match state
        .db
        .with_conn(|c| c.execute("DELETE FROM short_links WHERE id = ?1", params![id]))
    {
        Ok(_) => result_json(json!({ "ok": true })),
        Err(e) => result_json(json!({ "ok": false, "error": e.to_string() })),
    }
}
