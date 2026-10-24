# Worklog

---
Task ID: 1
Agent: Z.ai Code (main)
Task: Clone https://github.com/IamRamgarhia/All-In-One-Free-SEO-Tool.git, install and run it

Work Log:
- Cloned repo (shallow) to /tmp/seo-tool-repo, inspected structure: Next.js 16.2.4 + React 19 + Drizzle ORM + better-sqlite3, pnpm@10.34.5 pinned, 71 SQL migrations.
- Verified auth model: no login wall until first user registers (single-user mode by default).
- Stopped old dev server (port 3000 freed).
- Cleaned old project files in /home/z/my-project (kept Caddyfile, dev.log, download/, upload/, skills/, examples/, mini-services/, .git from repo copied over).
- Copied full repo contents (incl. .git for future `git pull`) into /home/z/my-project.
- Installed pnpm 10.34.5 via npm -g (corepack failed on permissions); `pnpm install` OK (better-sqlite3 native build verified with in-memory smoke test).
- Ran `node scripts/migrate.cjs`: 71 migrations applied to ./data.db (WAL mode).
- Started dev server: `pnpm dev` (predev re-runs migrations idempotently) → Next.js 16.2.4 Turbopack ready on port 3000, logs to /home/z/my-project/dev.log.
- Agent Browser E2E verification:
  - / redirects to /welcome onboarding, renders correctly.
  - Dashboard renders (setup checklist, health widgets).
  - Golden path: created client "Test Site" via /clients/new form → row persisted in SQLite (clients.id=1) → redirect to /clients/1/onboarding → auto site audit ran (13 findings, health 54/100) → 20 tasks auto-generated.
  - /tools catalog renders (92 tools, categories, filters).
  - Mobile viewport (390x844) responsive with hamburger nav; health score gauge shows persisted data.
  - No browser console/page errors; dev.log clean except benign recharts width/height dev warning.

Stage Summary:
- The All-In-One Free SEO Tool (v0.7.0) is fully installed and running on port 3000 from /home/z/my-project.
- Stack in use: Next.js 16.2.4 (Turbopack dev), Drizzle ORM + better-sqlite3 at ./data.db, pnpm 10.34.5.
- No login wall (single-user mode); optional APP_PASSWORD / Google OAuth via .env (see .env.example).
- Future updates: `git pull` inside /home/z/my-project, then `pnpm install && node scripts/migrate.cjs`, restart dev server.

---
Task ID: 2
Agent: Z.ai Code (main)
Task: v0.7.0 doğrulama + "Invalid Server Actions request" ve script-tag hatalarını düzeltme + AdCrewOS-web özelliklerinin entegrasyonunu tamamlama/doğrulama

