#!/usr/bin/env bash
# Daily vulnerability scan + report refresh.
#
#   rescan every in-scope repo  ->  export what that run saw  ->  HTML + PDF  ->  publish
#
# Called by the daily cron at 03:30 host time. The host clock is IST, so that is
# 03:30 IST (22:00 UTC the day before), not "03:30 UTC / 09:00 IST" as the
# crontab comment says. Dates in file names and in the report are therefore the
# local (IST) date. Safe to run by hand.
#
# Before this existed the scan was a manual one-off: the only two batches in
# scan_job were 2026-06-24 and 2026-10-26, and the published report sat 24 days
# stale. Nothing re-fired it. That is what this script fixes.
#
# What it guarantees:
#   - Scope is the Google-Sheet allowlist. If the sheet cannot be read the run
#     stops (rescan-all.ts --require-allowlist) instead of scanning every repo.
#   - The report holds only findings seen by this run (export --since <run start>).
#   - The web report carries CVEs + potential secrets; the PDF carries CVEs only.
#   - Both state their coverage: attempted / scanned / failed / skipped, and list
#     the repositories that were not scanned.
#   - Nothing is published when more than MAX_FAILED_PCT of in-scope repos failed.
#   - Files reach public/ by rename, so a reader never gets a half-written file.
#
# Flags:
#   --no-scan     regenerate the report from the last scan run (uses the existing
#                 logs/rescan-all-state.json for scope, coverage and cutoff)
#   --concurrency N   scanner concurrency (default 4; Trivy is the RAM hog)
#
# Exit codes: 0 published · 3 allowlist unavailable · 4 too many failures, not
# published · anything else: a step failed (see logs/vuln-refresh.log).
set -Eeuo pipefail

REPO_ROOT="/home/naveen5/Documents/projects/Infra"
AGENT_ROOT="/home/naveen5/agents/natasha"
MAX_FAILED_PCT=10
cd "$REPO_ROOT"

CONCURRENCY=4
RUN_SCAN=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-scan) RUN_SCAN=0; shift ;;
    --concurrency) CONCURRENCY="${2:?}"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 64 ;;
  esac
done

LOG_DIR="$REPO_ROOT/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/vuln-refresh.log"
STATE_FILE="$LOG_DIR/rescan-all-state.json"
stamp() { date -u +'%FT%TZ'; }

# ── credentials ───────────────────────────────────────────────────────────────
set -a
if [[ -f "$REPO_ROOT/.env" ]]; then
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
fi
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  DB="${MYSQL_DATABASE:-billing}"
  HOST="${MYSQL_HOST:-127.0.0.1}"
  PORT="${MYSQL_PORT:-3306}"
  PW_ENC=$(python3 -c "import urllib.parse,os; print(urllib.parse.quote_plus(os.environ.get('MYSQL_PASSWORD','')))")
  export DATABASE_URL="mysql://${MYSQL_USER}:${PW_ENC}@${HOST}:${PORT}/${DB}"
fi

# The Google-Sheet allowlist credentials live encrypted in the secret_store
# table, same as the dashboard's. (The GitHub clone token is separate: the
# scanner reads it from the github_connection table.) A failure here is fatal:
# without these the allowlist cannot be read and the scope would be wrong.
if ! HYDRATE_OUT="$(node "$REPO_ROOT/scripts/hydrate-secrets-cli.mjs" 2>>"$LOG_FILE")"; then
  echo "[$(stamp)] could not load secrets from the database — stopping (details above)" | tee -a "$LOG_FILE" >&2
  exit 1
fi
[[ -n "$HYDRATE_OUT" ]] && eval "$HYDRATE_OUT"
unset HYDRATE_OUT

# Bulk runs hit big repos: the interactive single-repo defaults truncate
# findings on the Mule monoliths, which is why 19 repos failed to clone on
# 2026-10-26. Give clone and each scanner real headroom.
export NATASHA_CLONE_TIMEOUT_MS="${NATASHA_CLONE_TIMEOUT_MS:-600000}"
export NATASHA_SCAN_TIMEOUT_MS="${NATASHA_SCAN_TIMEOUT_MS:-420000}"

# Local date: the host runs on IST, and a UTC date would label a 03:30 IST run
# with the previous day and overwrite that day's archive folder.
TODAY=$(date +%F)
OUT_DIR="$AGENT_ROOT/reports/vuln/$TODAY"
mkdir -p "$OUT_DIR"

