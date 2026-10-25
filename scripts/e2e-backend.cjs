// Start the Rust backend for the Playwright E2E run, then exit.
//
//   node scripts/e2e-backend.cjs
//
// Playwright's webServer allows exactly one command, and since the 14.9
// cutover the readiness gate it polls — /api/v1/health — is served by
// the Rust backend through the Next rewrite. So the backend has to come
// up as part of that same command, against the SAME throwaway database
// the webServer env declares (.e2e/e2e.db). This script:
//
//   1. finds a usable backend: release binary → debug binary → cargo build,
//   2. spawns it detached on :3201 (PORT chosen so it can never collide
//      with the app's own ports — 3000 dev, 3210 e2e, 3100 dev-backend),
//   3. waits for /health, exits 0, leaving the process running.
//
// Playwright kills the whole process tree on exit, so nothing is left
// behind. CJS + dependency-free, same reasoning as migrate.cjs: it runs
// before any TS tooling exists (fresh clone, first e2e run).

const { spawn, spawnSync } = require("node:child_process");
const { existsSync, mkdirSync } = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PORT = process.env.E2E_BACKEND_PORT ?? "3201";
const DB_PATH = process.env.SEO_DB_PATH ?? path.join(ROOT, ".e2e", "e2e.db");
const DATA_DIR = process.env.SEO_DATA_DIR ?? path.join(ROOT, ".e2e");
const CARGO = process.env.CARGO ?? "cargo";

function findBinary() {
  const release = path.join(ROOT, "backend", "target", "release", "seo-backend");
  const debug = path.join(ROOT, "backend", "target", "debug", "seo-backend");
  if (existsSync(release)) return release;
  if (existsSync(debug)) return debug;
  // Nothing prebuilt — try to build. The debug profile is enough for an
  // e2e run and skips the release build's minutes of optimization.
  const built = spawnSync(CARGO, ["build", "--locked"], {
    cwd: path.join(ROOT, "backend"),
    stdio: "inherit",
  });
  if (built.status !== 0 || !existsSync(debug)) {
    console.error(
      "e2e-backend: no backend binary and `cargo build` failed — " +
        "install the Rust toolchain (rustup) or build backend/ first.",
    );
    process.exit(1);
  }
  return debug;
}

function waitHealthy(tries) {
  return new Promise((resolveHealth) => {
    const attempt = (left) => {
      const req = http.get(
        { host: "127.0.0.1", port: PORT, path: "/health", timeout: 1000 },
        (res) => {
          res.resume();
          resolveHealth(res.statusCode === 200);
        },
      );
      req.on("error", () => retry(left));
      req.on("timeout", () => {
        req.destroy();
        retry(left);
      });
    };
    const retry = (left) => {
      if (left <= 0) return resolveHealth(false);
      setTimeout(() => attempt(left - 1), 500);
    };
    attempt(tries);
  });
}

async function main() {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });

  // The backend opens SQLite with READ_WRITE but deliberately WITHOUT the
  // CREATE flag — schema ownership belongs to scripts/migrate.cjs (the
  // same rule the docker entrypoint follows). In the playwright chain
  // migrate already ran; running it here too makes this script correct
  // standalone (e.g. debugging it by hand) at the cost of one no-op pass
  // when the db already exists.
  if (!existsSync(DB_PATH)) {
    const mig = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "migrate.cjs")],
      { env: { ...process.env, SEO_DB_PATH: DB_PATH }, stdio: "inherit" },
    );
    if (mig.status !== 0) {
      console.error("e2e-backend: migrate.cjs failed — cannot continue.");
      process.exit(1);
    }
  }

  const bin = findBinary();
  const child = spawn(
    bin,
    [],
    {
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        PORT,
        DATABASE_PATH: DB_PATH,
        SEO_DATA_DIR: DATA_DIR,
      },
    },
  );
  child.unref();

  if (!(await waitHealthy(120))) {
    console.error(`e2e-backend: backend not healthy on :${PORT} after 60s`);
    process.exit(1);
  }
  console.log(`e2e-backend: backend healthy on :${PORT} (db: ${DB_PATH})`);
}

main();
