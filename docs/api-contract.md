# API Contract — Rust porting source of truth (Task 14.1)

> **Generated file** — do not edit by hand. Regenerate: `bun backend/tools/api-inventory.ts`
> Plan: `docs/architecture-split-plan.md` (rules R1–R5). Auth semantics below are
> normative for the Rust port: exact paths, methods, auth order and envelopes (R4).

Counts: 36 API route files · 19 route handlers · 65 HTTP handlers · 36 DB-backed · 1 native-dep (BFF) · phase suggestions 14.3→14.8.

## Auth semantics (normative)

| Mechanism | Where | Semantics |
|---|---|---|
| CSRF `Sec-Fetch-Site` | all mutating handlers (first check) | reject when header present and not `same-origin`/`none` |
| Admin guard modes | admin endpoints | `accounts` mode = owner role; `password` mode = proxy cookie; `open` mode = local-socket only |
| Bearer | `/api/v1/*` | `Authorization: Bearer <token>`, 401 without |
| Contract responses | `edge`/`fixes` | 400 without client, 401 without token, cache headers, graceful-empty |

## A. API routes (`src/app/api/**`)

| Route | Methods | Auth | DB | Native | Phase |
|---|---|---|---|---|---|
| `/api/auth/login` | POST | — | — | — | 14.4 |
| `/api/auth/logout` | POST | — | — | — | 14.4 |
| `/api/auth/mode` | GET | — | yes | — | 14.4 |
| `/api/auth/register` | POST | — | yes | — | 14.4 |
| `/api/auth/status` | GET | — | — | — | 14.4 |
| `/api/backup` | GET | adminGuard, oauth | yes | — | 14.5 |
| `/api/clients/:id/skip-branding` | POST | adminGuard | yes | — | 14.5 |
| `/api/desktop-shortcut` | GET, POST, DELETE | adminGuard | — | — | 14.5 |
| `/api/edge/fixes` | GET | bearer | — | — | 14.4 |
| `/api/errors` | POST | — | — | — | 14.4 |
| `/api/errors/by-digest` | GET | — | yes | — | 14.4 |
| `/api/errors/env` | GET | — | — | — | 14.4 |
| `/api/google/auth` | GET | oauth | — | — | 14.5 |
| `/api/google/callback` | GET | oauth | yes | — | 14.5 |
| `/api/health-ping` | GET | — | — | — | 14.4 |
| `/api/mcp` | GET, POST, DELETE | bearer, localSocket, oauth | — | — | 14.5 |
| `/api/report-archives/:id/pdf` | GET | adminGuard | yes | — | 14.5 |
| `/api/restart` | POST | adminGuard | — | — | 14.5 |
| `/api/restore` | GET, POST | adminGuard | — | — | 14.5 |
| `/api/shutdown` | POST | adminGuard | — | — | 14.5 |
| `/api/team/invite` | POST | — | yes | — | 14.5 |
| `/api/test-provider` | POST | bearer, apiKey | — | — | 14.5 |
| `/api/ui-mode/toggle` | POST | — | — | — | 14.5 |
| `/api/update` | GET, POST | adminGuard | — | — | 14.5 |
| `/api/v1/audits` | GET | — | yes | — | 14.3 |
| `/api/v1/audits/:id` | GET | — | yes | — | 14.3 |
| `/api/v1/capture` | GET, POST | — | — | — | 14.3 |
| `/api/v1/clients` | GET | bearer | yes | — | 14.3 |
| `/api/v1/clients/:id` | GET | — | yes | — | 14.3 |
| `/api/v1/health` | GET, OPTIONS | localSocket | — | — | 14.3 |
| `/api/v1/keywords` | GET | — | yes | — | 14.3 |
| `/api/v1/rankings` | GET | — | yes | — | 14.3 |
| `/api/v1/reports` | GET | — | yes | — | 14.3 |
| `/api/v1/snapshots` | GET | — | yes | — | 14.3 |
| `/api/v1/track-404` | POST | — | yes | — | 14.3 |
| `/api/webhooks/:token` | GET, POST, PUT | — | yes | — | 14.5 |

## B. Route handlers outside `/api` (exports, PDFs, redirects)

| Route | Methods | DB | Native | Phase |
|---|---|---|---|---|
| `/audits/export.csv` | GET | yes | — | 14.8 |
| `/backlinks/disavow.txt` | GET | yes | — | 14.8 |
| `/backlinks/export.csv` | GET | yes | — | 14.8 |
| `/clients/:id/plan/export.csv` | GET | yes | — | 14.8 |
| `/clients/:id/plan/plan.pdf` | GET | yes | — | 14.8 |
| `/clients/export.csv` | GET | yes | — | 14.8 |
| `/competitors/export.csv` | GET | yes | — | 14.8 |
| `/grader/pdf` | GET | — | — | 14.8 |
| `/invoices/:id/pdf` | GET | yes | pdfkit | 14.8+BFF |
| `/keywords/export.csv` | GET | yes | — | 14.8 |
| `/monitor/export.csv` | GET | yes | — | 14.8 |
| `/outreach/export.csv` | GET | yes | — | 14.8 |
| `/proposals/:id/pdf` | GET | yes | — | 14.8 |
| `/r/:slug` | GET | yes | — | 14.8 |
| `/reports/:clientId` | GET | yes | — | 14.8 |
| `/reports/:clientId/quarterly` | GET | yes | — | 14.8 |
| `/reports/export.csv` | GET | yes | — | 14.8 |
| `/screenshots/:id` | GET | yes | — | 14.8 |
| `/tasks/export.csv` | GET | yes | — | 14.8 |

## C. Server actions

158 files, 376 exported functions. Full detail: `docs/api-actions-inventory.md` + `docs/api-inventory.json`.
Per R5: each domain becomes Rust REST endpoints; the `actions.ts` file becomes a
client-side wrapper with the same exported names → importing components unchanged.

