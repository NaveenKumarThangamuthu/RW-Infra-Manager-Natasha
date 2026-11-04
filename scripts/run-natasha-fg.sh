#!/usr/bin/env bash
# Foreground launcher for the Natasha Next.js dashboard, used by the
# systemd user unit `natasha-dashboard.service`.
#
# Unlike start-natasha.sh (which backgrounds itself and dies with its
# parent shell), this runs Next.js in the foreground so systemd owns the
# process, restarts it on failure, and brings it back after reboot.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

# 1) Bootstrap env (DATABASE_URL / MYSQL_* / INFRA_KMS_KEY) from .env.
#    Note: .env must NOT define PATH — a pinned nvm path breaks on upgrade.
set -a
# shellcheck disable=SC1091
[ -f "$REPO/.env" ] && . "$REPO/.env"
set +a

# 2) Decrypt managed secrets from the DB into this shell before Next.js
#    reads process.env at module init (NextAuth Google, SONAR_TOKEN, ...).
HYDRATE_OUT="$(node "$REPO/scripts/hydrate-secrets-cli.mjs" || true)"
if [ -z "$HYDRATE_OUT" ]; then
    echo "[natasha] WARN: no secrets hydrated — Google Sign-In etc. will be missing." >&2
else
    # shellcheck disable=SC1090
    eval "$HYDRATE_OUT"
    echo "[natasha] hydrated $(printf '%s\n' "$HYDRATE_OUT" | grep -c '^export ') secrets from DB" >&2
fi
unset HYDRATE_OUT

# 3) Hand the process over to Next.js so systemd tracks it directly.
exec node node_modules/next/dist/bin/next start -p "${PORT:-3000}"
