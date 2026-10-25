#!/usr/bin/env bash
# ============================================================
#  SEO Tool - START
#  Double-click this file (or run from terminal) to start the app.
#  The app opens in your browser at http://localhost:3000
#  (or whichever port the installer picked).
# ============================================================
#
# Modes:
#   - If frontend/.next/BUILD_ID exists -> production mode (fast, ~2s)
#   - Otherwise                -> dev mode (slower first paint, 30-60s)
#     Run `pnpm build` once to switch to production mode.
#
# Env overrides:
#   PORT           target port (default 3000)
#   SEO_RESTART    when 1, skips opening a fresh browser tab
#   SEO_FORCE_DEV  when 1, forces dev mode even if a build exists
#   SEO_BIND_HOST  default 127.0.0.1; set 0.0.0.0 to expose on LAN
#                  (REQUIRES setting APP_PASSWORD in .env.local first)

set -e
# This launcher lives in bin/; runtime state (.dev-server.pid,
# .seo-port, db/data.db, frontend/.next, node_modules) at the install root.
cd "$(dirname "$0")/.."

# ---- 1. Resolve PORT
if [ -z "$PORT" ] && [ -f ".seo-port" ]; then
  PORT="$(cat .seo-port 2>/dev/null | tr -d '[:space:]')"
fi
PORT="${PORT:-3000}"

# ---- 2. Find pnpm or npm
if command -v pnpm >/dev/null 2>&1; then
  PM="pnpm"
elif command -v npm >/dev/null 2>&1; then
  PM="npm"
else
  echo ""
  echo "Node / npm not found."
  echo "Install Node 20+ from https://nodejs.org and try again."
  echo ""
  read -p "Press Enter to close..." _
  exit 1
fi

# ---- 2b. First-run self-bootstrap.
# Runs ONCE on a freshly-extracted ZIP that's never been installed.
# Detects missing node_modules / .next / playwright and installs them
# so double-clicking "SEO Tool.command" on a brand-new
# machine just works. ~5 min total on first run; no-op thereafter.
FIRST_RUN_BOOTSTRAP=0
[ ! -d "node_modules" ] && FIRST_RUN_BOOTSTRAP=1
[ ! -f "frontend/.next/BUILD_ID" ] && FIRST_RUN_BOOTSTRAP=1

if [ "$FIRST_RUN_BOOTSTRAP" = "1" ]; then
  echo ""
  echo "============================================================"
  echo "  First-run setup. This happens once on a fresh extract."
  echo "  Takes about 5 minutes total. Please keep this open."
  echo "============================================================"
  echo ""
fi

if [ ! -d "node_modules" ]; then
  echo "[1/3] Installing dependencies via $PM..."
  echo "      (this is the longest step — 3-5 minutes)"
  echo ""
  export NPM_CONFIG_IGNORED_BUILDS_CHECK=false
  export NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true
  if [ "$PM" = "pnpm" ]; then
    $PM install --ignore-scripts --prefer-offline
  else
    $PM install --no-audit --no-fund --ignore-scripts
  fi
  if [ $? -ne 0 ]; then
    echo ""
    echo "Dependency install failed. Check messages above."
    read -p "Press Enter to close..." _
    exit 1
  fi
  $PM rebuild >/dev/null 2>&1 || true
fi

if [ ! -f "frontend/.next/BUILD_ID" ]; then
  echo ""
  echo "[2/3] Building production bundle..."
  echo "      (1-2 min; makes daily boot ~3s instead of ~30s)"
  echo ""
  $PM run build || echo "Production build failed; will fall back to dev mode."
fi

# Playwright chromium — non-blocking (skip-safe if it fails)
if [ "$FIRST_RUN_BOOTSTRAP" = "1" ]; then
  if [ ! -d "$HOME/Library/Caches/ms-playwright" ] && [ ! -d "$HOME/.cache/ms-playwright" ]; then
    echo ""
    echo "[3/3] Downloading Playwright Chromium (~170 MB, 1-2 min)..."
    echo "      (used by rank tracker + SERP scanner; skip-safe)"
    echo ""
    $PM exec playwright install chromium 2>/dev/null || true
  fi
fi

if [ "$FIRST_RUN_BOOTSTRAP" = "1" ]; then
  echo ""
  echo "============================================================"
  echo "  First-run setup complete. Starting server..."
  echo "============================================================"
  echo ""
fi

health_url="http://localhost:$PORT/api/v1/health"
INSTALL_ROOT="$(pwd)"

