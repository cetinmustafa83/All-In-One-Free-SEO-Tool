//! Tools wave 2 (COMPUTE) — Task 14.6b.
//!
//! Ports the computation half of the `tools/*` server actions that are
//! provably local (no outbound network, no AI provider) along with their
//! saveToolRun bookkeeping:
//!
//!   utm-attribution  runAttribution — parsePastedTouches + classifyChannel
//!                                     + first/last/assisted/linear/position
//!                                     aggregation, entirely over PASTED
//!                                     text (the full call graph touches no
//!                                     network and no AI).
//!   migration-map    runMapping     — buildMigrationMap (slug-token Jaccard
//!                                     + tail bonus + depth penalty) +
//!                                     renderRedirectMap (nginx/apache/
//!                                     nextjs), plus the tool_runs row.
//!
//! Triage (Task 14.6b) — the other 10 candidates stay Next-side, honestly:
//!   meta-tag-generator  callAI → provider-dispatch               (AI)
//!   social-preview      extractSocialPreviews → fetchHtml        (NET)
//!   anchor-distribution extractAnchorDistribution → fetchHtml    (NET)
//!   schema-validate     validateSchemaFromUrl → fetchHtml        (NET)
//!   ai-robots           auditAiBotRobots → guardedFetch robots.txt (NET)
//!   link-graph          analyseInternalLinks → fetch robots/sitemaps/pages (NET)
//!   link-intersect      DuckDuckGo search + fetchPageHtml        (NET)
//!   link-recommender    callAI + internal-link-graph crawler     (NET+AI)
//!   cluster             callAI + scanSerp + fetch                (NET+AI)
//!   content-grader      buildCorpus → scanSerp + per-result fetch (NET)
//!
//! Regex parity note (no regex crate): every regex the two ported functions
//! use is exactly replicable with string ops —
//!   /\r?\n/            → split('\n') then strip ONE trailing '\r'
//!   /,|\t/             → per-char split on ',' or '\t' (the regex's run
//!                         collapse is observationally identical after the
//!                         same empty/short-token filter)
//!   /^"|"$/g           → strip_prefix('"') then strip_suffix('"')
//!   /^(?:a|b|c)$/i     → lowercase + fixed-set membership (ASCII literals)
//!   /\.(html?|php|aspx?|jsp)$/ → ends-with chain on the already lowercased
//!                         path (only one alternative can match a tail)
//!   /[\/\-_~,;:]+/     → per-char split + same filter (see /,|\t/)
//!   /\/$/              → strip_suffix('/')
//!   /[.+?$|()[\]\\]/g  → char-in-set escape loop
//! runMapping's one non-regex dependency — `new URL` for pathname/search —
//! stays Next-side (verdicts-over-the-wire, the 14.5b/14.6a precedent): the
//! proxy pre-shapes every URL into {url, pathname, search, ok} with real
//! WHATWG parsing and this module does everything else, including the
//! try/catch fallbacks via the ok flag.
//!
//! Bookkeeping note: the original actions wrap saveToolRun in
//! `.catch(() => undefined)` — the runs table is deliberately best-effort
//! ("losing the answer to protect the bookkeeping is the wrong trade",
//! tool-findings.ts). So unlike the primary-effect writes elsewhere, a
//! failed tool_runs insert here is LOGGED (tracing::warn) and the computed
//! result is still returned — mirroring the original contract instead of
//! silently dropping the error or 500-ing the user's answer away.
//!
//! Math parity: JS Math.round is spec'd as floor(x + ½) → internal::js_round;
//! string sort `<` is UTF-16 code-unit order → js_str_lt; `(x).toFixed(0)`
//! is nearest-with-ties-larger on the exact value → js_to_fixed0; JSON
//! numbers that are whole in JS ("2", not "2.0") go through js_num.

use crate::internal::{js_round, result_json};
use crate::util::{js_slice, js_string, now_iso};
use crate::AppState;
use axum::body::Bytes;
use axum::extract::State;
use axum::response::Response;
use rusqlite::params;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

