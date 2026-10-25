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
 * Run with Bun (bun:sqlite — better-sqlite3 does not load under Bun):
 *   bun run backend/tools/seed-14.8.ts
 */
import { Database } from "bun:sqlite";

const db = new Database("data.db");
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
};

function seed(): void {
  // 1. volatile rows from previous internal-smoke.sh runs (wall-clock data).
  db.prepare(
    "DELETE FROM backlinks WHERE source_url LIKE 'https://smoke-ahrefs.test/%'",
  ).run();
  db.prepare(
    "DELETE FROM clients WHERE (name LIKE 'Smoke Client %' AND url LIKE 'https://smoke-client-%') OR url LIKE 'https://smoke-qa-%'",
  ).run();

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
  `seed-14.8: clients=${count("clients")} competitors=${count("competitors")} audits=${count("audits")} backlinks=${count("backlinks")} (ids 9901+)`,
);
db.close();
