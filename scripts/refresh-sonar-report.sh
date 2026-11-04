#!/usr/bin/env bash
# Regenerate the Sonar HTML + PDF report bundle for today.
# Called by the daily cron (08:00 IST) AND by /api/sonar/refresh.
set -Eeuo pipefail

REPO_ROOT="/home/naveen5/Documents/projects/Infra"
cd "$REPO_ROOT"

# Load bootstrap credentials from .env (mode 600, gitignored).
set -a
if [[ -f "$REPO_ROOT/.env" ]]; then
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
elif [[ -f /tmp/srv.env ]]; then
  # shellcheck disable=SC1091
  source /tmp/srv.env
fi
set +a

# Prisma needs DATABASE_URL. Build it from MYSQL_* if the caller didn't set it.
if [[ -z "${DATABASE_URL:-}" ]]; then
  DB="${MYSQL_DATABASE:-billing}"
  HOST="${MYSQL_HOST:-127.0.0.1}"
  PORT="${MYSQL_PORT:-3306}"
  PW_ENC=$(python3 -c "import urllib.parse,os; print(urllib.parse.quote_plus(os.environ.get('MYSQL_PASSWORD','')))")
  export DATABASE_URL="mysql://${MYSQL_USER}:${PW_ENC}@${HOST}:${PORT}/${DB}"
fi

# Decrypt every app secret from the DB into this shell's env.
if [[ -f "$REPO_ROOT/scripts/hydrate-secrets-cli.mjs" ]]; then
  eval "$(node "$REPO_ROOT/scripts/hydrate-secrets-cli.mjs")" || echo "warn: DB secret hydration failed"
fi

if [[ -z "${SONAR_TOKEN:-}" ]]; then
  echo "SONAR_TOKEN missing — set in secret_store (via /settings) or .env" >&2
  exit 1
fi

# Prisma needs DATABASE_URL. Build it from MYSQL_* if the caller didn't set it.
if [[ -z "${DATABASE_URL:-}" ]]; then
  DB="${MYSQL_DATABASE:-billing}"
  HOST="${MYSQL_HOST:-127.0.0.1}"
  PORT="${MYSQL_PORT:-3306}"
  PW_ENC=$(python3 -c "import urllib.parse,os; print(urllib.parse.quote_plus(os.environ.get('MYSQL_PASSWORD','')))")
  export DATABASE_URL="mysql://${MYSQL_USER}:${PW_ENC}@${HOST}:${PORT}/${DB}"
fi

LOG_DIR="$REPO_ROOT/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/sonar-refresh.log"

TODAY=$(date -u +%F)
STARTED_AT=$(date -u +'%Y-%m-%dT%H:%M:%SZ')

{
  echo "──────── $STARTED_AT · refresh starting ────────"
  node scripts/gen-sonar-report.mjs
  node scripts/gen-sonar-pdf.mjs
  # Persist today's per-repo numbers into the sonar_scan_snapshot table so
  # /sonar can show day-over-day trend arrows.
  node scripts/persist-sonar-snapshot.mjs || echo "persist-sonar-snapshot failed (non-fatal)"

  # Also refresh the /tmp/sonar-report-share bundle so the trycloudflare tunnel serves fresh content.
  SRC="$REPO_ROOT/public/sonar-reports/$TODAY"
  DEST="/tmp/sonar-report-share"
  if [[ -d "$SRC" && -d "$DEST" ]]; then
    find "$DEST" -maxdepth 1 -name '*.html' -delete
    cp "$SRC/branch-production.html" "$DEST/index.html"
    cp "$SRC/index.html" "$DEST/all-branches.html"
    cp "$SRC"/repo-*.html "$DEST/"    2>/dev/null || true
    cp "$SRC"/branch-*.html "$DEST/"  2>/dev/null || true
    [[ -f "$SRC/production-report.pdf" ]] && cp "$SRC/production-report.pdf" "$DEST/report.pdf"
    echo "shared bundle refreshed → $DEST"
  fi

  FINISHED_AT=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
  echo "──────── $FINISHED_AT · refresh done ────────"
} >> "$LOG_FILE" 2>&1

# Emit a small JSON status file the /api/sonar/latest route can read.
STATUS_FILE="$REPO_ROOT/public/sonar-reports/latest-status.json"
cat > "$STATUS_FILE" <<JSON
{
  "date": "$TODAY",
  "generatedAt": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "indexHtml": "/sonar-reports/$TODAY/index.html",
  "productionHtml": "/sonar-reports/$TODAY/branch-production.html",
  "productionPdf": "/sonar-reports/$TODAY/production-report.pdf"
}
JSON