# ---- 3. Already running on this port? Distinguish OURS vs a SIBLING
# install. The health endpoint reports its `installRoot`; if that
# doesn't match ours, someone ELSE's SEO Tool is on this port and we
# should pick a different one instead of opening THEIR data in our
# user's browser.
HEALTH_BODY="$(curl -fsS --max-time 2 "$health_url" 2>/dev/null || true)"
if [ -n "$HEALTH_BODY" ]; then
  # Cheap JSON extraction — match "installRoot":"..."
  REMOTE_ROOT="$(printf '%s' "$HEALTH_BODY" | sed -n 's/.*"installRoot":"\([^"]*\)".*/\1/p')"
  # Normalize slashes for cross-platform compare (the server may report
  # an OS-specific path; bash's INSTALL_ROOT uses forward slashes).
  REMOTE_ROOT_NORM="${REMOTE_ROOT//\\//}"
  LOCAL_ROOT_NORM="${INSTALL_ROOT//\\//}"
  if [ -n "$REMOTE_ROOT_NORM" ] && [ "$REMOTE_ROOT_NORM" != "$LOCAL_ROOT_NORM" ]; then
    echo "Port $PORT is already serving a DIFFERENT SEO Tool install at:"
    echo "  $REMOTE_ROOT"
    echo "Picking a new port for this install..."
    # Force pick-port.cjs to reroll; it writes a new .seo-port for us.
    if command -v node >/dev/null 2>&1 && [ -f scripts/pick-port.cjs ]; then
      NEW_PORT="$(node scripts/pick-port.cjs --reroll 2>/dev/null || true)"
      if [[ "$NEW_PORT" =~ ^[0-9]+$ ]]; then
        PORT="$NEW_PORT"
        health_url="http://localhost:$PORT/api/v1/health"
        echo "Using port $PORT."
      fi
    fi
  else
    echo "SEO Tool is already running on port $PORT."
    if [ "$SEO_RESTART" != "1" ]; then
      if command -v open >/dev/null 2>&1; then
        open "http://localhost:$PORT" 2>/dev/null || true
      elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "http://localhost:$PORT" 2>/dev/null || true
      fi
    fi
    exit 0
  fi
fi

# Restart? Give the old server a beat to free the port.
[ "$SEO_RESTART" = "1" ] && sleep 2

# ---- 3b. Is the saved port occupied by SOMETHING ELSE (not us)?
port_in_use() {
  local p="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -i :"$p" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ss -lnt "( sport = :$p )" 2>/dev/null | grep -q LISTEN
  elif command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null | grep -q "[\.:]$p .*LISTEN"
  else
    return 1
  fi
}

if port_in_use "$PORT"; then
  echo "Port $PORT is occupied by another process. Picking a free port..."
  # Prefer the canonical Node picker — uses the ephemeral-range strategy.
  if command -v node >/dev/null 2>&1 && [ -f scripts/pick-port.cjs ]; then
    NEW_PORT="$(node scripts/pick-port.cjs --reroll 2>/dev/null || true)"
    if [[ "$NEW_PORT" =~ ^[0-9]+$ ]]; then
      PORT="$NEW_PORT"
      echo "  using port $PORT"
    fi
  else
    # Pure-bash fallback (Node should always be present by this point,
    # but a defensive path for first-boot weirdness).
    for try in 3001 3002 3003 3004 3005 8080 8081 4000 5000; do
      if ! port_in_use "$try"; then
        PORT="$try"
        echo "  using port $PORT"
        echo "$PORT" > .seo-port
        break
      fi
    done
  fi
fi

# ---- 4. Stop any prior server we own (idempotent re-run)
if [ -f ".dev-server.pid" ]; then
  OLD_PID="$(cat .dev-server.pid 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
fi

# ---- 4b. Start the Rust backend (:3100 by default) ----
#
# Since the phase-14 split (docs/architecture-split-plan.md) the ported
# /api surface — auth, the v1 public API, exports, the internal action
# endpoints — is served by this process and Next proxies /api/* to it
# (the 14.9 cutover). Without it nearly every page 502s: the RSC pages
# read through the backend's query gateway. So the backend is as much a
# part of "starting the app" as Next itself.
#
# Resolution order:
#   1. already healthy on the port (re-run after STOP missed it),
#   2. prebuilt platform binary shipped in the ZIP (backend/bin/),
#   3. cargo-built release binary (backend/target/release/),
#   4. build from source when a cargo toolchain is present,
#   5. otherwise: loud warning, degraded start (UI boots, /api 404s).
BACKEND_PORT="${SEO_BACKEND_PORT:-3100}"
export API_BACKEND_URL="${API_BACKEND_URL:-http://127.0.0.1:$BACKEND_PORT}"
export SEO_BACKEND_URL="${SEO_BACKEND_URL:-$API_BACKEND_URL}"

backend_healthy() {
  curl -fsS --max-time 1 "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1
}

if backend_healthy; then
  echo "Rust backend already running on :$BACKEND_PORT."
else
  BACKEND_BIN=""
  # Normalize to the naming build-release-zip.mjs uses
  # (process.platform-process.arch: linux-x64, darwin-arm64, ...).
  case "$(uname -s)" in
    Linux) OS=linux ;;
    Darwin) OS=darwin ;;
    *) OS="$(uname -s | tr '[:upper:]' '[:lower:]')" ;;
  esac
  case "$(uname -m)" in
    x86_64) ARCH=x64 ;;
    aarch64 | arm64) ARCH=arm64 ;;
    *) ARCH="$(uname -m)" ;;
  esac
  for cand in \
    "backend/bin/seo-backend-$OS-$ARCH" \
    "backend/bin/seo-backend" \
    "backend/target/release/seo-backend"; do
    if [ -x "$cand" ]; then BACKEND_BIN="$cand"; break; fi
  done
  if [ -z "$BACKEND_BIN" ] && command -v cargo >/dev/null 2>&1; then
    echo "Building the Rust backend from source (first run only, a few minutes)..."
    (cd backend && cargo build --release --locked) || true
    [ -x backend/target/release/seo-backend ] && BACKEND_BIN="backend/target/release/seo-backend"
  fi
  if [ -n "$BACKEND_BIN" ]; then
    echo "Starting Rust backend on :$BACKEND_PORT..."
    PORT="$BACKEND_PORT" DATABASE_PATH="$PWD/db/data.db" SEO_DB_PATH="$PWD/db/data.db" \
      nohup "$BACKEND_BIN" > backend.log 2>&1 &
    echo $! > .seo-backend.pid
    for i in $(seq 1 30); do backend_healthy && break; sleep 1; done
    if ! backend_healthy; then
      echo "WARNING: Rust backend did not become healthy on :$BACKEND_PORT."
      echo "         /api calls will fail — see backend.log for the cause."
    fi
  else
    echo "WARNING: no Rust backend binary found and no cargo toolchain installed."
    echo "         The UI will start, but /api endpoints (sign-in, data reads,"
    echo "         exports) will not respond. Fix either way:"
    echo "           - install Rust: https://rustup.rs  (then re-run this launcher)"
    echo "           - or re-download a ZIP built with a backend binary included"
  fi
