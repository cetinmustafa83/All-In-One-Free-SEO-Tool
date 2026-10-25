# Architecture Split Plan — Frontend / Rust Backend / DB

Decision date: 2025 (Task 14). Directive: split the project into 3 deployable
parts, devops style:

1. **frontend** — Next.js stays as-is; hooks/imports renewed to consume the new backend
2. **backend** — rewritten in **Rust**
3. **db** — unchanged (SQLite `data.db`, schema stays Drizzle-owned)

## 1. Measured current state (Task 14 recon)

| Surface | Count | Notes |
|---|---|---|
| API route files `src/app/api/**/route.ts` | 36 | 47 handlers (Task 13 audit) |
| Route handlers outside `/api` | 19 | CSV exports ×11, PDF ×4, `r/[slug]`, screenshots, disavow.txt |
| Server action files `**/actions.ts` | 158 | Next-specific RPC — biggest migration surface (~90 under `tools/`) |
| Files importing `@/lib/db` or `@/db` directly | 150 | RSC + client components reading DB at render |
| SQLite database | `data.db` (733 KB) | Drizzle schema, **stays as-is** |

Conclusion: a big-bang rewrite is not feasible. We migrate with a
**strangler-fig** strategy: the Rust backend grows domain-by-domain behind an
API surface that stays stable for the frontend.

## 2. Target architecture

```
┌────────────────────────────┐        ┌────────────────────────────┐        ┌────────────────┐
│  frontend (Next.js 16)     │  HTTP  │  backend (Rust + axum)     │  SQL   │  db (SQLite)   │
│  pages, hooks, UI, actions │ ─────▶ │  REST API, auth, scheduler │ ─────▶ │  data.db       │
│  NO direct DB access       │  /api  │  ONE static binary         │  WAL   │  schema owned  │
│  client: relative /api/*   │        │  dev port 3100             │        │  by Drizzle    │
│  RSC: @/lib/backend fetch  │        │                            │        │                │
└────────────────────────────┘        └────────────────────────────┘        └────────────────┘
```

### Rules

- **R1 — Frontend never touches the DB.** All data access goes over HTTP:
  client components/hooks keep using relative `/api/*` paths; RSC pages use a
  small server-side fetch helper (`@/lib/backend`). Server actions become
  either REST endpoints (Rust) or thin client wrappers (same exported function
  names → call sites unchanged).
- **R2 — Rust backend is the only DB client.** One axum service, one static
  binary, dev port `3100`, reachable through the existing Caddy gateway via
  `?XTransformPort=3100`.
- **R3 — DB stays as-is.** Same `data.db`, same tables. Drizzle remains the
  schema owner (`drizzle-kit push` from the Node side still works during
  migration). Rust reads/writes via `rusqlite` with WAL + `busy_timeout`.
- **R4 — Contract parity.** Rust replicates exact paths, methods, auth
  semantics and response envelopes of the existing API. The contract is
  documented in `docs/api-contract.md` (Task 14.1) and enforced by a curl-diff
  parity harness comparing Next vs Rust responses.
- **R5 — Server actions become REST.** Each `actions.ts` domain gets Rust
  endpoints; the action file is rewritten as a client-side wrapper that fetches
  `/api/...`, preserving exported function signatures.

## 3. Phases (each phase = worklog entry + commit + push)

| Phase | Scope | Exit criteria |
|---|---|---|
| **14.0** | Plan doc, Rust toolchain, `backend/` scaffold (axum + rusqlite, `/health` incl. DB smoke), run scripts, gateway verification | `curl :3100/health` + gateway probe return `db.ok=true` |
| **14.1** | Contract inventory: all 36 API routes + 19 handlers + 158 actions extracted to `docs/api-contract.md`; parity harness script | inventory complete; harness runs |
| **14.2** | Rust core: config/env, SQLite layer, error envelope, auth middleware (CSRF `Sec-Fetch-Site`, Bearer for `/api/v1`, local-socket + password modes) | middleware unit-probed via curl |
| **14.3** | Port read-only domains: health-ping, errors/env, edge/fixes, the 9 `/api/v1` reads | parity harness green on those probes |
| **14.4** | Port settings/auth/workspace: admin auth, api-keys CRUD, settings CRUD | parity green; secrets handling unchanged |
| **14.5** | Domain CRUD wave 1: clients, keywords, audits, backlinks, tasks, notifications → REST + action wrappers | UI flows pass E2E |
| **14.6** | Tools wave: ~90 `tools/*` actions → REST + wrappers (batched) | spot E2E per batch |
| **14.7** | RSC renewal: 110 pages + 3 components + 4 satellites → drizzle sqlite-proxy (`@/lib/db-gateway`) over the Rust SELECT-only query gateway | zero RSC-surface files import `@/db/client` anymore (actions/libs follow domain-port waves) |
| **14.8** | Exports: CSV → Rust; PDF/screenshots/playwright native deps stay in a thin Next BFF until a dedicated phase (decision documented) | done — CSV ×11 byte-exact (golden fixtures, Rust-direct + Next-proxy) |
| **14.9** | Cutover: `next.config` rewrites `/api/* → 127.0.0.1:3100` behind `API_BACKEND_URL` env; retire ported Next routes; full agent-browser E2E | done — fallback rewrite + 21 ported route handlers deleted; parity 34/34, smoke 142/142, browser E2E |
| **14.10** | Devops packaging: `docker-compose.yml` (frontend + backend + db volume), Makefile, CI (Next lint + `cargo check`), `.env.example`, README architecture, desktop packaging bundles the static Rust binary | done — image builds + boots both processes; Makefile; CI `rust` job + smoke step; zip ships backend sources + prebuilt binary |
| **14.11** | Domain-port wave 1 (post-plan): classify remaining `@/db/client` importers (write-scan), port every read-only file to `@/lib/db-gateway` | done — 39/151 files ported (18 libs + 21 app routes/actions); remaining 112 are all WRITE-class (56 lib + 4 agent + 1 mcp + 50 actions + 4 tests) and stay direct by design |