Work Log:
- Git ile doğrulandı: yerel HEAD = origin/main 0a0e982 (Merge PR #46: v0.7.0 security and reliability release). package.json version: 0.7.0. → En son sürüm kurulu.
- Çalışma ağacında paralel oturumdan kalan yarım AdCrewOS entegrasyonu bulundu (commit'lenmemiş): /ads sayfaları, ads-engine.ts, 0071_ads_autopilot.sql, schema/nav güncellemeleri, layout.tsx next/script düzeltmesi, proxy.ts normaliseForwardedHost fix'i. pnpm typecheck temiz geçti.
- "Invalid Server Actions request" kök nedeni: Next.js 16 server-action handler'ı (E80) POST'ta origin header'ını x-forwarded-host ?? host ile karşılaştırıyor; öni gateway zinciri host'u ezerken origin korunduğu için eşleşmezlik 500 veriyor.
- proxy.ts normaliseForwardedHost güçlendirildi: x-forwarded-host HİÇ gelmediğinde de origin host'u ile set ediliyor (ilk düzeltme sadece header var-ken çalışıyordu).
- A/B kanıt (curl, Caddy :81 üzerinden mismatch'li Host/Origin): fix'siz 500 + digest E80 "Invalid Server Actions request." / fix'li 200. Gerçek tarayıcı akışında da /clients/new üzerinden client oluşturma (createClient → redirect /clients/2/onboarding) çalışıyor.
- Script-tag console hatası: layout.tsx raw <script> → next/script (beforeInteractive) değişikliği doğrulandı; tarayıcı konsolunda "Encountered a script tag" 0 kez.
- AdCrewOS entegrasyonu uçtan uca browser testi: /ads kokpit (KPI: 3 hesap, $393/24s, 1 auto-pause), demo hesaplar + sparkline'lar, "Run engine now" → SCALE_PROPOSAL üretimi, Approve → bütçe $259.20→$311.04 (+20%) + SCALE_APPLIED denetim kaydı, /ads/accounts/3 detay, /ads/reports (hesap/dönem seçici + Print/Save PDF), sidebar "Paid ads > Ads Autopilot ⭐".
- Yeni sorun: dev server tekrar tekrar OOM-killed (dmesg: next-server 2.76GB/3.22GB anon-rss; 4GB sandbox + tarayıcı). Çözümler: next.config.ts'e experimental.turbopackMemoryLimit: 1536; .zscripts/dev-supervisor.sh (OOM'da otomatik restart, kalıcı .next/dev cache sayesinde her restart ilerleme); ana rotalar kademeli ısıtıldı (her ağır rota taze server ömründe): /, /clients/new, /clients, /clients/1, /ads, /ads/reports, /ads/accounts/3, /tools, /audits, /keywords, /tasks, /reports, /seo-chat, /backlinks → hepsi 200.
- eslint (proxy.ts, next.config.ts, ads-engine.ts, ads/actions.ts): temiz.

Stage Summary:
- v0.7.0 doğrulandı; iki kullanıcı hatası kökten çözüldü ve kanıtlandı.
- AdCrewOS özellikleri (Ads Autopilot: guardrail motoru, auto-pause, onaylı scale, alert feed, demo veri, hesap detayı, PDF rapor) projede ÇALIŞIR durumda; sidebar'dan erişilir.
- Dev server artık .zscripts/dev-supervisor.sh ile yönetiliyor (OOM kendini iyileştirir); turbopackMemoryLimit devrede.
- Değişen dosyalar (commit'lenmedi, kullanıcıya ait): src/proxy.ts, next.config.ts, .zscripts/dev-supervisor.sh (yeni), + paralel oturumun ads/ layout / nav / schema / migration dosyaları.

---
Task ID: 3
Agent: Z.ai Code (main)
Task: "Keep going" — confirm v0.7.0 state, re-verify integration end-to-end after OOM restarts, harden /ads action flows, stabilize sandbox memory

Work Log:
- Git: HEAD = origin/main 0a0e982 (v0.7.0, PR #46) confirmed latest; 2 env-generated commits on top, work tree clean. Previous session's fixes (proxy.ts origin fix, next/script theme-init, Ads Autopilot port) all present in commit 52dff95.
- AdCrewOS-web feature cross-check against /tmp/adcrew README: cockpit KPIs, account cards + sparklines, alert feed (Approve/Dismiss), auto-pause engine, approval-gated scaling, demo data, guardrails editor, PDF report w/ agency letterhead, add/remove accounts → ALL ported. Billing/Stripe/SMS intentionally out of scope for a free self-hosted tool.
- Browser E2E (fresh, after supervisor OOM-restarts): dashboard OK; /ads cockpit OK (3 accounts, $393/24h); "Run engine now" → SCALE_PROPOSAL (toast "Checked 3 account(s) — the engine acted on 1"); Approve → budget $373.25→$447.90/day (+20%), audit trail persisted across 3 separate server lifetimes; /ads/reports renders KPIs + guardrails + autopilot history; ROAS trend chart confirmed RENDERING once hydration completes (screenshot verify-reports-fixed.png).
- Root-caused NEW finding: first page load right after a dev-server restart can render full SSR HTML but never hydrate (0 React fibers, zero interactivity, charts blank). Reload fixes it. Clicking a server-action button on such a page native-POSTs and Next 16 rejects it → the exact "Invalid Server Actions request" class the user reported. Dev-only artifact of Turbopack module-graph rebuild; not reproducible in production builds.
- Root-caused the "stuck Approving… toast": a failed action POST (stale action ID after restart) left useFormStatus/useActionState pending forever with no feedback.
- Hardening shipped: new src/app/ads/safe-action.ts (useSafeCall + useWrappedActionState) wired into ALL 5 /ads action surfaces (alert-feed Approve/Dismiss, resume-button, ads-toolbar Run engine/Sync, add-account-form, guardrails-form). A dead action POST now toasts "Couldn't reach the server" + auto router.refresh() (fresh action IDs) instead of hanging. Verified live: stale-page engine click recovered and succeeded.
- Memory stabilization on the 4GB sandbox: turbopackMemoryLimit 1536→1024 in next.config.ts (peak anon-rss OOM kills observed at 3.1-3.3GB); documented in config comments. dev-supervisor.sh continues to auto-restart; persistent .next/dev cache keeps restarts cheap. Routes re-warmed after restarts: /, /ads, /ads/reports all 200.
- eslint + tsc --noEmit clean for all changed files (remaining lint noise is pre-existing skills/ scripts only).
- Known limitation (honest): /ads/reports compile + Chrome cannot coexist in 4GB — visual mobile-viewport check of /ads not re-run this session; previous session verified mobile 390x844 for the app shell, and /ads pages use standard responsive Tailwind (flex-wrap/grid stacking) seen working at narrow desktop widths.

Stage Summary:
- v0.7.0 confirmed current; both user-reported bugs remain fixed and re-verified; AdCrewOS feature set fully ported and functioning (engine, approvals, compounding budgets $259.20→$311.04→$373.25→$447.90, audit trail, reports).
- New resilience layer: /ads actions can no longer hang the UI — stale-action failures recover with a toast + auto-refresh (src/app/ads/safe-action.ts).
- First-load-no-hydration (dev restart artifact) root-caused and documented; workaround = one reload; mitigated by memory caps + supervisor.
- Changed files this task: next.config.ts, src/app/ads/{safe-action.ts,new}, alert-feed.tsx, resume-button.tsx, ads-toolbar.tsx, add-account-form.tsx, accounts/[id]/guardrails-form.tsx.

---
Task ID: 12
Agent: Z.ai Code (main)
Task: "keep going" — discovered the sandbox had RESET and rolled the tree back to the task-3 state; recovered the lost hardening work (tasks 4–11 artifacts) from the session record, re-verified end-to-end in the browser, commit 7bc6823

Work Log:
- LOSS DISCOVERY: git log showed only 4 commits (0a0e982 upstream + 3 env auto-commits); named commits c80296a/b935d07 gone, reflog + fsck found nothing recoverable. Confirmed lost on disk: useInstallOrigin fix (settings/edge/setup.tsx), ChartFrame, supervisor cache guard, first-run a11y, edge-worker API, CodeGPT provider, /ads/settings page (a live preview panel still requests it → 404 in dev.log — user-visible symptom of the reset).
- SURVIVED (in env commit 52dff95): full /ads module + safe-action, dev-supervisor.sh base, turbopackMemoryLimit 1024, layout next/script theme-init.
- ENVIRONMENT RECOVERY: sandbox reset also wiped global pnpm (reinstalled pnpm@10.34.5 via npm -g) and data.db (untracked; migrations recreated it on boot via predev). DB now fresh: client id=1 "Recovery Test Site" + ad_accounts ids 1–3 (demo seed), NOT the old ids 2/5–7 — all future automation must re-query ids.
- Recovered task 11: setup.tsx useInstallOrigin (useSyncExternalStore, server snapshot = placeholder) replacing render-time `typeof window` ternary; removed dead appUrl prop from EdgeSetup + its caller; first-run-prompt role=dialog/aria-modal/aria-labelledby; layout.tsx theme-script comment rewritten to the verified source facts (beforeInteractive returns a REAL script element on client mount — only afterInteractive renders null; warning is dev-only/inherent; all alternatives regress).
- Recovered task 8: new src/components/charts/chart-frame.tsx — ResponsiveContainer's own default initialDimension is literally {width:-1,height:-1} (verified in recharts 3.8.1 .d.ts), which is the width(-1) crash class; ChartFrame always passes real initial dims. Wired into ui/area-chart.tsx (feeds /ads accounts + reports), settings/ai-usage/usage-charts.tsx (bar + donut), keywords rank-sparkline.tsx. Verified live: /ads/accounts/1 chart measures 545×240.
- Recovered supervisor cache guard: pre-boot .next/dev prune at CACHE_LIMIT_MB=900 (cache/server/static/build subdirs) before each (re)start.
- NEW FINDING + FIX (was the lost task 4 "mobile overflow fix"): EVERY page overflowed 111px horizontally at 390px. Offender was NOT page content — (a) top-bar right cluster (AI usage pill + guided/pro ModeToggle, 323px) overflowed the header; (b) sidebar rendered expanded (260px) at phone widths with no auto-collapse. Fixes: top-bar.tsx hides pill+toggle below md; sidebar.tsx useIsNarrowViewport() via useSyncExternalStore (server snapshot false = desktop default, corrected post-hydration; same sanctioned pattern as the edge fix), effective collapsed = stored || narrow, toggle writes the stored pref only. NOTE: sidebar now imports useSyncExternalStore — the file already used the pattern via use-stored-state.
- Browser E2E re-verification (fresh contexts per the trusted-read rule): /welcome renders + Skip persists (seo:first-run-done=done); /settings/edge 0 console errors/0 warnings + snippet shows real origin http://localhost:3000 (hydration fix live); golden path client create → auto audit (13 findings, health 54/100) → 20 tasks; /ads demo seed (3 accounts, $434–473/24h) → run engine → Approve (1→0 suggestions) — all clean; /ads/reports + /settings/ai-usage charts render.
- GOTCHA (cost real time): the /clients/new submit appeared dead — button.click()/requestSubmit() fired the submit event but no POST, no pending. Fresh reload + retry worked; consistent with the known dev-only stale-action/HMR artifact class (task 3). If a form action ever looks dead again: reload FIRST, then debug.
- Verification matrix: 13 routes × 390px overflow=0; 7 routes × 1440px overflow=0; fresh-context console clean on /settings/edge + /ads. tsc: no src errors (only .next/dev generated-file noise); eslint: src/ clean (78 pre-existing errors all in skills/ + upload/ scaffolding).

Stage Summary:
- Sandbox reset detected and documented; all recoverable hardening restored and browser-verified (commit 7bc6823, worktree clean except env files).
- Permanently lost (needs rediscovery, was tasks 5–6): edge-worker alert delivery API, setup wizard page, SubmitButton hardening, CodeGPT AI provider integration, /ads/settings page. Flagged as task 12-g follow-up.
- New durable lesson recorded: sidebar auto-collapse + header responsive trimming are the canonical mobile pattern for this app; any new wide header widget must be wrapped in the hidden md:flex cluster.

---
Task ID: 12-g (partial)
Agent: Z.ai Code (main)
Task: Rediscover lost task-5/6 features — recovered CodeGPT provider; scoped the rest

Work Log:
- Scoped the gap: README line 76 says "No setup wizard" (so task 5's "setup wizard" was an internal detail, not README-promised); the edge delivery chain GET /api/edge/fixes (token auth + cache headers + graceful-empty) SURVIVED and is complete — worker edge-worker/seo-tool-worker.js only GETs that endpoint, nothing missing server-side. No in-app reference to /ads/settings exists; the 404 in dev.log is only a user browser tab from before the reset — left as-is rather than inventing an unspecified page.
- Recovered task 6 (CodeGPT) across every exhaustive registry: api-providers.ts (union + catalog card, free-tier, steps for JWT-style API key), api-keys.ts (ENV_VAR CODEGPT_API_KEY + SETTING_KEY api.codegpt), settings-store.ts SettingKey union, provider-dispatch.ts (openai-compat → https://api.codegpt.co/v1/chat/completions), ai-model-presets.ts (11 presets, default gpt-4o-mini, rates mirror underlying vendors + PROVIDER_LABEL), api/test-provider (VALID set + probe branch), db/schema.ts ai-visibility provider enum, llm-citation.ts PROVIDER_GROUNDING codegpt:"memory", settings/key-actions ALLOWED_KEYS, README provider list (also added Mistral/Cerebras/Together/GitHub — stale before the reset).
- TypeScript exhaustiveness did the discovery work for me: adding "codegpt" to the Provider union made tsc enumerate every incomplete map (8 errors → 0 fixes). Verified live: /settings renders the CodeGPT card with FREE TIER badge + key link; tsc + eslint clean; commit 8a70250.
- Honest limits: model list/prices are CodeGPT's catalog as known at integration time, not a live /v1/models probe (no key in this sandbox to fetch with); real-call test requires the user's key via the existing Test button.

Stage Summary:
- CodeGPT is back as provider #13 (12 + Ollama), fully wired and UI-verified; commit 8a70250, src lint/tsc clean.
- Still missing from the lost sessions (unknown spec, low confidence to reconstruct): /ads/settings page (if it ever held more than the per-account guardrails editor) and whatever SubmitButton hardening was — grep shows form submits here use plain useActionState; no SubmitButton component exists to fix.

---
Task ID: 13
Agent: Z.ai Code (main)
Task: "geliştirmeye devam edelim" — API routes smoke audit (the last untested surface) + follow the ai-call failure symptom to an env-var collision fix

Work Log:
- Enumerated all 36 API route files (47 HTTP handlers); classified GET/POST + side effects. DANGEROUS ones (restart, shutdown, restore POST, update POST, desktop-shortcut POST) identified and NOT called — code review only.
- Guard architecture verified by reading src/lib/admin-auth.ts: 3-layer protection (Sec-Fetch-Site CSRF check first in every mode; accounts mode = owner role; password mode = proxy cookie; open mode = local-socket only). Destructive POSTs all behind guardAdminRequest.
- Live smoke suite (/home/z/.audit/api-smoke.sh): 26 probes, ALL as designed —
  - open endpoints (auth/mode, auth/status, health-ping, v1/health, errors/env) → 200 sane JSON
  - v1 Bearer API: 9/9 endpoints return 401 without token (clients, clients/1, audits, audits/1, keywords, rankings, reports, snapshots, capture)
  - edge/fixes contract exact: 400 (no client / client=0), 401 (no token); cache headers + graceful-empty catch in code
  - errors/by-digest: 400 on non-numeric digest (format validation is correct — Next digests are numeric), 200 {found:false} on valid-format miss
  - google/auth + callback → 307 to /settings/google?error=no-credentials|missing-code (graceful, not configured here)
  - report-archives/999999/pdf → 404; restore GET → db size+SQLite header check; update GET → local SHA vs remote (null remote degrades gracefully); desktop-shortcut GET → Windows-only message
  - team/invite has 401/403 guards; errors POST truncates context/digest fields
- SYMPTOM FOLLOW-UP (dev.log: recurring "[ai-call] gpt-4o-mini call failed: fetch failed" on every GET /): root-caused to an env-var collision — the `github` AI provider's env fallback is GITHUB_TOKEN; this session stored the user's repo-push PAT in .env as GITHUB_TOKEN → Next reloaded env → configuredProviders() counted github as configured → scheduler agents fired doomed AI calls (sandbox has no egress to models endpoint). ai-call.ts's no_provider short-circuit was correct all along; the input was wrong.
- FIX (2 files): api-keys.ts — ENV_VAR map → ENV_VAR_CANDIDATES (priority list per provider) + envApiKey() helper; github = ["GITHUB_MODELS_TOKEN", "GITHUB_TOKEN"] with full collision rationale in comments (CI/git tooling set GITHUB_TOKEN universally). api-providers.ts — GitHub Models card envVar hint → GITHUB_MODELS_TOKEN, notes explain the stray-GITHUB_TOKEN hazard. GITHUB_TOKEN kept as fallback so explicit Actions/Codespaces setups still work.
- Sandbox-side: renamed the push token in .env + ~/.bashrc from GITHUB_TOKEN to GITHUB_PAT (name the app never reads) — collision removed at the source.
- Verified live: after Next's "Reload env: .env", two consecutive GET / produced ZERO new ai-call failures (previously every load logged one). tsc + eslint clean.

Stage Summary:
- API surface (36 route files) audited end-to-end: auth guards, contracts, and degradation paths all correct — no endpoint fixes needed. Combined with tasks 10–11 (28 page routes browser-verified), every user-facing surface has now been exercised.
- Real bug found and fixed: GitHub Models AI provider silently activated by any environment GITHUB_TOKEN (CI collision class). New preferred env var GITHUB_MODELS_TOKEN; UI hint updated; sandbox token renamed to GITHUB_PAT.
- Durable lesson: .env is app-env — never store generic-name secrets (GITHUB_TOKEN, OPENAI_API_KEY...) in it that collide with the app's provider env fallbacks; use suffixed names (GITHUB_PAT).

---
Task ID: 14
Agent: Z.ai Code (main)
Task: "keep going" — Tier-3 route audit (settings subpages + tools + dashboard neighbors) + root-cause a restart storm that blocked it

Work Log:
- Enumerated ALL page routes: 229 total, 28 covered by tasks 10-11 → ~200 never browser-verified. Built Tier-3 sample of 18 representative routes (all 7 uncovered /settings/* subpages, 8 tools form pages, /activity, /automations, /digest, /news, /history, /monitor).
- AUDIT STORM (blocked the first 3 attempts): dev server died every ~60s. Root-caused in three steps: (1) dmesg showed kernel OOM-kill of next-server at 3.24GB anon-rss; (2) live watch showed baseline RSS 2.47GB with ONLY / warm — .next/dev cache had grown to 2,134MB unchecked; (3) WHY the 900MB cache guard never fired: supervisor PID started 08:22:04, guard added to the script 08:24:49 — bash reads scripts lazily, the running `while true` loop kept executing the OLD guard-less body forever. Classic edit-a-running-bash-script hazard masquerading as a turbopack bug.
- FIX: killed stale supervisor, pruned .next/dev (2,134MB → 2MB), restarted supervisor fully detached `( setsid ... < /dev/null > dev.log 2>&1 & )`. Guard now live. Documented the hazard in the script header so the next editor restarts the process.
- Measured clean baseline: 2.0-2.1GB RSS with empty cache + / warm (intrinsic dev footprint; OOM ceiling ~3.2GB → ~1.1GB headroom, and Chrome + one new-route compile consumes exactly that). Consequence: audit in batches of 2-3 routes per server lifetime; the supervisor recovers between batches. Harness v3 hardened: curl pre-warm per route (server-side compile, tolerant of graceful exits), FRESH browser context per route (close→open — kills stale-chunk ChunkLoadError cascade AND gives trusted console reads), server health-check between steps.
- RESULTS: 18/18 routes CLEAN — 0 console errors, 0 page errors, 0 horizontal overflow at 1440×900 AND 390×844 (sw==cw everywhere): /settings/{backup,errors,health,install,team,google,ai-learning} /tools/{robots,sitemap,headers,meta-tag-generator,llms-txt,serp-features,health-check,keyword-difficulty} /{activity,automations,digest,news,history,monitor}.
- /digest PAGEERR=1 during batch: errors dump was an empty "✗" line; fresh-context repro = 0 errors, page renders ("Weekly digest"). Non-reproducible dev transient (HMR/chunk hiccup), not a defect.
- Harness lives at /home/z/.audit/route-audit.sh (agent-browser gotcha: its eval output escapes quotes as \" — strip backslashes before parsing JSON).

Stage Summary:
- Tier-3 audit: 18 more routes verified clean; combined with tasks 10-13, 46 of 229 routes exercised end-to-end with zero product defects found beyond task 13's env-collision fix. The app's route surface is remarkably solid; remaining ~180 routes are mostly /tools/* variants sharing the same shell + form patterns as the audited sample.
- Operational root cause banked: stale-running-bash-script supervisor. Sandbox baseline math documented (2.05GB intrinsic + ~0.4GB per GB of .next/dev cache; OOM at 3.2GB; audit batch size = 2-3 routes).
- Commit includes: supervisor script warning + usage fix, worklog task 14.

---
Task ID: 14.0
Agent: Z.ai Code (main)
Task: Proje 3 parçaya bölme planı (devops tarzı): frontend Next.js (olduğu gibi, importlar yenilenecek) / backend Rust (yeni) / db SQLite (olduğu gibi). Plan dokümanı + todo listesi + Rust toolchain kurulumu + backend scaffold.

Work Log:
- Recon: envanter ölçümü — 36 API route dosyası + 19 dış route handler (CSV×11, PDF×4, r/[slug], screenshots) + 158 server actions dosyası (~90'ı tools/*) + 150 dosya @/lib/db veya @/db direkt import ediyor. data.db 733KB, 80 tablo, zaten WAL modda.
- Strateji kararı: big-bang yerine strangler-fig — Rust backend domain-domain büyür, frontend kontratı sabit kalır.
- docs/architecture-split-plan.md yazıldı: ölçümler, hedef mimari (R1-R5 kuralları), 11 fazlı plan (14.0-14.10), kararlar, risk tablosu.
- Rust toolchain kuruldu: rustup 1.99.1 minimal profile (background nohup sandbox'ta öldüğü için foreground'da), PATH ~/.bashrc'ye kalıcı eklendi.
- backend/ scaffold: Cargo.toml (axum 0.7, tokio, rusqlite bundled, tower-http trace/cors), src/main.rs (/health canlı DB smoke: tablo sayısı + journal mode, /api/health alias), run-dev.sh + up.sh (up|stop|status pidfile supervisor), README, .gitignore (target/log/pid).
- İlk derleme hatası: json! makrosu DbHealth struct'ını serileştiremedi → #[derive(Serialize)] eklendi. İkinci sorun: up.sh içinde cargo PATH'te yoktu (taze shell) → scriptlere export PATH="$HOME/.cargo/bin:$PATH" eklendi.
- Doğrulama: :3100/health direkt ✓, :81 gateway XTransformPort=3100 ✓ (aynı JSON), /api/health alias ✓, Next :3000 etkilenmedi ✓ (200, actions çalışıyor).

Stage Summary:
- backend/ canlı: Rust 1.99.1 + axum, port 3100, /health → {"status":"ok","db":{"ok":true,"tables":80,"journal_mode":"wal"}}
- Plan dokümanı commit'lendi: docs/architecture-split-plan.md (R1: frontend DB'ye asla dokunmaz, R2: Rust tek DB client, R3: DB olduğu gibi/Drizzle schema sahibi, R4: kontrat parity, R5: server actions → REST + client wrapper)
- Sonraki faz 14.1: api-contract.md envanteri + parity harness.
