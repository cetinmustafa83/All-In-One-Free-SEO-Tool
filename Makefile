# Makefile — the one screen that explains how to drive this repo.
#
# The repo is two processes since the phase-14 split (see
# docs/architecture-split-plan.md): the Next.js frontend on :3000 and the
# Rust backend on :3100, both against the same SQLite file (data.db).
# Every target here is a thin wrapper over the same commands the docs
# describe — `make` is a convenience, not a second build system.
#
# `make help` is the default target: run it with no arguments.

.DEFAULT_GOAL := help
CARGO ?= cargo

.PHONY: help install dev build start lint typecheck test check \
        backend-up backend-stop backend-status backend-logs backend-build \
        migrate smoke parity compose-up compose-down compose-logs \
        release clean

help:
	@echo "SEO Tool — make targets"
	@echo ""
	@echo "  everyday"
	@echo "    make install     pnpm install + cargo fetch (both toolchains)"
	@echo "    make dev         start backend (:3100) + next dev (:3000)"
	@echo "    make migrate     apply SQLite migrations (scripts/migrate.cjs)"
	@echo ""
	@echo "  verify"
	@echo "    make check       cargo check (Rust, the fast gate)"
	@echo "    make lint        eslint over the Next app"
	@echo "    make typecheck   tsc --noEmit"
	@echo "    make test        vitest unit suite"
	@echo "    make smoke       backend internal smoke suite (142 asserts)"
	@echo "    make parity      Next-vs-Rust response parity probes (34)"
	@echo ""
	@echo "  backend"
	@echo "    make backend-up / backend-stop / backend-status / backend-logs"
	@echo "    make backend-build     cargo build --release (target/release/seo-backend)"
	@echo ""
	@echo "  docker (image runs BOTH processes; see docker-compose.yml)"
	@echo "    make compose-up / compose-down / compose-logs"
	@echo ""
	@echo "  misc"
	@echo "    make build       production Next build"
	@echo "    make start       next start (expects make build + backend-up)"
	@echo "    make release     build the distributable ZIP (desktop packaging)"
	@echo "    make clean       remove .next and backend/target"

install:
	pnpm install
	cd backend && $(CARGO) fetch

# The backend is started first because everything /api-shaped on :3000
# proxies to it (14.9 cutover) — a page load during the backend's first
# compile would otherwise 502.
dev: backend-up
	pnpm dev

migrate:
	node scripts/migrate.cjs

check:
	cd backend && $(CARGO) check --locked

lint:
	pnpm lint

typecheck:
	pnpm typecheck

test:
	pnpm test

smoke:
	bash backend/tools/internal-smoke.sh

# Parity compares :3000 against :3100 directly — it does not care which
# side actually computed a response, which is exactly what makes it the
# right check for the cutover.
parity:
	NEXT=http://127.0.0.1:3000 RUST=http://127.0.0.1:3100 bun backend/tools/parity.ts

backend-up:
	bash backend/up.sh up

backend-stop:
	bash backend/up.sh stop

backend-status:
	bash backend/up.sh status

backend-logs:
	tail -f backend/backend-dev.log

backend-build:
	cd backend && $(CARGO) build --release --locked

build:
	pnpm build

start: backend-up
	pnpm start

compose-up:
	docker compose up -d --build

compose-down:
	docker compose down

compose-logs:
	docker compose logs -f seo

release:
	pnpm build:release

clean:
	rm -rf .next backend/target
