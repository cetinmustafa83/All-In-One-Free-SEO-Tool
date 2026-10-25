/**
 * Task 14.8a — deterministic "nasty" seed for the CSV export golden fixtures.
 *
 * Creates rows with FIXED literal values (no wall-clock timestamps, explicit
 * primary keys) under the FIX148 marker so re-runs are idempotent: delete the
 * marker rows, insert the same rows with the same ids again. The byte-compare
 * fixtures in backend/fixtures/14.8/ stay valid forever — the CSV includes the
 * id column, so ids must not drift between runs (hence explicit ids, and
 * hence the accepted side effect that the tables' next autoincrement rowid
 * moves past 9903).
 *
 * Also deletes the VOLATILE rows earlier smoke runs leave behind (the
 * internal-smoke.sh sections create `Smoke Client <ts>` / `smoke-qa-<ts>`
 * clients and `smoke-ahrefs.test` backlinks with wall-clock created_at).
 * Without that cleanup the export output would differ between smoke runs and
 * no golden fixture could exist. These rows are pure smoke artifacts — the
 * same cleanup runs before every 14.8 smoke comparison.
 *
 * Row inventory (all FIX148-prefixed, epochs are fixed literals):
 *   clients      9901 (comma+quote+unicode name, CRLF tech-stack entries,
 *                      leading = + @ - cells)  9902 (all optional columns
 *                      NULL incl. tech_stack, created_at epoch 0)
 *   competitors  9901..9903 (embedded quotes, CRLF notes, NULL notes,
 *                           leading = in notes, leap-day epoch)
 *   audits       9901..9903 (NULL score / REAL 12.5 score, NULL + 1969 and
 *                           2100 timestamps, REAL fractional created_at .5,
 *                           CRLF target_url with quotes and leading =)
 *   backlinks    9901..9903 (CRLF+quotes+unicode notes, NULL columns, tab
 *                           char that must NOT trigger quoting, DA 0)
 *
 * Task 14.8b adds the FIX148B wave (ids 9911..9989 — disjoint from the 14.8a
 * 9901..9903 range so the earlier fixtures stay valid; the only 14.8a fixture
 * that sees new rows is backlinks.csv, which is re-captured from the ORIGINAL
 * Next implementation with the extended seed):
 *   tasks        9911..9915 (pure-\r title — quoted by the CANONICAL escape,
 *                           tab title — not quoted, NULL due/recurring/minutes,
 *                           1969/2000-02-29/2100 due dates, unicode)
 *   outreach     9921..9923 (CRLF+quotes notes, all-NULL optional columns,
 *                           REAL fractional last_contacted_at .5)
 *   reports      9931..9933 (pinned 1/0 → "true"/"false", NULL template/
 *                           periods/execSummary/pdfBytes, pdf_bytes 0, CRLF
 *                           exec summary, negative + 2100 period epochs)
 *   pages+changes 9941..9942 + 9951..9954 (INNER JOIN data: every change has
 *                           a page; severity NULL, CRLF old/new values, tab)
 *   keywords     9961..9965 + rankings 9971..9978 (≥2 keywords with multiple
 *                           rankings so the latest-row fold is exercised —
 *                           later checked_at overwrites earlier; one same-
 *                           checked_at tie pair proving last-scan-row-wins;
 *                           pure-\r query cell — NOT quoted by the BESPOKE
 *                           keywords escape while the canonical routes quote
 *                           the same byte; position 0 and NULL position)
 *   backlinks    9981..9986 disavow rows (duplicate source_domain → one
 *                           domain: group; mixed-case domain vs lowercase
 *                           proving the localeCompare fold; notes with
 *                           newlines collapsed to one space; one ACTIVE row
 *                           that must be filtered out; empty-string notes)
 *
 * Task 14.8c adds the FIX148C wave (ids 9989..9999 — tasks table only, so no
 * other 14.8a/b fixture changes except tasks.csv, which sees the new rows and
 * is re-captured from the ORIGINAL Next implementation):
 *   tasks        9989..9999 for the seed client (id 1), ALL source
 *                'auto_calendar' — the plan-export filter. Earliest-due edge
 *                (2025-01-28, a Tuesday: week 1 starts at the earliest due
 *                date, not the calendar week), a same-week cluster incl. an
 *                exact due_date TIE pair (sorter-stability canary), a
 *                month-boundary pair in one week (Jan 28 → Feb 3), weeks 2
 *                and 3, sparse far weeks (March/September/December — the
 *                September row pins the en-GB short month "Sept", four
 *                letters), 2 undated (NULL due_date → "No date" bucket,
 *                dueLabel "—"), titles/whys with leading = + - @ (the plan
 *                serializer's Excel-formula defuse), embedded quotes, a
 *                tab, CRLF, and unicode. All due dates are midnight-UTC
 *                fixed epochs.
 *
 * Run with Bun (bun:sqlite — better-sqlite3 does not load under Bun):
 *   bun run backend/tools/seed-14.8.ts
 */
