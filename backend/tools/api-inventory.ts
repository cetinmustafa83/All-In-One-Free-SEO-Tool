#!/usr/bin/env bun
/**
 * API inventory generator — Task 14.1 (three-part split, docs/architecture-split-plan.md)
 *
 * Walks src/app for Next.js HTTP handlers (route.ts) and server actions
 * (actions.ts), extracts methods / auth markers / dependency signals and emits:
 *
 *   docs/api-inventory.json          machine-readable (source for later phases)
 *   docs/api-contract.md             HTTP route contract — what Rust must replicate
 *   docs/api-actions-inventory.md    server actions inventory — REST + wrapper backlog
 *
 * Re-run after API changes:  bun backend/tools/api-inventory.ts
 * The generated docs are committed: diffs in review = contract changes.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";

const ROOT = join(import.meta.dir, "..", ".."); // backend/tools -> repo root
const SRC = join(ROOT, "src", "app");
const DOCS = join(ROOT, "docs");

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
const HTTP_METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const AUTH_MARKERS: Record<string, RegExp> = {
  adminGuard: /guardAdminRequest|admin-auth|assertAdmin|requireAdmin/,
  bearer: /Authorization|Bearer/,
  csrf: /Sec-Fetch-Site|SEC_FETCH|sec-fetch-site/,
  localSocket: /localSocket|isLocalRequest|127\.0\.0\.1|::1/,
  apiKey: /x-api-key|apiKey|API_KEY/,
  oauth: /google\/auth|oauth|OAuth|accounts\.google/,
};

const NATIVE_DEPS: Record<string, RegExp> = {
  pdfkit: /["']pdfkit["']/,
  playwright: /["']playwright(-core)?["']/,
  tesseract: /["']tesseract/,
  resvg: /@resvg\/resvg-js/,
  satori: /["']satori["']/,
  qrcode: /["']qrcode["']/,
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function filePathToRoute(p: string): string {
  let rel = relative(SRC, p).replace(/\\/g, "/").replace(/\/route\.ts$/, "");
  rel = rel.replace(/\[\.\.\.(\w+)\]/g, ":$1*").replace(/\[(\w+)\]/g, ":$1");
  return "/" + rel;
}

interface RouteInfo {
  file: string;
  route: string;
  area: "api" | "route-handler";
  methods: Method[];
  auth: string[];
  native: string[];
  usesDb: boolean;
  phase: string;
}

interface ActionInfo {
  file: string;
  route: string;
  area: "api-action" | "page-action";
  exports: string[];
  count: number;
}

function suggestPhase(r: Omit<RouteInfo, "phase">): string {
  if (r.native.length) return "14.8+BFF"; // native render deps stay in Next BFF for now
  if (r.area === "route-handler") return "14.8"; // CSV/PDF exports — dedicated phase
  if (r.route.startsWith("/api/v1/")) return "14.3";
  if (/^\/api\/(auth|errors|edge|fixes|health-ping|settings|workspace)\b/.test(r.route))
    return "14.4";
  return "14.5";
}

function scanRoute(p: string): RouteInfo {
  const code = readFileSync(p, "utf8");
  const methods = HTTP_METHODS.filter((m) =>
    new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${m}\\b`).test(code),
  );
  const auth = Object.entries(AUTH_MARKERS).filter(([, re]) => re.test(code)).map(([k]) => k);
  const native = Object.entries(NATIVE_DEPS).filter(([, re]) => re.test(code)).map(([k]) => k);
  const usesDb = /from ["']@\/(lib\/db|db)|better-sqlite3|drizzle-orm/.test(code);
  const route = filePathToRoute(p);
  const area = route.startsWith("/api/") ? "api" : "route-handler";
  const base = { file: relative(ROOT, p), route, area, methods, auth, native, usesDb };
  return { ...base, phase: suggestPhase(base) };
}

function scanActions(p: string): ActionInfo {
  const code = readFileSync(p, "utf8");
  const fns = new Set<string>();
  for (const m of code.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) fns.add(m[1]);
  for (const m of code.matchAll(/export\s+const\s+(\w+)\s*=/g)) fns.add(m[1]);
  const route = "/" + relative(SRC, dirname(p)).replace(/\\/g, "/");
  return {
    file: relative(ROOT, p),
    route,
    area: route.startsWith("/api/") ? "api-action" : "page-action",
    exports: [...fns].sort(),
    count: fns.size,
  };
}

const all = walk(SRC);
const routes = all
  .filter((f) => f.split("/").pop() === "route.ts")
  .map(scanRoute)
  .sort((a, b) => a.route.localeCompare(b.route));
const actions = all
  .filter((f) => f.split("/").pop() === "actions.ts") // exact basename: not *-actions.ts
  .map(scanActions)
  .sort((a, b) => a.file.localeCompare(b.file));

const counts = {
  apiRoutes: routes.filter((r) => r.area === "api").length,
  routeHandlers: routes.filter((r) => r.area === "route-handler").length,
  handlersTotal: routes.reduce((n, r) => n + r.methods.length, 0),
  actionFiles: actions.length,
  actionFunctions: actions.reduce((n, a) => n + a.count, 0),
  dbBackedRoutes: routes.filter((r) => r.usesDb).length,
  nativeRoutes: routes.filter((r) => r.native.length).length,
};

// ---------- docs/api-contract.md ----------
const md: string[] = [];
md.push("# API Contract — Rust porting source of truth (Task 14.1)");
md.push("");
md.push("> **Generated file** — do not edit by hand. Regenerate: `bun backend/tools/api-inventory.ts`");
md.push("> Plan: `docs/architecture-split-plan.md` (rules R1–R5). Auth semantics below are");
md.push("> normative for the Rust port: exact paths, methods, auth order and envelopes (R4).");
md.push("");
md.push(
  `Counts: ${counts.apiRoutes} API route files · ${counts.routeHandlers} route handlers · ${counts.handlersTotal} HTTP handlers · ${counts.dbBackedRoutes} DB-backed · ${counts.nativeRoutes} native-dep (BFF) · phase suggestions 14.3→14.8.`,
);
md.push("");
md.push("## Auth semantics (normative)");
md.push("");
md.push("| Mechanism | Where | Semantics |");
md.push("|---|---|---|");
md.push("| CSRF `Sec-Fetch-Site` | all mutating handlers (first check) | reject when header present and not `same-origin`/`none` |");
md.push("| Admin guard modes | admin endpoints | `accounts` mode = owner role; `password` mode = proxy cookie; `open` mode = local-socket only |");
md.push("| Bearer | `/api/v1/*` | `Authorization: Bearer <token>`, 401 without |");
md.push("| Contract responses | `edge`/`fixes` | 400 without client, 401 without token, cache headers, graceful-empty |");
md.push("");
md.push("## A. API routes (`src/app/api/**`)");
md.push("");
md.push("| Route | Methods | Auth | DB | Native | Phase |");
md.push("|---|---|---|---|---|---|");
for (const r of routes.filter((r) => r.area === "api")) {
  md.push(
    `| \`${r.route}\` | ${r.methods.join(", ") || "—"} | ${r.auth.join(", ") || "—"} | ${r.usesDb ? "yes" : "—"} | ${r.native.join(", ") || "—"} | ${r.phase} |`,
  );
}
md.push("");
md.push("## B. Route handlers outside `/api` (exports, PDFs, redirects)");
md.push("");
md.push("| Route | Methods | DB | Native | Phase |");
md.push("|---|---|---|---|---|");
for (const r of routes.filter((r) => r.area === "route-handler")) {
  md.push(
    `| \`${r.route}\` | ${r.methods.join(", ") || "—"} | ${r.usesDb ? "yes" : "—"} | ${r.native.join(", ") || "—"} | ${r.phase} |`,
  );
}
md.push("");
md.push("## C. Server actions");
md.push("");
md.push(
  `${counts.actionFiles} files, ${counts.actionFunctions} exported functions. Full detail: \`docs/api-actions-inventory.md\` + \`docs/api-inventory.json\`.`,
);
md.push("Per R5: each domain becomes Rust REST endpoints; the `actions.ts` file becomes a");
md.push("client-side wrapper with the same exported names → importing components unchanged.");
md.push("");
mkdirSync(DOCS, { recursive: true });
writeFileSync(join(DOCS, "api-contract.md"), md.join("\n") + "\n");

// ---------- docs/api-actions-inventory.md ----------
const am: string[] = [];
am.push("# Server Actions Inventory (Task 14.1)");
am.push("");
am.push("> **Generated file** — regenerate: `bun backend/tools/api-inventory.ts`");
am.push(
  `> ${counts.actionFiles} action files · ${counts.actionFunctions} exported functions. R5 wrappers keep call sites stable.`,
);
am.push("");
for (const area of ["page-action", "api-action"] as const) {
  am.push(`## ${area === "page-action" ? "Page actions" : "API-area actions"}`);
  am.push("");
  am.push("| Route area | File | # | Exported functions |");
  am.push("|---|---|---|---|");
  for (const a of actions.filter((x) => x.area === area)) {
    am.push(`| \`${a.route}\` | \`${a.file}\` | ${a.count} | ${a.exports.join(", ") || "—"} |`);
  }
  am.push("");
}
writeFileSync(join(DOCS, "api-actions-inventory.md"), am.join("\n") + "\n");

// ---------- docs/api-inventory.json ----------
writeFileSync(
  join(DOCS, "api-inventory.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), counts, routes, actions }, null, 2) + "\n",
);

console.log(
  `inventory: ${counts.apiRoutes} api + ${counts.routeHandlers} handlers (${counts.handlersTotal} methods), ${counts.actionFiles} action files (${counts.actionFunctions} fns)`,
);
console.log(`wrote docs/api-contract.md, docs/api-actions-inventory.md, docs/api-inventory.json`);