fn body_of(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).unwrap_or(Value::Null)
}

// ---------------------------------------------------------------------------
// JS primitives (exact, no regex crate)
// ---------------------------------------------------------------------------

/// JS String.prototype.trim removes exactly: TAB VT FF SP NBSP, the Zs
/// category, LS/PS and ZWNBSP (U+FEFF). Rust's trim differs on U+0085 (in)
/// and U+FEFF (out) — this is the exact JS set.
fn is_js_ws(c: char) -> bool {
    matches!(
        c,
        '\u{09}' | '\u{0A}' | '\u{0B}' | '\u{0C}' | '\u{0D}' | '\u{20}'
            | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}'
            | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}'
            | '\u{FEFF}'
    )
}

fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_ws)
}

/// JS `s.replace(/^"|"$/g, "")` — one leading and one trailing quote.
fn strip_edge_quotes(s: &str) -> &str {
    let a = s.strip_prefix('"').unwrap_or(s);
    a.strip_suffix('"').unwrap_or(a)
}

/// JS string `<` — UTF-16 code-unit order (String.prototype comparison).
fn js_str_lt(a: &str, b: &str) -> bool {
    let mut ai = a.encode_utf16();
    let mut bi = b.encode_utf16();
    loop {
        match (ai.next(), bi.next()) {
            (None, None) => return false,
            (None, Some(_)) => return true,
            (Some(_), None) => return false,
            (Some(x), Some(y)) => {
                if x != y {
                    return x < y;
                }
            }
        }
    }
}

/// Whole doubles serialize the JS way: JSON.stringify(2.0) → "2".
fn js_num(x: f64) -> Value {
    if x.is_finite() && x == x.trunc() && x.abs() < 9.007_199_254_740_992e15 {
        Value::from(x as i64)
    } else {
        Value::from(x)
    }
}

/// `(x).toFixed(0)` — nearest integer on the exact value, ties to the LARGER
/// (spec: "If there are two such n, pick the larger n").
fn js_to_fixed0(x: f64) -> i64 {
    let fl = x.floor();
    let frac = x - fl;
    if frac >= 0.5 {
        fl as i64 + 1
    } else {
        fl as i64
    }
}

/// Insertion-ordered map (JS Map iteration order) without new deps.
struct OrdMap<V> {
    entries: Vec<(String, V)>,
    idx: HashMap<String, usize>,
}

impl<V> OrdMap<V> {
    fn new() -> Self {
        OrdMap { entries: Vec::new(), idx: HashMap::new() }
    }
    /// Existing value or a freshly-inserted zero value (JS `get ?? init`).
    fn entry_or_default(&mut self, key: &str, make: impl FnOnce() -> V) -> &mut V {
        if !self.idx.contains_key(key) {
            self.idx.insert(key.to_string(), self.entries.len());
            self.entries.push((key.to_string(), make()));
        }
        let i = self.idx[key];
        &mut self.entries[i].1
    }
    fn iter(&self) -> impl Iterator<Item = (&String, &V)> {
        self.entries.iter().map(|(k, v)| (k, v))
    }
}

// ---------------------------------------------------------------------------
// saveToolRun port (src/lib/tool-runs.ts) — shared by both endpoints
// ---------------------------------------------------------------------------

struct ToolRunRefs {
    client_id: Option<i64>,
    user_id: Option<i64>,
}

fn refs_of(body: &Value) -> ToolRunRefs {
    ToolRunRefs {
        client_id: body.get("clientId").and_then(|v| v.as_i64()),
        user_id: body.get("userId").and_then(|v| v.as_i64()),
    }
}

