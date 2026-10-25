import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import { existsSync } from "node:fs";
import * as schema from "./schema";

/**
 * Repo root, found by walking up from cwd until a directory that carries
 * one of the split-layout markers (db/migrations or backend/Cargo.toml).
 *
 * Since the frontend/backend/db repo split, the Next process cannot rely
 * on its cwd being the repo root (`next dev frontend`, the standalone
 * server, and the desktop launcher all start it differently), so the
 * database default is anchored to the repo instead of the cwd. Unset in
 * every real deployment — Docker and the desktop launcher always set
 * SEO_DB_PATH — this only decides where a bare `next dev` looks.
 */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (
      existsSync(path.join(dir, "db", "migrations")) ||
      existsSync(path.join(dir, "backend", "Cargo.toml"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const dbPath =
  process.env.SEO_DB_PATH ??
  (() => {
    const preferred = path.join(repoRoot(), "db", "data.db");
    // Pre-split installs keep their database at the repo root until the
    // next `db:migrate` run moves it into db/ (see db/migrate.cjs). Read
    // the legacy file rather than silently creating an empty new one.
    if (!existsSync(preferred) && existsSync(path.join(process.cwd(), "data.db"))) {
      return path.join(process.cwd(), "data.db");
    }
    return preferred;
  })();

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { sqlite };
