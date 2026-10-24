#!/usr/bin/env bash
# OOM-resilient dev supervisor for this sandbox.
#
# Why: Turbopack compiles ~100 routes with a large native working set and
# the 4 GB sandbox kernel OOM-kills next-server mid-compile (observed
# twice: 2.76 GB and 3.22 GB anon-rss, both with no trace in dev.log).
# The on-disk .next/dev cache is persistent, so a restart resumes with
# everything already-compiled and each warm-up is cheaper than the last.
# This loop simply brings the server back when the kernel takes it down.
#
# Usage:  ( setsid ./.zscripts/dev-supervisor.sh < /dev/null > dev.log 2>&1 & )
#
# !! If you EDIT this file, RESTART the running supervisor. Bash reads
# scripts lazily and a `while true` loop already parsed keeps executing
# the OLD body forever — a 2026-10-24 session lost its cache guard this
# way: the guard was added at 08:24 but the supervisor was started at
# 08:22, the cache grew unchecked to 2.1 GB, next-server's baseline RSS
# hit 2.5 GB, and every new-route compile OOM-killed at 3.2 GB in a
# restart storm that looked like a turbopack bug.
set -u

cd "$(dirname "$0")/.."

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"

# Pre-boot cache guard.
#
# The persistent .next/dev cache is what makes restarts cheap, but it
# only ever grows — and a huge cache inflates next-server's anonymous
# RSS until the 4 GB kernel OOM-kill returns. Before each (re)start,
# if the cache exceeds CACHE_LIMIT_MB, drop the ephemeral compile
# artifacts (keep config/lock files) so the next warm-up rebuilds from
# a sane baseline instead of dying at boot.
CACHE_LIMIT_MB="${CACHE_LIMIT_MB:-900}"

cache_guard() {
  local dir=".next/dev"
  [ -d "$dir" ] || return 0
  local mb
  mb=$(( $(du -sm "$dir" 2>/dev/null | cut -f1) ))
  if [ "$mb" -gt "$CACHE_LIMIT_MB" ]; then
    echo "[$(date '+%F %T')] cache guard: .next/dev is ${mb}MB (limit ${CACHE_LIMIT_MB}MB) — pruning"
    rm -rf "$dir/cache" "$dir/server" "$dir/static" "$dir/build" 2>/dev/null
    mb=$(( $(du -sm "$dir" 2>/dev/null | cut -f1) ))
    echo "[$(date '+%F %T')] cache guard: pruned, now ${mb}MB"
  fi
}

while true; do
  cache_guard
  echo "[$(date '+%F %T')] starting: pnpm dev (NODE_OPTIONS=$NODE_OPTIONS)"
  pnpm dev
  code=$?
  echo "[$(date '+%F %T')] dev exited with code $code — restarting in 3s"
  sleep 3
done