/// Drizzle toolRuns insert: label.slice(0,200), input/result as JSON text
/// (mode:"json"), createdAt takes the DDL default (unixepoch).
fn save_tool_run(
    state: &AppState,
    tool_id: &str,
    label: &str,
    input: &Value,
    result: &Value,
    refs: &ToolRunRefs,
) -> rusqlite::Result<i64> {
    let label = js_slice(label, 200);
    let input_text = serde_json::to_string(input).unwrap_or_else(|_| "null".into());
    let result_text = serde_json::to_string(result).unwrap_or_else(|_| "null".into());
    state.db.with_conn(|c| {
        c.query_row(
            "INSERT INTO tool_runs (client_id, tool_id, label, input_json, result_json, user_id) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id",
            params![refs.client_id, tool_id, label, input_text, result_text, refs.user_id],
            |r| r.get::<_, i64>(0),
        )
    })
}

// ---------------------------------------------------------------------------
// utm-attribution: runAttribution
// ---------------------------------------------------------------------------

struct Touch {
    timestamp: String,
    source: String,
    medium: String,
    user_id: Option<String>,
}

#[derive(Clone, Copy)]
struct ChannelStats {
    first: i64,
    last: i64,
    assisted: i64,
    linear: f64,
    position: f64,
    inclusion: i64,
}

/// raw.split(/\r?\n/), trimmed, empties dropped — exact.
fn split_lines(raw: &str) -> Vec<String> {
    raw.split('\n')
        .map(|l| {
            let l = l.strip_suffix('\r').unwrap_or(l);
            js_trim(l).to_string()
        })
        .filter(|l| !l.is_empty())
        .collect()
}

/// Per-cell transform of parsePastedTouches: `s.trim().replace(/^"|"$/g,"")`
/// (header cells lowercase first).
fn cell(line: &str, lowercase: bool) -> String {
    let c = strip_edge_quotes(js_trim(line));
    if lowercase {
        c.to_lowercase()
    } else {
        c.to_string()
    }
}

/// Split on `,` or `\t` per char; after the token filter downstream this is
/// observationally identical to the regex's run-collapse split.
fn split_cols(line: &str) -> Vec<String> {
    line.split(|c| c == ',' || c == '\t').map(String::from).collect()
}

fn classify_channel(source: &str, medium: &str) -> String {
    if source.is_empty() && medium.is_empty() {
        return "Direct".into();
    }
    let src = source.to_lowercase();
    let med = medium.to_lowercase();
    if matches!(src.as_str(), "google" | "bing" | "yahoo" | "duckduckgo") {
        return if med.starts_with("cpc") || med.contains("paid") {
            "Paid Search".into()
        } else {
            "Organic Search".into()
        };
    }
    if matches!(
        src.as_str(),
        "facebook" | "instagram" | "tiktok" | "linkedin" | "x" | "twitter"
            | "reddit" | "pinterest" | "youtube"
    ) {
        return if med.contains("paid") {
            "Paid Social".into()
        } else {
            "Social".into()
        };
    }
    // CHANNEL_RULES in order; /^(?:…)$/i is an exact match on the folded
    // medium. Note paid_social lands in Paid Search (first rule wins).
    const RULES: [(&[&str], &str); 9] = [
        (&["cpc", "paid", "ppc", "paid_social", "paidsocial"], "Paid Search"),
        (&["social", "paid_social", "paidsocial"], "Paid Social"),
        (&["organic"], "Organic Search"),
        (&["email", "newsletter"], "Email"),
        (&["referral"], "Referral"),
        (&["affiliate"], "Affiliate"),
        (&["display", "banner"], "Display"),
        (&["video"], "Video"),
        (&["none", "(none)", "direct"], "Direct"),
    ];
    for (set, channel) in RULES {
        if set.contains(&med.as_str()) {
            return channel.into();
        }
    }
    if !medium.is_empty() {
        return format!("Other ({medium})");
    }
    "Direct".into()
}