fi

# ---- 5. Pick mode
RUN_CMD="dev"
if [ -f "frontend/.next/BUILD_ID" ] && [ "$SEO_FORCE_DEV" != "1" ]; then
  RUN_CMD="start:daily"
fi

# ---- 6. Fresh log on each start
: > dev-server.log

# ---- 7. Start detached. HOSTNAME=127.0.0.1 binds to loopback so LAN
#         devices can't reach us. Override with SEO_BIND_HOST=0.0.0.0.
HOST_BIND="${SEO_BIND_HOST:-127.0.0.1}"
echo "Starting SEO Tool on port $PORT..."
echo "(first launch can take 30-90 seconds while it compiles)"
PORT="$PORT" HOSTNAME="$HOST_BIND" nohup $PM run "$RUN_CMD" >dev-server.log 2>&1 &
echo "$!" > .dev-server.pid

# ---- 8. Wait for /api/v1/health (cheap JSON, doesn't trigger dev compile)
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null --max-time 1 "$health_url" 2>/dev/null; then
    break
  fi
  sleep 1
done

# ---- 9. Open browser unless this is a restart.
# Try Chrome / Edge / Brave with --app=URL first for the PWA-like
# dedicated-window experience (no tabs, no URL bar). Fall back to the
# system default browser if none of those are installed.
if [ "$SEO_RESTART" != "1" ]; then
  APP_URL="http://localhost:$PORT"
  OPENED=0
  OS_NAME="$(uname -s)"

  open_app_window() {
    local bin="$1"
    if command -v "$bin" >/dev/null 2>&1; then
      "$bin" --app="$APP_URL" >/dev/null 2>&1 &
      OPENED=1
    fi
  }

  if [ "$OS_NAME" = "Darwin" ]; then
    # macOS: try the canonical .app bundles first via `open -a`
    for app in "Google Chrome" "Microsoft Edge" "Brave Browser"; do
      if [ "$OPENED" = "0" ] && [ -d "/Applications/$app.app" ]; then
        open -na "$app" --args --app="$APP_URL" >/dev/null 2>&1 && OPENED=1
      fi
    done
  else
    # Linux: probe binaries in PATH
    for bin in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge brave-browser; do
      if [ "$OPENED" = "0" ]; then
        open_app_window "$bin"
      fi
    done
  fi

  if [ "$OPENED" = "0" ]; then
    if command -v open >/dev/null 2>&1; then
      open "$APP_URL" 2>/dev/null || true
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$APP_URL" 2>/dev/null || true
    fi
  fi
fi

echo "SEO Tool is running at http://localhost:$PORT"