import { Database } from "bun:sqlite";

const db = new Database("db/data.db");
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// ---- fixed epochs (never from the clock) ------------------------------------
const E = {
  compA: 1700000000, // 2023-11-14T22:13:20.000Z
  compB: 1700000001,
  compC: 951782400, // 2000-02-29T00:00:00.000Z (leap day)
  auditA: 1700000100,
  auditB: 253402300799, // 9999-12-31T23:59:59.000Z (max-ish JS year)
  auditC: 1714979289.5, // REAL fractional → .500 milliseconds
  blA: 1700000200,
  blB: 1700000201,
  blC: 951782460, // 2000-02-29T00:01:00.000Z
  clientA: 1714979289, // 2024-05-06T07:08:09.000Z
  clientB: 0, // 1970-01-01T00:00:00.000Z
  // ---- 14.8b (FIX148B wave) ----
  taskA: 1700000400,
  taskB: 1700000401,
  taskC: 1700000402,
  taskD: 1700000403,
  taskE: 1700000404,
  ocA: 1700000500,
  ocB: 1700000501,
  ocC: 1700000502,
  repA: 1700000600,
  repB: 1700000601,
  repC: 1700000602,
  pageA: 1700000700,
  pageB: 1700000701,
  chA: 1700000800,
  chB: 1700000801,
  chC: 1700000802,
  kwA: 1700000900,
  kwB: 1700000901,
  kwC: 1700000902,
  kwD: 1700000903,
  kwE: 1700000904,
  rankOld: 1700000950, // earlier checked_at (overwritten by the fold)
  rankNew: 1700001050, // later checked_at (must win the fold)
  rankA: 1700001000,
  rankTie: 1700001100, // tie pair — last scan row wins
  rankNull: 1700001200, // later than rankA → overwrites with NULLs
  rankZero: 1700001300,
  blD: 1700001400,
  blE: 1700001401,
  blF: 1700001402,
  blG: 1700001403,
  blH: 1700001404,
  blI: 1700001405,
  // ---- 14.8c (FIX148C wave — plan-export auto_calendar tasks, midnight UTC) ----
  planW1a: 1738022400, // 2025-01-28 (Tue) — earliest due; week 1 starts HERE
  planW1b: 1738108800, // 2025-01-29 — same week, next day (cluster)
  planW1c: 1738540800, // 2025-02-03 — month boundary, still week 1 (floor(6d/7d)=0)
  planW2: 1739145600,  // 2025-02-10 — week 2
  planW3: 1739750400,  // 2025-02-17 — week 3
  planMar: 1741564800, // 2025-03-10 — sparse far week ("10 Mar")
  planSep: 1757894400, // 2025-09-15 — pins en-GB short month "Sept"
  planDec: 1767139200, // 2025-12-31 — year-end month boundary
  planCreated: 1700002000, // + (id - 9989): deterministic tasks.csv ordering
  // ---- ambient rows the 14.8 fixtures pin (fresh-DB reproducibility) ----
  // These two rows existed in the working DB when the golden fixtures were
  // captured (2026-10-25 morning recovery) and are baked into
  // fixtures/14.8/audits.csv line 2 and keywords.csv line 2. The seed owns
  // them so a fresh db:migrate + seed client + this seed reproduces the
  // fixtures byte-for-byte. They are NOT part of the FIX148 id scheme —
  // the audit keeps its real id 1; the keyword lives at 9950 (inside the
  // 9901..9999 seed id band, outside the FIX148B ranges 9961..9969, so the
  // wave-2 deletes never touch it; rankings for it are wiped by the
  // marker-based delete below).
  auditAmbient: 1792909589, // 2026-10-25T06:26:29.000Z (audits.csv row 2)
  kwAmbient: 1792911976,    // 2026-10-25T07:06:16.000Z (keywords.csv row 2)
};

