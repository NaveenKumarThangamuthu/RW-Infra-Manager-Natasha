---
model: fable  # The owner asked for Fable agents for this work.
---

# Execution Plan: Dashboard audit fixes before the stakeholder presentation

## Problem Statement
The owner presents the whole Natasha dashboard to stakeholders on the evening of 19 Nov 2026 and asked for a
full analysis, a list of all issues, fixes, an explanation of the failed repo scans, and a more professional
look. Four read-only audits against real production data produced about 90 findings. This plan fixes every
P0 and P1 finding that is a code change, plus the cheap P2 items, in four parallel workstreams with disjoint
files.

## Skill
- Name: none (Next.js/TypeScript dashboard; the Java/Vue skills do not apply)
- SKILL.md path: n/a. Follow `CLAUDE.md` in the repo root.

## Findings (source of truth for every step)
Each workstream's numbered items, with what the viewer sees, root cause, file:line and proposed fix:
- `/tmp/claude-1000/-home-naveen5-Documents-projects-Infra/13f7c25a-d3ae-4025-9a39-7d8e016fc3a2/scratchpad/audit/findings/scan-pipeline.md`
- `.../audit/findings/overview-cost.md`
- `.../audit/findings/compute.md`
- `.../audit/findings/security-workspace.md`

Item numbers below refer to those files. Line numbers there may be off by a few; locate by content.

## Scope
- All code changes are made in the worktree `/home/naveen5/Documents/projects/Infra/.claude/worktrees/slow-queries`
  (branch `main-2026-11-12`, at `main`). The main checkout is the live server and is not edited.
- Exception: workstream A also edits the report generators under `~/agents/natasha/` (outside the repo) and
  works on copies of two untracked scripts (see A).
- Already done by the main session before this plan: the 97 repos that return 404 from GitHub were removed
  from `repo`, `scan_job` and `finding` (backup in `logs/removed-repos-2026-11-19.json`).

## Shared pre-work (main session, before the workstreams start)
`components/natasha/format.ts` gets these helpers so no workstream edits that file:
- `dayLabel(d)`: accepts `YYYY-MM-DD` or a full ISO string, returns e.g. "18 Nov".
- `isStale(iso, maxMinutes?)`: optional threshold, default unchanged (36 h).
- `istDateTime(iso)` / `istTime(iso)`: en-GB, Asia/Kolkata, "19 Nov 2026, 11:26 IST" / "11:26:16".
- `bytes()` prints KB / MB / GB.
- `compactCount(n)` for very large counts ("3.56 trillion").

## Execution Steps

### Workstream A: scan pipeline, scope and the vulnerability report
Files: `lib/sheetAllowlist.ts`, `scripts/rescan-all.ts`, `lib/github.ts`, `app/api/cron/refresh-all/route.ts`
(repo sync part only), `app/api/security/repos/sync/route.ts`, `scripts/refresh-vuln-report.sh`,
`scripts/export-vuln-findings.mjs` (copy both untracked scripts from the main checkout into the worktree first
and edit the copies), and the generators `gen-vuln-report.mjs` / `gen-vuln-pdf.mjs` under `~/agents/natasha/`
(back each up next to itself as `*.bak-2026-11-19` before editing).
1. Allowlist (scan 1): read the sheet's first tab (`gid=0`) and extract GitHub URLs with a whole-CSV regex
   that allows dots in repo names; keep the "Summary" tab as a fallback. Surface `allowlist.error` in the
   rescan log.
2. `rescan-all.ts`: when run for a published report (new `--require-allowlist` flag, passed by
   `refresh-vuln-report.sh`), abort instead of falling back to all repos. Retry clone failures that are
   transient (HTTP 5xx, timeouts) twice with backoff. Record empty repos as `skipped`, not failed.
3. `lib/github.ts` `resolveScanBranch`: do not accept a redirected branch; fall back to the default branch.
4. Repo sync (both routes): after a successful full listing of an owner, mark rows of that owner that were
   not returned as `archived: true` (never delete in the sync). Skip this when the listing errored or
   returned zero repos.
5. `export-vuln-findings.mjs`: add `--since <ISO>` (fed from `startedAt` in `logs/rescan-all-state.json`),
   `--cats`, and `timezone: "Z"` on the connection.
6. `refresh-vuln-report.sh`: CVE-only input for the PDF (scan 2); build `VULN_REPORT_META` from the state
   file with attempted / scanned / failed / skipped and the list of repos not scanned (scan 3, 5); add those
   counts to the status JSON (scan 4); use the local date for `TODAY` and fix the cron comments (scan 7);
   publish via temp file then `mv`, and refuse to publish when more than 10% of in-scope repos failed
   (scan 8); stop swallowing hydrate errors (scan 9).
7. Generators (security-workspace 6, 7, 8): scope sentence "Scanned X of Y in-scope repositories on
   19 Nov 2026; N have findings; M could not be scanned"; thousands separators everywhere; one date style;
   stack label from repo language with "Frontend / Other" instead of labelling everything Spring; secrets
   labelled "potential secrets flagged by pattern matching".
8. Do NOT run a scan or publish. Return the exact command for the main session to run after release.