NDJSON="$OUT_DIR/findings-cve-secret.ndjson"
NDJSON_CVE="$OUT_DIR/findings-cve-only.ndjson"
META_FILE="$OUT_DIR/scan-coverage.json"
WEB_HTML="$OUT_DIR/rw-vulnerability-report-$TODAY.html"
PDF="$OUT_DIR/RW-Vulnerability-Report-$TODAY.pdf"
PRINT_HTML="$OUT_DIR/RW-Vulnerability-Report-$TODAY.print.html"

PUBLIC_DIR="$REPO_ROOT/public"
# Temp names keep the "vulnerability-report" prefix so they stay behind the
# sign-in check in middleware.ts for the moment they exist.
TMP_TAG="tmp-$$"
cleanup() { rm -f "$PUBLIC_DIR"/vulnerability-report*."$TMP_TAG"; }
trap cleanup EXIT
trap 'echo "[$(stamp)] vuln refresh FAILED at line $LINENO (exit $?) — nothing further was published" >> "$LOG_FILE"' ERR

# Copy next to the destination, then rename over it: readers see the old file
# or the new one, never a partial write.
publish() {
  local src="$1" dest="$2"
  cp "$src" "$dest.$TMP_TAG"
  mv -f "$dest.$TMP_TAG" "$dest"
}

# Only one refresh at a time — a second rescan would fight the first for RAM
# and both would write the same rows.
exec 9>"$LOG_DIR/.vuln-refresh.lock"
if ! flock -n 9; then
  echo "[$(stamp)] another vuln refresh is already running — exiting" >> "$LOG_FILE"
  exit 0
fi

