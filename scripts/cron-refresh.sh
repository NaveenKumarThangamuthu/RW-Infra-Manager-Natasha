#!/usr/bin/env bash
# Natasha refresh — invoked by the host crontab twice daily
# (00:30 UTC / 12:30 UTC ≈ 6:00 / 18:00 IST).
#
# Two independent calls, chained so a failure in one doesn't skip the other:
#   1) /api/cron/refresh-all — ops snapshots (spring-health/logs, ec2-health,
#      lambda-ohio, cloudwatch-alarms, prom-alerts, recommendations) + GitHub
#      repo sync + AI daily brief.
#   2) /api/refresh — billing snapshot: monthly_cost, resource_cost_snapshot,
#      tag_cost_snapshot, resource_daily_cost (EC2 + Lambda + SNS),
#      ec2_itemized_snapshot. This is what fuels the "current month" view.
#
# Sources CRON_SECRET from the project's .env (persistent), else legacy /tmp/srv.env or ~/.natasha.env.

LOG="/home/naveen5/Documents/projects/Infra/logs/cron-refresh.log"
LABEL="${1:-cron}"
INFRA_ROOT="/home/naveen5/Documents/projects/Infra"

if [[ -f "$INFRA_ROOT/.env" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$INFRA_ROOT/.env"; set +a
elif [[ -f /tmp/srv.env ]]; then
  # shellcheck disable=SC1091
  set -a; source /tmp/srv.env; set +a
elif [[ -f "$HOME/.natasha.env" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$HOME/.natasha.env"; set +a
fi

# Decrypt secrets from the DB (CRON_SECRET, GITHUB_*, etc. live there now).
if [[ -f "$INFRA_ROOT/scripts/hydrate-secrets-cli.mjs" ]]; then
  HYDRATE_OUT="$(node "$INFRA_ROOT/scripts/hydrate-secrets-cli.mjs" 2>/dev/null || true)"
  if [[ -n "$HYDRATE_OUT" ]]; then
    # shellcheck disable=SC1090
    eval "$HYDRATE_OUT"
  fi
  unset HYDRATE_OUT
fi

if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "[$(date -Is)] FAIL no CRON_SECRET in env" >> "$LOG"
  exit 1
fi

parse_ok() {
  python3 -c 'import json,sys; d=json.load(sys.stdin); print("ok" if d.get("ok") else "fail")' 2>/dev/null || echo "parse-err"
}

# 1) Ops snapshots + GitHub sync + AI brief
START=$(date +%s)
RESP=$(curl -s -m 290 -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/refresh-all?label=$LABEL" 2>&1)
END=$(date +%s)
DUR=$((END - START))
OK=$(echo "$RESP" | parse_ok)
echo "[$(date -Is)] $LABEL ops status=$OK took=${DUR}s body=${RESP:0:400}" >> "$LOG"

# 2) Billing snapshot (monthly_cost, itemized, per-day)
START=$(date +%s)
BILL_RESP=$(curl -s -m 290 -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/refresh?label=$LABEL" 2>&1)
END=$(date +%s)
DUR=$((END - START))
BILL_OK=$(echo "$BILL_RESP" | parse_ok)
echo "[$(date -Is)] $LABEL billing status=$BILL_OK took=${DUR}s body=${BILL_RESP:0:400}" >> "$LOG"

# 3) AS2 certificate scan (Drive walker + OpenSSL parse + Telegram alert on ≤30d)
START=$(date +%s)
CERT_RESP=$(curl -s -m 290 -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/certificates/refresh?label=$LABEL" 2>&1)
END=$(date +%s)
DUR=$((END - START))
CERT_OK=$(echo "$CERT_RESP" | parse_ok)
echo "[$(date -Is)] $LABEL certs status=$CERT_OK took=${DUR}s body=${CERT_RESP:0:400}" >> "$LOG"
