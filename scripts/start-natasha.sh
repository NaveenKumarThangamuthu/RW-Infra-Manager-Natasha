#!/usr/bin/env bash
# Start the Natasha Next.js server on :3000 with all managed secrets
# hydrated from the encrypted secret_store table into the environment
# BEFORE Next.js reads process.env at module init (so NextAuth's Google
# provider, SONAR_TOKEN, GITHUB_* etc. are visible).
#
# Usage:  ./scripts/start-natasha.sh
#         (writes to logs/server.log, disowns background process)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

# 1) Load bootstrap env from .env so hydrate-secrets-cli has DATABASE_URL /
#    MYSQL_USER / MYSQL_PASSWORD / INFRA_KMS_KEY available.
set -a
# shellcheck disable=SC1091
[ -f "$REPO/.env" ] && . "$REPO/.env"
set +a

# 2) Decrypt secrets from the DB and export them into this shell.
#    hydrate-secrets-cli.mjs prints `export KEY='value'` lines to stdout.
HYDRATE_OUT="$(node "$REPO/scripts/hydrate-secrets-cli.mjs" 2>/dev/null)"
if [ -z "$HYDRATE_OUT" ]; then
    echo "[start-natasha] WARN: hydrate-secrets-cli produced no output — Google Sign-In etc. will be missing." >&2
else
    # shellcheck disable=SC1090
    eval "$HYDRATE_OUT"
    HYDRATED_COUNT="$(printf '%s\n' "$HYDRATE_OUT" | grep -c '^export ')"
    echo "[start-natasha] hydrated $HYDRATED_COUNT secrets from DB" >&2
fi
unset HYDRATE_OUT

# 3) Start Next.js in the background.
mkdir -p "$REPO/logs"
nohup npx next start -p 3000 > "$REPO/logs/server.log" 2>&1 &
NEW_PID=$!
disown "$NEW_PID" 2>/dev/null || true
echo "[start-natasha] Next.js started · PID=$NEW_PID · log=$REPO/logs/server.log"
