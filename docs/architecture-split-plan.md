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
| **14.9** | Cutover: `next.config` rewrites `/api/* → 127.0.0.1:3100` behind `API_BACKEND_URL` env; retire ported Next routes; full agent-browser E2E | full app works with Rust serving `/api` |
| **14.10** | Devops packaging: `docker-compose.yml` (frontend + backend + db volume), Makefile, CI (Next lint + `cargo check`), `.env.example`, README architecture, desktop packaging bundles the static Rust binary | CI green; compose up works |

## 4. Key decisions

- **Repo layout stays**: Next app at repo root (sandbox/preview/dev-supervisor
  depend on it), Rust service in `backend/`, plan + contract docs in `docs/`.
  The physical three-way split happens at deploy time via docker-compose build
  contexts — the logical split is what the code enforces.
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
| 14.9 cutover | pending | `/api/*` rewrite behind `API_BACKEND_URL` |
| 14.10 devops | pending | compose, CI, desktop bundle |

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