{
  echo "──────── $(stamp) · vuln refresh starting (scan=$RUN_SCAN concurrency=$CONCURRENCY date=$TODAY) ────────"

  if [[ "$RUN_SCAN" == "1" ]]; then
    echo "── rescanning all in-scope repos"
    npx tsx scripts/rescan-all.ts --concurrency "$CONCURRENCY" --require-allowlist
  else
    echo "── --no-scan: reusing the last scan run"
  fi

  # Coverage for the report and the publish gate, from the scan's own state file.
  # Prints the run's start time (the export cutoff) on success.
  echo "── reading scan coverage"
  SINCE=$(python3 - "$STATE_FILE" "$META_FILE" "$TODAY" "$MAX_FAILED_PCT" <<'PY'
import json, re, sys

state_path, meta_path, today, max_failed_pct = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
try:
    with open(state_path) as fh:
        st = json.load(fh)
except (OSError, ValueError) as e:
    sys.exit(f"cannot read scan state {state_path}: {e}")

results = st.get("results") or []
total = int(st.get("total") or 0)
finished = st.get("finished", st.get("done") == total)
if not finished or total == 0 or len(results) != total:
    sys.exit(f"scan state is not a completed run (finished={finished} total={total} results={len(results)})")
if not st.get("startedAt"):
    sys.exit("scan state has no startedAt")

allow = st.get("allowlist") or {}
if "allowlist" in st and not allow.get("used"):
    sys.exit("the last scan run did not use the in-scope list; run without --no-scan")

def reason(r):
    """Plain-English reason; the raw git output holds temp paths and is kept in the log only."""
    e = r.get("error") or ""
    if r.get("status") == "skipped":
        return "Empty repository, nothing to scan"
    if "Repository not found" in e:
        return "Repository not found on GitHub"
    m = re.search(r"Remote branch (\S+) not found", e)
    if m:
        return f"Branch {m.group(1)} does not exist"
    m = re.search(r"(?:HTTP|error:) (5\d\d)", e)
    if m:
        return f"GitHub returned a server error (HTTP {m.group(1)})"
    if re.search(r"timed? ?out|early EOF|hung up|RPC failed", e, re.I) or (e.startswith("clone failed") and "fatal" not in e and "error" not in e):
        return "Download from GitHub timed out"
    if e.startswith("clone failed"):
        return "Could not download the repository"
    return "Scan failed"

ok = [r for r in results if r.get("status") == "success"]
skipped = [r for r in results if r.get("status") == "skipped"]
failed = [r for r in results if r.get("status") not in ("success", "skipped")]
failed_pct = 100.0 * len(failed) / total

meta = {
    "date": today,
    "runStartedAt": st["startedAt"],
    "targets": total,
    "scanned": len(ok),
    "failed": len(failed),
    "skipped": len(skipped),
    "failedPct": round(failed_pct, 1),
    "notScanned": [
        {"repo": r["repo"], "branch": r.get("branch") or "", "status": "skipped" if r in skipped else "failed", "reason": reason(r)}
        for r in failed + skipped
    ],
    # On the in-scope list but not scanned: no longer listed by GitHub under that name, or archived.
    "notOnGithub": (allow.get("notInDb") or []) + (allow.get("archivedInDb") or []),
    "allowlistEntries": allow.get("entries"),
}
with open(meta_path, "w") as fh:
    json.dump(meta, fh, indent=2)

print(f"coverage: attempted={total} scanned={len(ok)} failed={len(failed)} skipped={len(skipped)} "
      f"failed_pct={failed_pct:.1f} limit={max_failed_pct:g}", file=sys.stderr)
if failed_pct > max_failed_pct:
    print(f"REFUSING TO PUBLISH: {len(failed)} of {total} in-scope repositories failed "
          f"({failed_pct:.1f}%, limit {max_failed_pct:g}%). The published report is left as it was.", file=sys.stderr)
    sys.exit(4)
print(st["startedAt"])
PY
  )
  VULN_REPORT_META="$(cat "$META_FILE")"
  export VULN_REPORT_META

  echo "── exporting findings seen since $SINCE"
  node scripts/export-vuln-findings.mjs "$NDJSON" --since "$SINCE"
  node scripts/export-vuln-findings.mjs "$NDJSON_CVE" --cats CVE --since "$SINCE"

  echo "── building web HTML (CVEs + potential secrets)"
  node "$AGENT_ROOT/scripts/gen-vuln-report.mjs" "$NDJSON" "$WEB_HTML"

  echo "── building print HTML + PDF (CVEs only)"
  node scripts/gen-vuln-pdf.mjs "$NDJSON_CVE" "$PDF" "$PRINT_HTML"

  # Status file so the dashboard (and the next person who asks "is this fresh?")
  # can see the answer without reading logs. Built before anything is published
  # so a failure here leaves the old report and the old status in place together.
  echo "── writing status"
  STATUS_TMP="$OUT_DIR/vulnerability-report-status.json"
  python3 - "$NDJSON" "$TODAY" "$META_FILE" <<'PY' > "$STATUS_TMP"
import json, sys, collections, datetime
ndjson, today, meta_path = sys.argv[1], sys.argv[2], sys.argv[3]
with open(meta_path) as fh:
    meta = json.load(fh)
sev = collections.Counter(); cat = collections.Counter(); repos = set()
n = 0
with open(ndjson) as fh:
    for line in fh:
        if not line.strip():
            continue
        r = json.loads(line); n += 1
        sev[r["sev"]] += 1; cat[r["cat"]] += 1; repos.add(r["repo"])
print(json.dumps({
    "date": today,
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "findings": n,
    # Repositories with at least one CVE or potential-secret finding; not the number scanned.
    "repos": len(repos),
    "bySeverity": dict(sev),
    "byCategory": dict(cat),
    "coverage": {
        "runStartedAt": meta["runStartedAt"],
        "attempted": meta["targets"],
        "scanned": meta["scanned"],
        "failed": meta["failed"],
        "skipped": meta["skipped"],
        "withFindings": len(repos),
        "clean": max(meta["scanned"] - len(repos), 0),
        "notScanned": meta["notScanned"],
        "notOnGithub": meta["notOnGithub"],
    },
    "html": "/vulnerability-report.html",
    "pdf": "/vulnerability-report.pdf",
    "printHtml": "/vulnerability-report-print.html",
}, indent=2))
PY

  echo "── publishing to public/"
  publish "$WEB_HTML"   "$PUBLIC_DIR/vulnerability-report.html"
  publish "$PDF"        "$PUBLIC_DIR/vulnerability-report.pdf"
  publish "$PRINT_HTML" "$PUBLIC_DIR/vulnerability-report-print.html"
  publish "$STATUS_TMP" "$PUBLIC_DIR/vulnerability-report-status.json"

  echo "──────── $(stamp) · vuln refresh done ────────"
} >> "$LOG_FILE" 2>&1

echo "vuln refresh complete — $OUT_DIR"
