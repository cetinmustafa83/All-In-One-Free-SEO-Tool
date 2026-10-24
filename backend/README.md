# seo-backend (Rust)

Part 2 of the three-part split (see `docs/architecture-split-plan.md`):

1. **frontend** — Next.js 16, unchanged, consumes `/api/*`
2. **backend** — THIS service (Rust + axum + rusqlite)
3. **db** — SQLite `data.db` at repo root, unchanged, schema owned by Drizzle

## Run (dev)

```bash
backend/up.sh up        # background, port 3100, log backend/backend-dev.log
backend/up.sh status    # pid + health probe
backend/up.sh stop
```

Or foreground: `backend/run-dev.sh` (PORT=3100, DATABASE_PATH=../data.db).

Gateway (Caddy) probe from the browser side:
`/health?XTransformPort=3100` — no absolute URLs, per gateway rules.

## Endpoints (phase 14.0)

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | service info |
| GET | `/health` | liveness + DB smoke (tables count, journal mode) |
| GET | `/api/health` | alias, so the frontend contract can stay under `/api/*` |

Later phases port API domains per the parity contract (`docs/api-contract.md`,
Task 14.1) — paths, auth semantics and response envelopes must match the
existing Next.js API routes exactly.

## Tools

| Command | Purpose |
|---|---|
| `bun backend/tools/api-inventory.ts` | regenerate `docs/api-contract.md` + `docs/api-actions-inventory.md` + `docs/api-inventory.json` from `src/app` (36 API routes, 19 handlers, 158 action files) |
| `bun backend/tools/parity.ts` | parity harness: runs `backend/parity-probes.json` against Next (:3000) and Rust (:3100), diffs statuses (and top-level JSON key sets when `compareKeys` is set) |

Probes marked `rust: 404` document the port backlog — they flip to
`"mirror"` as domains land in 14.3+.