function seed(): void {
  // 1. volatile rows from previous internal-smoke.sh runs (wall-clock data).
  db.prepare(
    "DELETE FROM backlinks WHERE source_url LIKE 'https://smoke-ahrefs.test/%'",
  ).run();
  db.prepare(
    "DELETE FROM clients WHERE (name LIKE 'Smoke Client %' AND url LIKE 'https://smoke-client-%') OR url LIKE 'https://smoke-qa-%'",
  ).run();
  // section 3 of internal-smoke.sh creates one wall-clock task per run;
  // tasks.csv has no other non-deterministic rows.
  db.prepare("DELETE FROM tasks WHERE title LIKE 'smoke task %'").run();

  // 1b. ambient rows the 14.8 fixtures pin (re-create deterministically).
  // The audit keeps its real id 1; the 'seed keyword' lives at 9950 with
  // its ranking at 9940 (checked_at pinned, position/url NULL — the fold
  // has nothing to fold over, so the CSV cells stay empty).
  db.prepare("DELETE FROM audits WHERE id = 1").run();
  db.prepare(
    "DELETE FROM keyword_rankings WHERE keyword_id IN " +
      "(SELECT id FROM keywords WHERE query = 'seed keyword' AND client_id = 1)",
  ).run();
  db.prepare(
    "DELETE FROM keywords WHERE query = 'seed keyword' AND client_id = 1",
  ).run();
  db.prepare(
    `INSERT INTO audits (id, client_id, status, score, issues_count, started_at, completed_at, created_at, updated_at, kind, target_url)
     VALUES (1, 1, 'failed', NULL, 0, ?, ?, ?, ?, 'ai_full', 'https://seed.test')`,
  ).run(E.auditAmbient, E.auditAmbient, E.auditAmbient, E.auditAmbient);

  // 2. previous FIX148 rows (children first; client delete also cascades).
  db.prepare("DELETE FROM backlinks WHERE id >= 9901 AND id <= 9999").run();
  db.prepare("DELETE FROM audits WHERE id >= 9901 AND id <= 9999").run();
  db.prepare("DELETE FROM competitors WHERE id >= 9901 AND id <= 9999").run();
  db.prepare("DELETE FROM clients WHERE id >= 9901 AND id <= 9999").run();
  // marker-based safety net (covers rows inserted by older seed revisions)
  db.prepare("DELETE FROM backlinks WHERE source_url LIKE 'https://fix148.test/%'")
    .run();
  db.prepare("DELETE FROM audits WHERE target_url LIKE 'https://fix148.test/%'")
    .run();
  db.prepare("DELETE FROM competitors WHERE name LIKE 'FIX148%'").run();
  db.prepare("DELETE FROM clients WHERE name LIKE 'FIX148%'").run();

  // 2b. previous FIX148B rows (14.8b wave — children before parents).
  db.prepare("DELETE FROM keyword_rankings WHERE id >= 9971 AND id <= 9989").run();
  db.prepare("DELETE FROM keywords WHERE id >= 9961 AND id <= 9969").run();
  db.prepare("DELETE FROM page_changes WHERE id >= 9951 AND id <= 9959").run();
  db.prepare("DELETE FROM monitored_pages WHERE id >= 9941 AND id <= 9949").run();
  db.prepare("DELETE FROM report_archives WHERE id >= 9931 AND id <= 9939").run();
  db.prepare("DELETE FROM outreach_contacts WHERE id >= 9921 AND id <= 9929").run();
  db.prepare("DELETE FROM tasks WHERE id >= 9911 AND id <= 9919").run();
  db.prepare("DELETE FROM backlinks WHERE id >= 9911 AND id <= 9999").run();
  // 2c. previous FIX148C rows (14.8c wave — plan-export tasks only).
  db.prepare("DELETE FROM tasks WHERE id >= 9989 AND id <= 9999").run();
  // marker-based safety net for the 14.8c table.
  db.prepare("DELETE FROM tasks WHERE source_ref = 'FIX148C'").run();
  // marker-based safety nets for the 14.8b tables (backlinks markers only —
  // the other FIX148B tables never collide with the 14.8a FIX148 prefix set).
  db.prepare(
    "DELETE FROM backlinks WHERE source_url LIKE 'https://spam-%.test/%' OR source_url LIKE 'https://aaa-first.test/%'",
  ).run();

  // 3. clients --------------------------------------------------------------
  db.prepare(
    `INSERT INTO clients (id, name, url, niche, tech_stack, country, language, city, business_type, email, phone, address, gbp_url, gsc_property, ga4_property_id, created_at, updated_at)
     VALUES (9901, ?, ?, 'local', ?, 'TR', 'tr', 'İstanbul', 'Kafe & Pastane, Ltd.', 'fix148@a.test', '+90 555 010 20 30', ?, 'https://gbp.test/fix148a', 'sc-domain:fix148a.test', '148-148-148', ?, ?)`,
  ).run(
    'FIX148 "Quote, Comma" & Ünïcode 😀 Client',
    "https://fix148-a.test/páth?q=1,2",
    JSON.stringify([
      "WordPress\r\nGutenberg",
      'GA4, "GTM"',
      "=leading equals in stack",
    ]),
    "Bağdat Cd. 123\nKadıköy\tdistrict",
    E.clientA,
    E.clientA,
  );
  db.prepare(
    `INSERT INTO clients (id, name, url, created_at, updated_at)
     VALUES (9902, 'FIX148 =Hyperlink +Plus -Minus @At', 'https://fix148-b.test', ?, ?)`,
  ).run(E.clientB, E.clientB);

  // 4. competitors ----------------------------------------------------------
  const comp = db.prepare(
    `INSERT INTO competitors (id, client_id, name, url, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  comp.run(
    9901,
    1,
    'FIX148 Comp, Alpha "Q"',
    "https://comp-a.test/x,y",
    "=1+1 |cmd leading equals\ttab",
    E.compA,
    E.compA,
  );
  comp.run(9902, 9901, "FIX148 Comp Beta @at", "https://comp-b.test", null,
    E.compB, E.compB,
  );
  comp.run(
    9903,
    9902,
    "FIX148 Comp Gamma Ünïcode",
    "https://comp-c.test",
    'line1\r\nline2 "quoted", end 😀',
    E.compC,
    E.compC,
  );

  // 5. audits ---------------------------------------------------------------
  const audit = db.prepare(
    `INSERT INTO audits (id, client_id, status, score, issues_count, started_at, completed_at, kind, target_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  audit.run(9901, 1, "completed", 88, 7, E.compC, E.compA, "crawler", null,
    E.auditA, E.auditA,
  );
  audit.run(
    9902,
    9901,
    "running",
    null,
    0,
    null,
    null,
    "ai_full",
    'https://fix148.test/"q",x\r\n=y',
    E.auditB,
    E.auditB,
  );
  audit.run(
    9903,
    9902,
    "queued",
    12.5,
    3,
    -86400,
    4102444800,
    "crawler",
    "https://fix148.test/real",
    E.auditC,
    E.auditC,
  );

  // 6. backlinks ------------------------------------------------------------
  const bl = db.prepare(
    `INSERT INTO backlinks (id, client_id, source_url, source_domain, target_url, anchor_text, domain_authority, status, source, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  bl.run(
    9901,
    1,
    'https://fix148.test/a,("q")',
    "fix148.test",
    "@handle leading at",
    'best "seo, tools"',
    91,
    "active",
    "manual",
    "keep =and -dashes",
    E.blA,
    E.blA,
  );
  bl.run(
    9902,
    9901,
    "https://fix148.test/b",
    "fix148.test",
    null,
    "+90 phone-style anchor",
    null,
    "lost",
    "discovered",
    'multi\r\nline, with "quotes" 😀 and trailing comma,',
    E.blB,
    E.blB,
  );
  bl.run(
    9903,
    9902,
    "-dash-leading-source",
    "fix148.test",
    "https://fix148.test/c",
    null,
    0,
    "disavow",
    "ahrefs_wmt",
    null,
    E.blC,
    E.blC,
  );

  // 7. tasks (14.8b) ---------------------------------------------------------
  // 9912's title contains a LONE \r: the CANONICAL csvEscape quotes it
  // (/[",\n\r]/) — the keywords route's bespoke escape would not.
  const task = db.prepare(
    `INSERT INTO tasks (id, client_id, title, why_it_matters, priority, status, due_date, recurring_interval, estimated_minutes, actual_minutes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  task.run(
    9911, 1, 'FIX148 Task, "Q" title',
    'why =equals, -dash\r\nnew "line" 😀',
    "high", "todo", E.compC, "weekly", 30, 45, E.taskA, E.taskA,
  );
  task.run(
    9912, 9901, "FIX148 title with CR\ronly",
    null, "medium", "in_progress", null, null, null, null, E.taskB, E.taskB,
  );
  task.run(
    9913, 9902, "FIX148 =cmd @at +plus",
    "why\tdoes it matter (tab)",
    "low", "done", -86400, "monthly", 0, 0, E.taskC, E.taskC,
  );
  task.run(
    9914, 1, "FIX148 Ünïcode 😀 görev",
    "@handle leading at",
    "medium", "skipped", 4102444800, "quarterly", null, null, E.taskD, E.taskD,
  );
  task.run(
    9915, 9901, "FIX148 all nulls",
    null, "high", "todo", null, null, null, null, E.taskE, E.taskE,
  );

  // 8. outreach contacts (14.8b) ----------------------------------------------
  const oc = db.prepare(
    `INSERT INTO outreach_contacts (id, client_id, name, email, website, status, notes, last_contacted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  oc.run(
    9921, 1, 'FIX148 Contact, "C" name', "fix148b@a.test",
    "https://fix148b.test/x,y", "contacted",
    'line1\r\nline2 "q", end =lead',
    E.ocA, E.ocA, E.ocA,
  );
  oc.run(
    9922, 9902, "FIX148 Null Columns", null, null, "prospect",
    null, null, E.ocB, E.ocB,
  );
  oc.run(
    9923, 9901, "FIX148 REAL fractional", "fix148b@c.test", null, "replied",
    "tab\there", E.auditC, E.ocC, E.ocC, // 1714979289.5 REAL → .500 ms
  );

  // 9. report archives (14.8b) ------------------------------------------------
  const rep = db.prepare(
    `INSERT INTO report_archives (id, client_id, title, period_start, period_end, template, pdf_bytes, exec_summary, pinned, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  rep.run(
    9931, 1, 'FIX148 Report, "R" 😀', E.compA, E.compA + 1000, "monthly",
    12345, 'exec =lead\r\n"quoted", comma', 1, E.repA,
  );
  rep.run(
    9932, 9901, "FIX148 Null Report", null, null, null, null, null, 0, E.repB,
  );
  rep.run(
    9933, 9902, "FIX148 Zero Bytes, pinned", -86400, 4102444800, "annual",
    0, "", 1, E.repC,
  );

  // 10. monitored pages + page changes (14.8b) --------------------------------
  const page = db.prepare(
    `INSERT INTO monitored_pages (id, client_id, url, label, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
  );
  page.run(9941, 1, "https://fix148b.test/page,1", 'FIX148 Page, "P"',
    E.pageA, E.pageA);
  page.run(9942, 9901, "https://fix148b.test/page2", null, E.pageB, E.pageB);

  const change = db.prepare(
    `INSERT INTO page_changes (id, monitored_page_id, field, severity, old_value, new_value, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  change.run(9951, 9941, "title", "critical", 'Old, "value"',
    'New\r\nvalue =x', E.chA);
  change.run(9952, 9941, "content", null, null, null, E.chB);
  change.run(9953, 9942, "description", "warning", "old\tdesc",
    "new, desc", E.chC);
  change.run(9954, 9942, "status", "info", "200", "404, gone", E.compC);

  // 10b. ambient 'seed keyword' the keywords.csv fixture pins (row 2) -------
  // client 1 / US / desktop, created 07:06 UTC 2026-10-25 → sorts FIRST in
  // the created_at DESC export (FIX148B rows are 2023-era). Deliberately NO
  // keyword_rankings row — the fixture shows empty latest_position /
  // ranking_url AND empty last_checked (the "added" cell is the keyword's
  // own created_at).
  db.prepare(
    `INSERT INTO keywords (id, client_id, query, country, device, created_at, updated_at)
     VALUES (9950, 1, 'seed keyword', 'US', 'desktop', ?, ?)`,
  ).run(E.kwAmbient, E.kwAmbient);

  // 11. keywords + rankings (14.8b) -------------------------------------------
  // 9961's query contains a LONE \r: the BESPOKE keywords csvEscape does NOT
  // quote it (trigger class [",\n] — no \r, unlike the canonical one).
  const kw = db.prepare(
    `INSERT INTO keywords (id, client_id, query, country, device, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  kw.run(9961, 1, "FIX148 pure CR\rquery", "TR", "desktop", E.kwA, E.kwA);
  kw.run(9962, 1, 'FIX148 "quoted", comma query', "US", "mobile", E.kwB, E.kwB);
  kw.run(9963, 9901, "FIX148 Ünïcode 😀 sorgu", "TR", "desktop", E.kwC, E.kwC);
  kw.run(9964, 9902, "FIX148 no rankings", "US", "mobile", E.kwD, E.kwD);
  kw.run(9965, 1, "FIX148 zero position", "US", "desktop", E.kwE, E.kwE);

  const rank = db.prepare(
    `INSERT INTO keyword_rankings (id, keyword_id, position, url, checked_at, device)
     VALUES (?, ?, ?, ?, ?, 'desktop')`,
  );
  // fold exercise A: keyword 9962 ranked twice — the LATER checked_at row
  // (9972: position 3) must win over 9971 (position 12).
  rank.run(9971, 9962, 12, "https://rank.test/old", E.rankOld);
  rank.run(9972, 9962, 3, "https://rank.test/new", E.rankNew);
  // fold exercise B: tie on checked_at — the LAST row in scan order (9974)
  // overwrites 9973 (Map.set overwrite semantics).
  rank.run(9973, 9963, 5, "https://rank.test/tie-a", E.rankTie);
  rank.run(9974, 9963, 7, "https://rank.test/tie-b", E.rankTie);
  // fold exercise C: a later NULL ranking overwrites an earlier positioned one
  // (9961 → position 8 @ rankA, then NULL/NULL @ rankNull wins).
  rank.run(9975, 9961, null, null, E.rankNull);
  rank.run(9976, 9961, 8, "https://rank.test/a,1", E.rankA);
  // position 0 with NULL url (renders "0" and "" — 0 is not nullish).
  rank.run(9978, 9965, 0, null, E.rankZero);
  // keyword 9964 deliberately has NO rankings → empty latest cells.

  // 12. backlinks for disavow.txt (14.8b) --------------------------------------
  // 9981+9982 share the EXACT source_domain 'Spam-A.test' (duplicate → one
  // domain: group, first link's notes inlined). 'AAA-first.test' vs the rest
  // proves the localeCompare FOLD: byte order would put 'S' before 'f',
  // folded order puts fix148 before spam-a. 9985 is status 'active' — must be
  // filtered out. 9984's notes are "" (falsy → no note line).
  const bld = db.prepare(
    `INSERT INTO backlinks (id, client_id, source_url, source_domain, target_url, anchor_text, domain_authority, status, source, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  bld.run(
    9981, 1, "https://spam-a.test/link,1", "Spam-A.test", "https://fix148b.test/t",
    'anchor, "a"', 20, "disavow", "manual",
    'Spam ring, "bad"\r\nsecond line =lead',
    E.blD, E.blD,
  );
  bld.run(
    9982, 1, "https://spam-a.test/link2", "Spam-A.test", null, null, null,
    "disavow", "manual", null, E.blE, E.blE,
  );
  bld.run(
    9983, 9901, "https://spam-b.test/x", "spam-b.test", null, "b anchor", null,
    "disavow", "ahrefs_wmt", "single line", E.blF, E.blF,
  );
  bld.run(
    9984, 9902, "https://spam-c.test/y", "spam-c.test", null, null, 5,
    "disavow", "manual", "", E.blG, E.blG,
  );
  bld.run(
    9985, 1, "https://keep.test/z", "keep.test", null, null, null,
    "active", "manual", "not disavowed", E.blH, E.blH,
  );
  bld.run(
    9986, 1, "https://aaa-first.test/w", "AAA-first.test", null, null, null,
    "disavow", "manual", null, E.blI, E.blI,
  );

  // 13. plan-export tasks (14.8c) ----------------------------------------------
  // All for the seed client (id 1) with source='auto_calendar' — exactly the
  // set GET /clients/1/plan/export.csv groups by week. 9991+9993 are an exact
  // due_date TIE (sorter-stability canary across the two SQLite engines);
  // 9992's title/why carry leading + and -; 9991's title/why leading = ;
  // 9993's title leading @; 9996 embeds CRLF+quotes in the title; 9989/9990
  // are undated (NULL due_date → "No date" bucket, dueLabel "—").
  const plan = db.prepare(
    `INSERT INTO tasks (id, client_id, title, why_it_matters, priority, status, due_date, estimated_minutes, source, source_ref, created_at, updated_at)
     VALUES (?, 1, ?, ?, 'medium', ?, ?, ?, 'auto_calendar', 'FIX148C', ?, ?)`,
  );
  plan.run(9989, "FIX148C undated one", null, "todo", null, null,
    E.planCreated, E.planCreated);
  plan.run(9990, 'FIX148C undated two, "no date" 😀', 'why "q", comma',
    "todo", null, 5, E.planCreated + 1, E.planCreated + 1);
  plan.run(9991, 'FIX148C =HYPERLINK("https://x.test/a,1", "click, me")',
    '=important, "why" not', "todo", E.planW1a, 30,
    E.planCreated + 2, E.planCreated + 2);
  plan.run(9992, "+plus leading title", "-dash leading why", "in_progress",
    E.planW1b, 0, E.planCreated + 3, E.planCreated + 3);
  plan.run(9993, "@at leading title", "why\ttab", "todo", E.planW1a, null,
    E.planCreated + 4, E.planCreated + 4);
  plan.run(9994, "FIX148C month boundary Jan to Feb same week", null, "done",
    E.planW1c, 45, E.planCreated + 5, E.planCreated + 5);
  plan.run(9995, "FIX148C week 2", "why", "todo", E.planW2, 15,
    E.planCreated + 6, E.planCreated + 6);
  plan.run(9996, 'FIX148C multi\r\nline "q", end 😀', "why", "skipped",
    E.planW3, null, E.planCreated + 7, E.planCreated + 7);
  plan.run(9997, "FIX148C March", "why", "todo", E.planMar, 20,
    E.planCreated + 8, E.planCreated + 8);
  plan.run(9998, "FIX148C September (en-GB short month is Sept)", "why",
    "todo", E.planSep, 25, E.planCreated + 9, E.planCreated + 9);
  plan.run(9999, "FIX148C December year end", "why", "done", E.planDec, 35,
    E.planCreated + 10, E.planCreated + 10);
}

db.exec("BEGIN");
try {
  seed();
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

const count = (t: string) =>
  (
    db
      .prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE id >= 9901 AND id <= 9999`)
      .get() as { n: number }
  ).n;
console.log(
  `seed-14.8: clients=${count("clients")} competitors=${count("competitors")} audits=${count("audits")} backlinks=${count("backlinks")} tasks=${count("tasks")} outreach=${count("outreach_contacts")} reports=${count("report_archives")} pages=${count("monitored_pages")} changes=${count("page_changes")} keywords=${count("keywords")} rankings=${count("keyword_rankings")} (ids 9901+)`,
);
db.close();
