#!/usr/bin/env bash
# Rust backend background supervisor: up | stop | status
# Mirrors the sandbox's dev-supervisor pattern for the Next app.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$PATH"
PID_FILE="backend-dev.pid"
LOG_FILE="backend-dev.log"
export PORT="${PORT:-3100}"
export DATABASE_PATH="${DATABASE_PATH:-../data.db}"

case "${1:-up}" in
  up)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "backend already running (pid $(cat "$PID_FILE"))"; exit 0
    fi
    nohup cargo run > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "backend starting (pid $!, log $LOG_FILE, port $PORT)"
    ;;
  stop)
    if [ -f "$PID_FILE" ]; then
      kill "$(cat "$PID_FILE")" 2>/dev/null || true
      rm -f "$PID_FILE"
      echo "backend stopped"
    else
      echo "no pid file"; exit 0
    fi
    ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "running (pid $(cat "$PID_FILE"))"
      curl -s -o /dev/null -w "health:%{http_code}\n" "http://127.0.0.1:${PORT}/health" || true
    else
      echo "stopped"
    fi
    ;;
  *) echo "usage: $0 up|stop|status"; exit 1 ;;
esac