/// Port of parsePastedTouches → (touches, conversions in insertion order).
fn parse_pasted_touches(raw: &str) -> (Vec<Touch>, Vec<String>) {
    let lines = split_lines(raw);
    if lines.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let header: Vec<String> =
        split_cols(&lines[0]).iter().map(|c| cell(c, true)).collect();
    let has_header = header
        .iter()
        .any(|h| h == "timestamp" || h == "source" || h == "medium");
    let data_lines: &[String] = if has_header { &lines[1..] } else { &lines };

    let idx = |name: &str| header.iter().position(|h| h == name);
    let mut touches: Vec<Touch> = Vec::new();
    let mut conversions: Vec<String> = Vec::new();
    let mut conv_seen: HashSet<String> = HashSet::new();

    for line in data_lines {
        let cols: Vec<String> =
            split_cols(line).iter().map(|c| cell(c, false)).collect();
        let get = |key: &str| -> String {
            if has_header {
                if let Some(i) = idx(key) {
                    return cols.get(i).cloned().unwrap_or_default();
                }
            }
            String::new()
        };
        let pick = |primary: String, fb: Option<&String>| -> String {
            if !primary.is_empty() {
                primary
            } else {
                fb.filter(|f| !f.is_empty()).cloned().unwrap_or_default()
            }
        };
        let source = pick(get("source"), cols.get(1));
        let medium = pick(get("medium"), cols.get(2));
        if source.is_empty() && medium.is_empty() {
            continue;
        }
        let user_id: Option<String> = {
            let a = get("userid");
            let b = get("user_id");
            if !a.is_empty() {
                Some(a)
            } else if !b.is_empty() {
                Some(b)
            } else {
                cols.first().filter(|f| !f.is_empty()).cloned()
            }
        };
        let timestamp = {
            let t = get("timestamp");
            if t.is_empty() { now_iso() } else { t }
        };
        touches.push(Touch {
            timestamp,
            source: source.clone(),
            medium: medium.clone(),
            user_id: user_id.clone(),
        });
        if get("isconversion") == "1" || get("is_conversion") == "1" || get("conversion") == "1" {
            if let Some(u) = &user_id {
                if conv_seen.insert(u.clone()) {
                    conversions.push(u.clone());
                }
            }
        }
    }
    // No explicit conversions → every user's final touch counts as one.
    if conversions.is_empty() {
        for t in &touches {
            if let Some(u) = &t.user_id {
                if conv_seen.insert(u.clone()) {
                    conversions.push(u.clone());
                }
            }
        }
    }
    (touches, conversions)
}

