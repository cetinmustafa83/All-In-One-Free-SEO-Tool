#!/usr/bin/env node
/**
 * Deterministic port picker.
 *
 * Goal: every install gets its own stable port that won't collide with
 * other dev tools on the box (Next 3000, Vite 5173, Rails 3000, Django
 * 8000, generic 8080, Postgres 5432, Redis 6379, etc.) AND survives a
 * reboot so the user's bookmark keeps working.
 *
 * Strategy:
 *   1. If `.seo-port` already exists and points at a sensible port,
 *      return it. Existing installs never re-pick — bookmarks stick.
 *      (Override with --reroll to force a re-pick.)
 *   2. Otherwise derive a "preferred port" by hashing the absolute
 *      install path: 49152 + (sha256(installPath) % 16383). That puts
 *      us inside IANA's Dynamic/Private range (49152-65535) which is
 *      explicitly reserved for ephemeral use and where well-known apps
 *      do not bind. Different install dirs land on different preferred
 *      ports automatically.
 *   3. If the preferred port is occupied right now, probe upward by
 *      odd increments up to 200 steps. (Odd to avoid striding through
 *      consecutive ephemeral allocations the OS just handed out.)
 *   4. Write the chosen port to `.seo-port` and print it to stdout.
 *
 * Backwards compatibility:
 *   - Pass --legacy to use the old 3000-default behavior (for users
 *     who script around the 3000 endpoint).
 *   - Pass --check-only to print the port WITHOUT writing the file.
 *   - Pass --reroll to ignore the existing `.seo-port` and pick again.
 *
 * Exit codes:
 *   0  port picked and printed on stdout
 *   1  fatal — could not find a free port in the search window
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const args = new Set(process.argv.slice(2));
const LEGACY = args.has("--legacy");
const CHECK_ONLY = args.has("--check-only");
const REROLL = args.has("--reroll");

const INSTALL_DIR = process.cwd();
const PORT_FILE = path.join(INSTALL_DIR, ".seo-port");

const EPHEMERAL_MIN = 49152;
const EPHEMERAL_MAX = 65535;
const EPHEMERAL_SPAN = EPHEMERAL_MAX - EPHEMERAL_MIN; // 16383
const MAX_PROBE_STEPS = 200;

function isPortFree(port) {
  return new Promise((resolve) => {
    const sock = net.createServer();
    sock.unref();
    sock.on("error", () => resolve(false));
    sock.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      sock.close(() => resolve(true));
    });
  });
}

function preferredPortForPath(p) {
  const h = crypto.createHash("sha256").update(p).digest();
  // Read first 4 bytes as a uint32 — plenty of entropy for 16k buckets.
  const n = h.readUInt32BE(0);
  return EPHEMERAL_MIN + (n % EPHEMERAL_SPAN);
}

function readExistingPort() {
  try {
    const raw = fs.readFileSync(PORT_FILE, "utf-8").trim();
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 65535) return n;
  } catch {
    /* no file or unreadable */
  }
  return null;
}

async function findFreePortFrom(start) {
  let p = start;
  for (let step = 0; step < MAX_PROBE_STEPS; step++) {
    if (await isPortFree(p)) return p;
    p += 1;
    if (p > EPHEMERAL_MAX) p = EPHEMERAL_MIN; // wrap
  }
  return null;
}

async function legacyPort() {
  const candidates = [3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010, 8080, 8081, 4000, 5000];
  for (const p of candidates) {
    if (await isPortFree(p)) return p;
  }
  return null;
}

(async () => {
  // 1. Existing pin — honor it unless --reroll
  if (!REROLL) {
    const existing = readExistingPort();
    if (existing && (await isPortFree(existing))) {
      process.stdout.write(String(existing));
      return;
    }
    // existing port file present but currently occupied — fall through
    // to a fresh pick. We do NOT overwrite blindly because the holder
    // might be our own server; START.cmd separately probes /api/v1/health
    // to decide that. This script just answers "what port would we use
    // for a NEW install?"
    if (existing) {
      process.stdout.write(String(existing));
      return;
    }
  }

  let chosen;
  if (LEGACY) {
    chosen = await legacyPort();
  } else {
    const start = preferredPortForPath(INSTALL_DIR);
    chosen = await findFreePortFrom(start);
  }

  if (!chosen) {
    console.error("[pick-port] could not find a free port");
    process.exit(1);
  }

  if (!CHECK_ONLY) {
    try {
      fs.writeFileSync(PORT_FILE, String(chosen), { encoding: "utf-8" });
    } catch (err) {
      console.error(`[pick-port] WARN could not write .seo-port: ${err.message}`);
    }
  }

  process.stdout.write(String(chosen));
})().catch((err) => {
  console.error("[pick-port] fatal:", err.message);
  process.exit(1);
});
