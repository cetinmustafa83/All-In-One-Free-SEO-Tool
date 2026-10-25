/**
 * Minimal ambient types for `bun:sqlite` — backend/tools scripts run under
 * Bun (better-sqlite3 does not load there, see seed-14.8.ts) and the repo
 * does not carry @types/bun. Only the surface the tools use is declared.
 */
declare module "bun:sqlite" {
  export class Statement {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }
  export class Database {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): Statement;
    close(): void;
  }
}