/// POST /api/internal/tools/utm-attribution/run
pub async fn utm_run(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body = body_of(&bytes);
    // The proxy trims with JS semantics already; re-trim for direct callers.
    let raw = js_trim(&js_string(body.get("touches"))).to_string();
    if raw.is_empty() {
        return result_json(json!({ "ok": false, "error": "Paste touch data first." }));
    }
    let (touches, conversions) = parse_pasted_touches(&raw);
    if touches.is_empty() {
        return result_json(json!({ "ok": false, "error": "Couldn't parse any touches." }));
    }

    // Group touches by user (insertion order = first appearance).
    let mut by_user: OrdMap<Vec<usize>> = OrdMap::new();
    for (i, t) in touches.iter().enumerate() {
        let u = match &t.user_id {
            Some(u) => u.clone(),
            // anon-{Math.random()} only ever needs to be unique per touch —
            // the id itself never reaches the output.
            None => format!("anon-{i}"),
        };
        by_user.entry_or_default(&u, Vec::new).push(i);
    }
    let mut lists: Vec<(String, Vec<usize>)> = by_user
        .entries
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    for (_, list) in lists.iter_mut() {
        // JS comparator is (a.timestamp < b.timestamp ? -1 : 1); the equal
        // case is mapped to Equal (V8's order for it is unspecified).
        list.sort_by(|&a, &b| {
            let ta = &touches[a].timestamp;
            let tb = &touches[b].timestamp;
            if js_str_lt(ta, tb) {
                std::cmp::Ordering::Less
            } else if ta == tb {
                std::cmp::Ordering::Equal
            } else {
                std::cmp::Ordering::Greater
            }
        });
    }

    let mut channels: OrdMap<ChannelStats> = OrdMap::new();
    let mk = || ChannelStats {
        first: 0,
        last: 0,
        assisted: 0,
        linear: 0.0,
        position: 0.0,
        inclusion: 0,
    };
    let mut paths: Vec<Vec<String>> = Vec::new();

    for (user, list) in &lists {
        if !conversions.iter().any(|c| c == user) {
            continue;
        }
        let path: Vec<String> = list
            .iter()
            .map(|&i| classify_channel(&touches[i].source, &touches[i].medium))
            .collect();
        paths.push(path.clone());

        let len = path.len();
        channels.entry_or_default(&path[0], mk).first += 1;
        channels.entry_or_default(&path[len - 1], mk).last += 1;
        if len > 2 {
            for c in &path[1..len - 1] {
                channels.entry_or_default(c, mk).assisted += 1;
            }
        }
        for c in &path {
            channels.entry_or_default(c, mk).linear += 1.0 / len as f64;
        }
        if len == 1 {
            channels.entry_or_default(&path[0], mk).position += 1.0;
        } else if len == 2 {
            channels.entry_or_default(&path[0], mk).position += 0.5;
            channels.entry_or_default(&path[1], mk).position += 0.5;
        } else {
            channels.entry_or_default(&path[0], mk).position += 0.4;
            channels.entry_or_default(&path[len - 1], mk).position += 0.4;
            let mid_share = 0.2 / (len - 2) as f64;
            for c in &path[1..len - 1] {
                channels.entry_or_default(c, mk).position += mid_share;
            }
        }
        let mut distinct: HashSet<&str> = HashSet::new();
        for c in &path {
            if distinct.insert(c.as_str()) {
                channels.entry_or_default(c, mk).inclusion += 1;
            }
        }
    }

    // Round BEFORE the sort, exactly like the map() in front of sort().
    let mut sorted: Vec<(String, ChannelStats, f64, f64)> = channels
        .iter()
        .map(|(name, s)| {
            (
                name.clone(),
                ChannelStats { ..*s },
                js_round(s.linear * 100.0) / 100.0,
                js_round(s.position * 100.0) / 100.0,
            )
        })
        .collect();
    sorted.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

    let mut path_counts: OrdMap<(Vec<String>, i64)> = OrdMap::new();
    for p in &paths {
        let key = p.join(" → ");
        path_counts.entry_or_default(&key, || (p.clone(), 0)).1 += 1;
    }
    let mut top: Vec<(&Vec<String>, i64)> =
        path_counts.iter().map(|(_, (p, c))| (p, *c)).collect();
    top.sort_by(|a, b| b.1.cmp(&a.1));
    let top_paths: Vec<Value> = top
        .into_iter()
        .take(10)
        .map(|(p, c)| json!({ "path": p, "count": c }))
        .collect();

    let total_len: usize = paths.iter().map(|p| p.len()).sum();
    let avg = if paths.is_empty() {
        0.0
    } else {
        js_round((total_len as f64 / paths.len() as f64) * 10.0) / 10.0
    };

    let result = json!({
        "totalTouches": touches.len(),
        "totalConversions": conversions.len(),
        "uniqueUsers": lists.len(),
        "channels": sorted
            .iter()
            .map(|(name, s, linear, position)| json!({
                "channel": name,
                "firstTouches": s.first,
                "lastTouches": s.last,
                "assistedTouches": s.assisted,
                "linearCredit": js_num(*linear),
                "positionCredit": js_num(*position),
                "pathInclusion": s.inclusion,
            }))
            .collect::<Vec<_>>(),
        "topPaths": top_paths,
        "averagePathLength": js_num(avg),
    });

    let refs = refs_of(&body);
    let label = format!("{} conversions · {} users", conversions.len(), lists.len());
    let input = json!({ "lineCount": raw.split('\n').count() });
    let saved = json!({ "ok": true, "result": result });
    if let Err(e) = save_tool_run(&state, "utm-attribution", &label, &input, &saved, &refs) {
        // Best-effort bookkeeping, exactly like the original's
        // saveToolRun(...).catch(() => undefined) — the user keeps their
        // answer; the failure is logged, not silently dropped.
        tracing::warn!("tool_runs write failed for utm-attribution: {e}");
    }
    result_json(saved)
}

