/**
 * Drizzle-over-HTTP read client — Task 14.7a (strangler-fig phase 14.7).
 *
 * Pages keep their EXACT drizzle query syntax; only the import changes
 * (`@/db/client` → `@/lib/db-gateway`). The sqlite-proxy driver ships every
 * query to the Rust gateway (POST /api/internal/query, X-Internal-Token —
 * resolved inside callBackend) and receives rows as POSITIONAL arrays;
 * drizzle core then performs all row shaping (snake→camel, timestamp→Date,
 * json, boolean) via mapResultRow — byte-identical objects to the
 * better-sqlite3 driver this replaces.
 *
 * Reads only: `run` is refused here (pages contained 0 writes/transactions,
 * verified in the 14.7 inventory — all writes stay on server actions /
 * backend endpoints). The Rust gateway is additionally SELECT-only
 * (sqlite3_stmt_readonly guard), so the refusal is belt-and-braces.
 *
 * 'get' contract note (verified against drizzle-orm 0.45.2 session.js):
 * mapGetResult treats the callback's `rows` field as THE SINGLE ROW, not a
 * row list — returning the full rows array corrupts findFirst() mapping and
 * returning `?? []` turns empty results into `{}` instead of undefined.
 * So for 'get' we pass through the first positional row (undefined when the
 * gateway returned zero rows), which reproduces better-sqlite3's .get()
 * semantics exactly. The `as any` is deliberate: drizzle's declared
 * `rows: any[]` type does not model the runtime 'get' contract.
 *
 * Server-only by construction: node:fs in callBackend fails any accidental
 * client import at build time (same convention as src/lib/backend.ts).
 */

import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "@/db/schema";
import { callBackend } from "@/lib/backend";

const remote: Parameters<typeof drizzle>[0] = async (sql, params, method) => {
  if (method === "run") {
    throw new Error(
      "db-gateway: reads only — writes go through server actions/backend endpoints",
    );
  }
  const r = await callBackend<{
    ok: true;
    columns: string[];
    rows: unknown[][];
  }>("/api/internal/query", { body: { sql, params } });
  if (method === "get") {
    const row = r.rows.length > 0 ? r.rows[0] : undefined;
    // undefined on empty must SURVIVE the trip (better-sqlite3 .get()
    // semantics) — the unknown[] cast is type-level only.
    return { rows: row as unknown[] };
  }
  return { rows: r.rows };
};

export const db = drizzle(remote, { schema });
