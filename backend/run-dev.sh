#!/usr/bin/env bash
# Rust backend dev runner (foreground). Build artifacts stay in backend/target.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$PATH"
export PORT="${PORT:-3100}"
export DATABASE_PATH="${DATABASE_PATH:-../data.db}"
exec cargo run