// ---------------------------------------------------------------------------
// migration-map: runMapping (buildMigrationMap + renderRedirectMap)
// ---------------------------------------------------------------------------

const STRONG: f64 = 0.85;
const WEAK: f64 = 0.5;

/// One URL as pre-shaped by the Next proxy: the WHATWG `new URL` semantics
/// (pathname/search, dot segments, percent-encoding) stay Next-side — the
/// 14.5b/14.6a verdicts-over-the-wire split. `ok:false` reproduces the
/// original's try/catch fallbacks (samePath string equality, tokenize over
/// the raw url, pathOnly returns the raw url).
struct Shaped {
    url: String,
    pathname: String,
    search: String,
    ok: bool,
}

fn shaped_of(v: &Value) -> Shaped {
    match v {
        // Tolerate a direct caller sending plain strings: degrade to the
        // no-parse path (same fallbacks the original used on URL errors).
        Value::String(s) => Shaped {
            url: s.clone(),
            pathname: String::new(),
            search: String::new(),
            ok: false,
        },
        Value::Object(_) => Shaped {
            url: js_string(v.get("url")),
            pathname: js_string(v.get("pathname")),
            search: js_string(v.get("search")),
            ok: v.get("ok").and_then(|b| b.as_bool()).unwrap_or(false),
        },
        _ => Shaped {
            url: String::new(),
            pathname: String::new(),
            search: String::new(),
            ok: false,
        },
    }
}

fn shaped_list(v: Option<&Value>) -> Option<Vec<Shaped>> {
    match v {
        Some(Value::Array(items)) => Some(items.iter().map(shaped_of).collect()),
        _ => None,
    }
}

/// normalize = trim; dedupe = Set insertion order; filter(Boolean).
fn dedupe(list: Vec<Shaped>) -> Vec<Shaped> {
    let mut out: Vec<Shaped> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for mut s in list {
        s.url = js_trim(&s.url).to_string();
        if s.url.is_empty() || !seen.insert(s.url.clone()) {
            continue;
        }
        out.push(s);
    }
    out
}

/// ua.pathname.replace(/\/$/, "") — one trailing slash.
fn strip_trailing_slash(p: &str) -> &str {
    p.strip_suffix('/').unwrap_or(p)
}

/// Port of samePath: both URLs must have parsed (ok) for the pathname/search
/// comparison, else plain string equality (the original's catch arm).
fn same_path(a: &Shaped, b: &Shaped) -> bool {
    if a.ok && b.ok {
        strip_trailing_slash(&a.pathname) == strip_trailing_slash(&b.pathname)
            && a.search == b.search
    } else {
        a.url == b.url
    }
}

/// /\.(html?|php|aspx?|jsp)$/ — at most one of these can match a given tail.
fn strip_extension(path: &str) -> &str {
    for ext in [".html", ".htm", ".php", ".aspx", ".asp", ".jsp"] {
        if let Some(base) = path.strip_suffix(ext) {
            return base;
        }
    }
    path
}

/// Port of tokenizeUrl — path from the WHATWG pathname (or the raw url when
/// the URL never parsed), lowercased, extension stripped, split on separator
/// runs, tokens longer than one char kept.
fn tokenize_url(s: &Shaped) -> Vec<String> {
    let path = if s.ok { s.pathname.as_str() } else { s.url.as_str() };
    let lowered = path.to_lowercase();
    strip_extension(&lowered)
        .split(|c| matches!(c, '/' | '-' | '_' | '~' | ',' | ';' | ':'))
        .filter(|t| t.len() > 1)
        .map(String::from)
        .collect()
}

