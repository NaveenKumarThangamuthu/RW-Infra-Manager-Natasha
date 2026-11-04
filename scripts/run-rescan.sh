#!/usr/bin/env bash
# Wrapper for the bulk re-scan so it can run detached under systemd-run.
# Hydrates DB-held secrets (GitHub token, GDrive refresh token for the
# allowlist) the same way the dashboard does, then runs the scanner.
set -euo pipefail

REPO="/home/naveen5/Documents/projects/Infra"
cd "$REPO"

set -a
# shellcheck disable=SC1091
[ -f "$REPO/.env" ] && . "$REPO/.env"
set +a

HYDRATE_OUT="$(node "$REPO/scripts/hydrate-secrets-cli.mjs" 2>/dev/null || true)"
[ -n "$HYDRATE_OUT" ] && eval "$HYDRATE_OUT"
unset HYDRATE_OUT

# Bulk runs hit big repos: give clone and each scanner more headroom than the
# interactive single-repo defaults, otherwise findings get silently truncated.
export NATASHA_CLONE_TIMEOUT_MS="${NATASHA_CLONE_TIMEOUT_MS:-300000}"
export NATASHA_SCAN_TIMEOUT_MS="${NATASHA_SCAN_TIMEOUT_MS:-420000}"

exec npx tsx scripts/rescan-all.ts "$@"
