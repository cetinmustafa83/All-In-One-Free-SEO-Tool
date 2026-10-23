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
# Usage:  setsid nohup ./.zscripts/dev-supervisor.sh > dev.log 2>&1 &
set -u

cd "$(dirname "$0")/.."

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"

while true; do
  echo "[$(date '+%F %T')] starting: pnpm dev (NODE_OPTIONS=$NODE_OPTIONS)"
  pnpm dev
  code=$?
  echo "[$(date '+%F %T')] dev exited with code $code — restarting in 3s"
  sleep 3
done