/// Port of similarity: Jaccard + 0.2 same-tail bonus − depth penalty,
/// clamped to [0,1]. Same operation order → same f64.
fn similarity(a: &[String], b: &[String]) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 0.0;
    }
    let set_b: HashSet<&String> = b.iter().collect();
    let mut set_a_seen: HashSet<&String> = HashSet::new();
    let mut inter = 0usize;
    let mut union: HashSet<&String> = b.iter().collect();
    for t in a {
        if set_a_seen.insert(t) {
            if set_b.contains(t) {
                inter += 1;
            }
            union.insert(t);
        }
    }
    let jaccard = if union.is_empty() {
        0.0
    } else {
        inter as f64 / union.len() as f64
    };
    let last_a = a.last().map(String::as_str).unwrap_or("");
    let last_b = b.last().map(String::as_str).unwrap_or("");
    let tail_bonus = if !last_a.is_empty() && last_a == last_b { 0.2 } else { 0.0 };
    let depth_diff =
        (a.len() as f64 - b.len() as f64).abs() / 1f64.max(a.len().max(b.len()) as f64);
    let depth_penalty = depth_diff * 0.15;
    (jaccard + tail_bonus - depth_penalty).clamp(0.0, 1.0)
}

/// Port of explainScore — shared tokens in setA first-occurrence order.
fn explain_score(a: &[String], b: &[String], s: f64) -> String {
    let set_b: HashSet<&String> = b.iter().collect();
    let mut seen: HashSet<&String> = HashSet::new();
    let shared: Vec<&str> = a
        .iter()
        .filter(|t| set_b.contains(*t) && seen.insert(*t))
        .map(String::as_str)
        .collect();
    let pct = js_to_fixed0(s * 100.0);
    if shared.is_empty() {
        format!("Low similarity ({pct}%)")
    } else {
        format!(
            "Shared: {} ({pct}%)",
            shared.iter().take(4).cloned().collect::<Vec<_>>().join(", ")
        )
    }
}

/// Port of pathOnly: pathname + search, or the raw url when the URL never
/// parsed.
fn path_only(s: &Shaped) -> String {
    if s.ok {
        format!("{}{}", s.pathname, s.search)
    } else {
        s.url.clone()
    }
}

