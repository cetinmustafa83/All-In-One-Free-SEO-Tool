#!/usr/bin/env bash
# CI helper: (re)start the Rust backend against a SPECIFIC database.
#
#   backend/tools/ci-up.sh <db-path> [port]
#
# Why this exists: after the 14.9 cutover the ported halves of the app
# round-trip through the backend (server actions are thin REST proxies,
# RSC pages read via the sqlite-proxy gateway). Any CI step that points
# SEO_DB_PATH at a scratch database therefore needs the backend on THAT
# SAME file — otherwise the TS side asserts on data the backend never
# saw, and the step either fails confusingly or, worse, passes green
# against a database the code never wrote to. The same file for both
# stacks is what keeps a step's view coherent.
#
# `stop` first: up.sh refuses to double-start, and a previous step's
# backend (on a different DB) may still be running.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

DB_PATH="${1:?usage: ci-up.sh <db-path> [port]}"
PORT="${2:-3201}"

bash backend/up.sh stop >/dev/null 2>&1 || true
SEO_DATA_DIR="${SEO_DATA_DIR:-$ROOT}" DATABASE_PATH="$DB_PATH" PORT="$PORT" \
  bash backend/up.sh up

for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/health" 2>/dev/null; then
    echo "backend healthy on :$PORT (db: $DB_PATH)"
    exit 0
  fi
  sleep 1
done

echo "backend did not become healthy on :$PORT — tail of backend/backend-dev.log:" >&2
tail -20 backend/backend-dev.log >&2 || true
exit 1