### Workstream B: Home, Alerts, Billing, Categories, Data Transfer, Regions, shell
Files: `components/screens/dashboard/*`, `components/screens/{Alerts,Billing,Categories,DataTransfer,Regions}.tsx`,
`components/shell/*`, `app/api/dashboard/summary/route.ts`, `app/api/cost/{summary,anomalies,daily-by-category}/route.ts`,
`app/api/cost/by-tag/[category]/route.ts`, `app/api/incidents/route.ts`.
Implement overview-cost items 1–15, 16 (code part only), 18–24, 26–30, and security-workspace items 1 (Home
part: count only findings seen in the last 2 days) and 27. Decisions already taken:
- Forecast (3): run-rate from the last 7 complete days; label "Run-rate forecast".
- Month comparison (4): pro-rate the previous month to the same day; label "vs same point in Oct".
- Alerts (8, 9): 25 rows with "Show more"; GitHub findings grouped per repo and rule; true totals from a
  `groupBy`, with "showing n of N".
- Alerts log lines (10): pass through the redactor in `lib/slowQueryParse.ts`.
- Item 17 (January spike caption) is skipped: the cause is unknown.

### Workstream C: Servers, Spring, Lambda, Databases, Elasticsearch, Slow queries, SNS, OpenAS2
Files: `components/screens/{Servers,Lambda,Databases,DatabaseDetail,Sns,OpenAs2}.tsx`,
`components/screens/spring/*`, `components/screens/elasticsearch/*`, `components/screens/slowqueries/*`,
`components/Ec2InstanceDetail.tsx`, `components/natasha/charts.tsx`, `app/api/cost/allocation/route.ts`,
`app/api/perf/spring/logs/details/route.ts`, `app/api/loki/query/route.ts`, `app/api/perf/lambda/logs/route.ts`,
`lib/rdsPerformance.ts`, `lib/rdsQueryInsights.ts`, `lib/esMonitorIssues.ts`.
Implement compute items 1 (code part: honest "last successful refresh" labels), 2–7, 8 (redact Spring,
OpenAS2/Loki and Lambda log text with the `lib/slowQueryParse.ts` redactor), 9–27, 29, 30 and overview-cost
item 25 (chart tick overlap). Item 28 (shared polish) only where it is a one-line change.
- Item 7: remove the fake model chips and the always-zero columns from the EC2 metrics panel.
- Item 5: remove the substring match; unmatched services show "—".

### Workstream D: Repositories, Sonar, Certificates, Security Groups, Reports, Cron, Integrations, Settings
Files: `app/security/page.tsx`, `app/security/[owner]/[name]/page.tsx`, `app/api/security/{findings,scans,repos}/route.ts`,
`app/api/issues/summary/route.ts`, `components/screens/{Sonar,Certificates,SecurityGroups,Settings,CronJobs,Integrations}.tsx`,
`components/screens/reports/*`, `lib/reports.ts`, `lib/awsSecurityGroups.ts`.
Implement security-workspace items 1 (detail/badge/pill part), 2–5, 9–24, 26. Decisions:
- Repositories (2, 3, 17, 18, 19): rebuild the page on `Screen` / `PageHeader` / `Button` / `Badge`; KPIs
  Repositories / Scanned / Failed / With critical or high; status chips; failed first; 25 rows per page;
  theme tokens instead of hardcoded colours; "Disconnect GitHub" moves to Integrations.
- Scope (4): no owner filter in code; workstream A restores the allowlist. Only reword the chip.
- Settings (13): hide the budget block unless `TAG_BUDGETS_JSON` is set.
- Item 25 (light stylesheet for the report) is skipped.

### After the workstreams (main session)
1. `npx tsc --noEmit` and `npm run build` in the worktree.
2. Real-data sweep of all 24 pages (dark, real light, 390 px) and re-check each P0 by its quoted text.
3. Report to the owner; release only on their go-ahead: commit, merge, build, restart, push.
4. After release, with the owner's go-ahead: run the scan for the in-scope repos and republish the report;
   run the billing backfill for the missing September 2026 row (overview-cost 16).

## Expected Outcomes
- No "undefined", "NaN" or raw "null" on any page; no page taller than about 5,000 px at desktop width.
- Home, Alerts, Repositories and the report agree on finding counts and recommendations.
- Stale data (Lambda, Spring, Sonar) is labelled with its real date.
- The vulnerability report covers the in-scope repos, states its coverage and separates CVEs from secrets.
- Repositories matches the redesigned pages and works in light theme and at phone width.

## Risks & Constraints
- Headline numbers change: Home findings drop by about 3,300 (stale findings excluded), the forecast drops
  from $7,543 to roughly $4,400–4,500, Spring "Erroring" drops, EC2 totals change.
- No file over 500 lines: `app/security/page.tsx` must be split when rebuilt.
- AWS stays read-only. No schema changes. No secrets printed or written.
- Workstreams must not edit files outside their list; anything else is returned as an open question.
- Not fixable in code, owner action needed: the IAM deny `DenyLambdaConfigRead` (Lambda data stuck at
  4 Nov); the Sonar token (nightly refresh fails with 401 since 2 Nov); the two leftover SEO keys in the
  secret store; which `production-main-*` branch to scan for `RW-Shopify-Theme-StockMart`.

## Verification
- `npx tsc --noEmit`, `npm run build` (worktree).
- `node shoot-live.cjs all dark 1440` from the scratchpad `audit/` folder: zero suspicious tokens, zero
  console errors, zero failed API calls.
- Spot checks: Home recommendations equal Alerts; Home CRIT equals the Repositories total; EC2 totals add up;
  a Spring service with no exact ELK match shows "—".