/// /[.+?$|()[\]\\]/g → "\\$&"
fn escape_nginx_path(p: &str) -> String {
    let mut out = String::with_capacity(p.len() + 8);
    for c in p.chars() {
        if matches!(c, '+' | '.' | '?' | '$' | '|' | '(' | ')' | '[' | ']' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

struct MapRow {
    old_url: String,
    new_url: Option<String>,
    confidence: f64,
    reason: String,
}

/// POST /api/internal/tools/migration-map/run
pub async fn migration_run(State(state): State<AppState>, bytes: Bytes) -> Response {
    let body = body_of(&bytes);
    let Some(olds) = shaped_list(body.get("olds")) else {
        return result_json(json!({ "ok": false, "error": "Paste old URLs (one per line)." }));
    };
    let Some(news) = shaped_list(body.get("news")) else {
        return result_json(json!({ "ok": false, "error": "Paste new URLs (one per line)." }));
    };
    let olds = dedupe(olds);
    let news = dedupe(news);
    if olds.is_empty() {
        return result_json(json!({ "ok": false, "error": "Paste old URLs (one per line)." }));
    }
    if news.is_empty() {
        return result_json(json!({ "ok": false, "error": "Paste new URLs (one per line)." }));
    }

    let new_slugs: Vec<(&Shaped, Vec<String>)> =
        news.iter().map(|n| (n, tokenize_url(n))).collect();

    let mut rows: Vec<MapRow> = Vec::new();
    for old in &olds {
        let old_tok = tokenize_url(old);

        // Exact match (path-only)
        if let Some(hit) = new_slugs.iter().find(|s| same_path(s.0, old)) {
            rows.push(MapRow {
                old_url: old.url.clone(),
                new_url: Some(hit.0.url.clone()),
                confidence: 1.0,
                reason: "Exact path match".into(),
            });
            continue;
        }

        // Best fuzzy match — strictly greater keeps the first best on ties.
        let mut best: Option<(&Shaped, f64, String)> = None;
        for (cand, tokens) in &new_slugs {
            let score = similarity(&old_tok, tokens);
            if best.as_ref().map(|b| score > b.1).unwrap_or(true) {
                best = Some((cand, score, explain_score(&old_tok, tokens, score)));
            }
        }
        let Some((cand, score, reason)) = best else {
            rows.push(MapRow {
                old_url: old.url.clone(),
                new_url: None,
                confidence: 0.0,
                reason: "No new URLs to compare against".into(),
            });
            continue;
        };
        if score >= STRONG {
            rows.push(MapRow {
                old_url: old.url.clone(),
                new_url: Some(cand.url.clone()),
                confidence: score,
                reason,
            });
        } else if score >= WEAK {
            rows.push(MapRow {
                old_url: old.url.clone(),
                new_url: Some(cand.url.clone()),
                confidence: score,
                reason: format!("{reason} — review"),
            });
        } else {
            rows.push(MapRow {
                old_url: old.url.clone(),
                new_url: None,
                confidence: score,
                reason: "No confident match — pick a category or 410".into(),
            });
        }
    }

    let matched = rows
        .iter()
        .filter(|r| r.new_url.is_some() && r.confidence >= STRONG)
        .count();
    let review = rows
        .iter()
        .filter(|r| r.new_url.is_some() && r.confidence >= WEAK && r.confidence < STRONG)
        .count();
    let total = rows.len();
    let avg = if total > 0 {
        rows.iter().fold(0.0_f64, |s, r| s + r.confidence) / total as f64
    } else {
        0.0
    };

    let map_json = json!({
        "rows": rows
            .iter()
            .map(|r| json!({
                "oldUrl": r.old_url,
                "newUrl": r.new_url.clone(),
                "confidence": js_num(r.confidence),
                "reason": r.reason,
            }))
            .collect::<Vec<_>>(),
        "summary": {
            "total": total,
            "matched": matched,
            "review": review,
            "avgConfidence": js_num(avg),
        }
    });

    // renderRedirectMap
    let usable: Vec<(&Shaped, &MapRow)> = olds
        .iter()
        .zip(rows.iter())
        .filter(|(_, r)| r.new_url.is_some())
        .collect();
    let nginx = usable
        .iter()
        .map(|(o, r)| {
            format!(
                "rewrite ^{}$ {} permanent;",
                escape_nginx_path(&path_only(o)),
                r.new_url.clone().unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let apache = usable
        .iter()
        .map(|(o, r)| {
            format!("Redirect 301 {} {}", path_only(o), r.new_url.clone().unwrap_or_default())
        })
        .collect::<Vec<_>>()
        .join("\n");
    let mut next =
        String::from("module.exports = {\n  async redirects() {\n    return [\n");
    let next_lines: Vec<String> = usable
        .iter()
        .map(|(o, r)| {
            format!(
                "      {{ source: {}, destination: {}, permanent: true }},",
                serde_json::to_string(&path_only(o)).unwrap_or_default(),
                serde_json::to_string(&r.new_url.clone().unwrap_or_default())
                    .unwrap_or_default(),
            )
        })
        .collect();
    next.push_str(&next_lines.join("\n"));
    next.push_str("\n    ];\n  },\n};");
    let output_json = json!({ "nginx": nginx, "apache": apache, "nextjs": next });

    let refs = refs_of(&body);
    let label = format!(
        "{} → {} URLs · {} matched",
        olds.len(),
        news.len(),
        rows.len()
    );
    let input = json!({ "oldCount": olds.len(), "newCount": news.len() });
    let saved = json!({ "ok": true, "map": map_json, "output": output_json });
    if let Err(e) = save_tool_run(&state, "migration-map", &label, &input, &saved, &refs) {
        tracing::warn!("tool_runs write failed for migration-map: {e}");
    }
    result_json(saved)
}