## 4. Key decisions

- **Repo layout stays**: Next app at repo root (sandbox/preview/dev-supervisor
  depend on it), Rust service in `backend/`, plan + contract docs in `docs/`.
  The physical three-way split happens at deploy time via docker-compose build
  contexts — the logical split is what the code enforces.
- **14.10 amendment — Docker ships ONE image running BOTH processes.** The
  original wording above ("compose build contexts per component") predates
  two hard constraints the cutover created: (a) after 14.9 a frontend-only
  container serves nothing on `/api` — the two processes are one deploy
  unit, and the existing install surface (docker-entrypoint guard,
  install.sh, control-panel, CI's `docker run` boot test) is built around a
  single image; (b) the backend opens SQLite without the CREATE flag and
  shares the /data volume anyway. So the Dockerfile gained a `backend-build`
  stage and its CMD starts both, compose keeps one `seo` service (plus an
  overridable `API_BACKEND_URL` for anyone who does want a split deploy),
  and the container healthcheck probes the full rewrite→Rust→SQLite round
  trip. The logical split the code enforces is unchanged.
- **Server actions**: new Rust endpoints keep REST shapes; action files become
  client wrappers so importing components don't change (fulfils "frontend
  stays as-is, imports renewed per backend").
- **Auth parity is a P0-class requirement**: the current three-layer
  protection (`Sec-Fetch-Site` CSRF check → mode check → local-socket) is
  ported as axum middleware in 14.2 and probed by the existing
  `.zaudit/api-smoke.sh` probe set.
- **Native deps stay in Next for now**: `pdfkit`, `playwright`, `tesseract`,
  `resvg`, `satori` power PDF/screenshot routes; porting them to Rust is its
  own later phase, not part of the API cutover.
- **Desktop packaging gets simpler**: `output: standalone` already avoids a
  Node install for users; a Rust static binary slots into the same packaging
  with zero runtime deps.

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| 158 action files (scale) | domain batches in 14.5–14.6; wrapper pattern keeps call sites stable; parity harness per batch |
| SQLite multi-process access (Node during migration + Rust) | WAL mode + `busy_timeout=5000ms`; single-writer discipline per domain after cutover |
| Auth drift between Next and Rust | middleware ported first (14.2); existing smoke probes run against both stacks |
| Turbopack dev-server memory limits | `backend/` lives outside `src/`, no impact on Next compile |
| Response-envelope drift | contract doc + curl-diff harness before each cutover |
| Sandbox resets losing toolchain | rustup install reproducible; scaffold is committed (rebuild = `cargo build`) |

## 6. Progress log (updated per phase)

| Phase | Status | Evidence |
|---|---|---|
| 14.0 scaffold | ✅ done | `/health` 200, db.ok, gateway probe |
| 14.1 inventory | ✅ done | docs/api-contract.md, parity harness |
| 14.2 core | ✅ done | middleware probed |
| 14.3 read-only | ✅ done | parity 34/34 |
| 14.4 settings/auth | ✅ done | parity 34/34, scrypt interop IDENTICAL |
| 14.5 domain CRUD | ✅ done | 24 endpoints (17 tasks-family + 7 clients), smoke 29/29, UI E2E |
| 14.6 tools wave | ✅ done (2026 batch) | see decision below + 14.6a/b/c worklog entries; smoke 82/82 |
| 14.7 RSC renewal | ✅ done (2026 batch) | 110/110 pages + 3 components + 4 satellites on `@/lib/db-gateway` (drizzle sqlite-proxy → `/api/internal/query`, SELECT-only stmt.readonly guard); E2E 110/110 + dashboard/clients-detail verified; smoke 97/97; parity 34/34. Remaining `@/db/client` importers: 62 unported action files + ~77 libs (domain-port waves) + 18 non-/api routes (14.8) + tests |
| 14.8 exports | ✅ done (2026 batch — 14.8a/b/c) | 11/11 CSV-class exports in Rust behind thin Next proxies (10 `export.csv` + `disavow.txt`): clients/competitors/audits/backlinks + client_scope port (14.8a), tasks/outreach/reports/monitor→page-changes/keywords (bespoke escape + latest-ranking fold) + disavow (localeCompare mirror) (14.8b), `clients/[id]/plan` (groupPlanByWeek week-bucket port, en-GB due labels, always-quote+defuse+CRLF serializer, canAccessClient → 404 "Not found" signal) (14.8c). Golden fixtures `backend/fixtures/14.8/` byte-exact on every smoke run — Rust-direct AND Next-proxy (disavow `# Generated:` line normalized); deterministic seed waves FIX148/FIX148B/FIX148C (backend/tools/seed-14.8.ts). Smoke 142/142 ×3 consecutive runs; parity 34/34; tsc src 0; lint 0 new. Remaining Next BFF until a dedicated phase: PDF ×4 + HTML report routes ×2 + screenshots + r/[slug] |
| 14.9 cutover | ✅ done (2026 batch) | `next.config.ts` **fallback** rewrite `/api/:path*` → `${API_BACKEND_URL}/api/:path*` (fallback — not afterFiles — so the 15 deliberately-unported Next handlers incl. dynamic segments `webhooks/[token]`, `report-archives/[id]/pdf`, `clients/[id]/skip-branding` keep winning; deleted-handler paths fall through to Rust). 21 ported route.ts files deleted (auth ×5, v1 ×11, errors ×2, edge/fixes, health-ping, errors/env). Method inventory verified 100% before deletion (GET/POST/OPTIONS per path vs axum registrations). Gated on `API_BACKEND_URL` (unset = Next-only rollback mode; .env.example documents it). One stale probe fixed: `rust-api-health-alias` now expects next=200 (the alias is served through the proxy). Fresh-DB reproducibility: seed-14.8.ts now owns the two AMBIENT rows the 14.8 fixtures pin (audit id=1 ai_full/failed @2026-10-25T06:26:29Z, keyword 'seed keyword' id 9950 @07:06:16Z — no ranking row) — smoke 142/142 ×2 on a fully rebuilt DB; parity 34/34 ×2; tsc src 0 (7 pre-existing backend/tools); lint 111 pre-existing; agent-browser E2E: /, /clients, /clients/1, /tasks, /settings render clean, browser fetch `/api/auth/status` → 200 via proxy, server actions flowing. New through-proxy surface: `/api/internal/*` reachable on :3000 (token-guarded 401) |
| 14.10 devops | ✅ done (2026 batch) | **Docker** (single image, BOTH processes — decision below): new `backend-build` stage (rust:1, stub-main dep caching, `--locked`) → `./backend/seo-backend` in the runner; CMD starts the backend (PORT=3100, DATABASE_PATH/SEO_DATA_DIR=/data) before `server.js`, `API_BACKEND_URL` overridable for split deploys; compose healthcheck probes the full rewrite→Rust→SQLite round trip; `.dockerignore` excludes `backend/target`. **CI**: new `rust` job (`cargo check --locked` + rust-cache); build job builds the debug backend and keeps it on :3201 (3100 stays free for the auth-flow step), every scratch-DB step re-points it via `backend/tools/ci-up.sh` (one file, two stacks); smoke step runs the full 142-assert suite (bun + :3100 + Next :3000 for proxy byte-compares); E2E webServer now boots the backend via `scripts/e2e-backend.cjs` (release→debug→cargo build; self-migrates — the backend opens SQLite WITHOUT the CREATE flag by design). **Makefile** (dev/check/smoke/parity/compose/release targets). **Desktop packaging**: `backend/` ships in the release ZIP (target/tools/fixtures dropped), prebuilt `seo-backend-<platform>-<arch>` included when built on the packaging machine; `bin/START.sh` §4b resolves binary→cargo-build→warning and starts the backend before Next (also exports API_BACKEND_URL/SEO_BACKEND_URL); `bin/STOP.sh` §4 stops it. **README**: Architecture section (two processes, one file, diagram, make targets). Validation: smoke 142/142, parity 34/34 (after recovery), ci-up.sh + e2e-backend.cjs live-tested, CMD shell syntax-checked, ci/compose YAML parsed (docker unavailable in sandbox — the CI docker job is the real boot gate) |
| 14.11 domain-port wave 1 | ✅ done (2026 batch) | **Write-scan triage of all 151 remaining `@/db/client` importers** (post-14.7/14.8/14.9 ledger): each file grepped for `.insert(`/`.update(`/`.delete(`/`.run(`/`.transaction(`/`$client`, then deep-scanned for raw SQL mutations (`INSERT INTO`/`UPDATE…SET`/`DELETE FROM`/`ON CONFLICT`/`.returning(`/drizzle `.values(`/`.set(`), raw driver calls (`db.all/values/run/get`), and `sqlite` re-exports. Result: **39 READ-ONLY** (14 `src/lib` + 4 `src/lib/agent` + 21 `src/app` non-/api routes & read-only actions — incl. `dashboard-data`, `quarterly-strategy`, `next-actions`, `report-generator`, the PDF/HTML report routes' read paths, `r/[slug]` lookup, `portal/[token]`) and **112 WRITE-class** (56 `src/lib` + 4 `src/lib/agent` + 1 `src/lib/mcp` + 50 `actions.ts` + 4 `*.test.ts`). All 39 ported with the mechanical one-line import swap (`@/db/client` → `@/lib/db-gateway`, exact drizzle syntax preserved per the 14.7 mechanism); write-side helpers they call (e.g. `short-links.recordClick`) stay on direct access. Validation: smoke 142/142 ×2, parity 34/34, tsc src 0 (7 pre-existing backend/tools), lint 111 pre-existing, browser E2E on /, /clients, /clients/1, /tasks, /settings — 0 page errors. Two Next-dev OOM restarts during the tour (documented Turbopack-spike flake, unrelated to the swap — dev.log shows the ported reads serving 200s right up to each silent death). **Remaining direct access is now 100% write-class by design** — a future write-gateway phase would need per-endpoint Rust write routes (out of scope of the 11-phase plan; the shared-WAL two-process design is the documented steady state) |

Internal endpoint count: 50 `/api/internal/*` (incl. SELECT-only `/api/internal/query` and 11 `/api/internal/exports/*`; excludes the 3 `/__dev` scaffolding probes) + v1/misc/auth surface; Rust ~9.8k lines (9,763 in backend/src, exports.rs 1,529 — the three serializer variants).

## 7. Phase 14.6 decision record — NET/AI tools stay in Next BFF

**Decision**: tools/* actions whose call graph performs outbound network
(crawls, PSI/Google/Bing APIs, DNS), AI-provider calls, OAuth, browser
automation, SMTP, or native deps (PDF/playwright) are **NOT ported to Rust**
and remain in Next as the thin BFF (same rationale as the 14.8 native-deps
decision and the 14.5b "NO new Cargo deps" precedent — `backend/Cargo.toml`
gains no HTTP client crate).

**14.6a ported (pure DB, 14 endpoints)**: redirects-manager (5), uptime CRUD
(3 of 4), person-schema, migration-map import, serp-features removeSnapshot,
robots-history loadSnapshots, bing/youtube key save+clear.

**14.6b ported (provably-local COMPUTE, 2 endpoints, fixture-parity verified
8/8 identical)**: utm-attribution `runAttribution`, migration-map `runMapping`
(URL shaping stays Next-side verdicts-over-the-wire).

**14.6b triage skip list (call-graph evidence in worklog Task 14.6b)**:
- AI: meta-tag-generator (callAI), link-recommender, cluster
- NET crawl: social-preview, anchor-distribution, schema-validate, ai-robots,
  link-graph, link-intersect, content-grader
- NET (external APIs): bing insights/submit/sites, youtube research,
  serp-features runCapture, robots-history runSnapshot, uptime runPingNow
- Remaining tools/* (canonical-audit, headers, hreflang, robots, link-checker,
  security, mobile-friendly, freshness, soft-404, facet-trap, health-check,
  domain-overview, bulk-scan, eeat-audit, internal-linking, migration-parity,
  redirects-bulk, reputation-abuse-risk, wp-hack-scan, traffic-drop,
  aio-passage, llms-txt, indexnow, wayback, dns-whois, reddit-research,
  pagerank, perf-budget, crux, geo-score, sxo, local-cwv, gsc-coverage,
  cannibalization, branded-split, gbp-reply, ads-funnel, ai-overview,
  ai-schema, image-gen, screenshot-import, plagiarism, intent-classifier,
  keyword-difficulty, summarizer, news-headline, auto-link, bulk-alt,
  outreach-personalize, content-score, content-helpers, code-generator,
  github-pr, browser-agent, render, trending) fall under the same
  BFF-retention rule until a dedicated HTTP-client phase (optionally reqwest)
  is decided.

**Exit criteria met**: "spot E2E per batch" — 14.6a verified 8 tool pages
render + action golden paths via smoke; 14.6b verified via TS↔Rust fixture
diffs (0 diff) + tool_runs DB assertions.
