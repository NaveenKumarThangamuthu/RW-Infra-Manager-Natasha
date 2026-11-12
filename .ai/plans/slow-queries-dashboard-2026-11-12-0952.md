---
model: opus  # Complex tier: new page, two data sources, new API routes.
---

# Execution Plan: Slow Queries dashboard — database slow queries + database trouble from service logs

## Problem Statement

The user asked for a dashboard of slow queries with detailed analysis, built on the read-only Elasticsearch access.
Investigation showed Elasticsearch holds **no slow-query log**: its only data stream is the Spring service application
logs (`logs-tcp-default`, about 8–11 million lines a day, 11 hosts, about 40 services). The user then chose
**"Both, one page"**:

1. **Database slow queries** — real statement statistics per RDS MySQL instance from the existing read-only
   `performance_schema` analysis (`lib/rdsQueryInsights.ts`).
2. **Database trouble in service logs** — failed SQL statements, deadlocks, lock-wait timeouts, MongoDB connection
   failures, read timeouts and slowest timed operations, extracted from Elasticsearch.

Each half gets KPIs, a trend, a per-service breakdown, top offenders, sample lines and rule-based (no AI)
"likely cause / what to do" notes.

## Skill

- Name: none (custom feature). No SKILL.md in the Zyra router covers a Next.js/React dashboard page; the frontend
  skills target Vue 3. Follow the repo's `CLAUDE.md` and the conventions of the redesigned screens instead.
- SKILL.md path: n/a. Reference files: `/home/naveen5/Documents/projects/Infra/CLAUDE.md`,
  `/home/naveen5/Documents/projects/Infra/components/screens/Alerts.tsx`,
  `/home/naveen5/Documents/projects/Infra/components/screens/spring/SpringServices.tsx`.

## Scope

Root: `/home/naveen5/Documents/projects/Infra` (all paths below are relative to it; it is also the live checkout).

- Files to read:
  - `lib/elk.ts`, `lib/cache.ts`, `lib/rdsQueryInsights.ts`, `lib/rds.ts`, `lib/snapshotFetchers.ts` (the `withRetry` helper)
  - `app/api/rds/route.ts`, `app/api/rds/[id]/queries/route.ts`, `app/api/perf/spring/logs/details/route.ts`
  - `components/shell/nav.ts`, `components/natasha/{primitives.tsx,charts.tsx,format.ts}`, `components/ui/*`
  - `components/screens/{Alerts.tsx,DatabaseDetail.tsx}`, `components/screens/spring/SpringServices.tsx`
- Files to create:
  - `lib/slowQueryLogs.ts` — ES queries, orchestration, response types (≤ 300 lines)
  - `lib/slowQueryParse.ts` — regexes, redaction, grouping, rule-based notes; pure functions (≤ 250 lines)
  - `app/api/slow-queries/logs/route.ts` — `GET ?range=1h|6h|24h[&refresh=1]`
  - `app/api/slow-queries/samples/route.ts` — `GET ?kind=…&range=…[&service=…]`
  - `app/slow-queries/page.tsx` — renders the screen
  - `components/screens/slowqueries/SlowQueries.tsx` — page shell, range control, KPIs, tabs (≤ 250 lines)
  - `components/screens/slowqueries/LogTrouble.tsx` — trend, by-kind/by-service tables, failed statements, notes
  - `components/screens/slowqueries/SlowOps.tsx` — timed operations table (p50/p95/max)
  - `components/screens/slowqueries/DbQueries.tsx` — per-instance slow statements and issues, unavailable state
  - `components/screens/slowqueries/SampleSheet.tsx` — side sheet with sample log lines
  - `components/screens/slowqueries/types.ts` — response types shared by the components
- Files to modify:
  - `components/shell/nav.ts` — add the nav item (the command palette reads `NAV`, so it picks this up)
  - `lib/elk.ts` — add an optional third argument `opts?: { timeoutMs?: number }` to `esSearch` (default unchanged)
  - `lib/snapshotFetchers.ts` — export `withRetry` (move it to `lib/elk.ts` and import it back, no behaviour change)
  - `lib/rdsQueryInsights.ts` — optional `orderBy` parameter (see step 5)
  - `app/api/rds/[id]/queries/route.ts` — pass through a whitelisted `?sort=`
  - `CLAUDE.md` — one line under Conventions describing the page and its two sources
- Modules affected: navigation, Elasticsearch client, RDS query insights. No Prisma schema change, no new dependency.
- Test harness (scratchpad, not in the repo):
  `/tmp/claude-1000/-home-naveen5-Documents-projects-Infra/13f7c25a-d3ae-4025-9a39-7d8e016fc3a2/scratchpad/{mocks.cjs,shoot.cjs,interact.cjs}`

## Analysis

### What exists today

- **Database half.** `getRdsQueryInsights(region, instanceId)` connects with a read-only MySQL login, reads the top 15
  digests from `performance_schema.events_statements_summary_by_digest` ordered by rows examined, and derives issues
  (scan ratio, no index used, average latency > 1 s). It returns a structured `available: false` with `reason` and
  `remedy` when it cannot run. `DatabaseDetail.tsx` already shows this for one instance.
- **Credentials: none configured.** The secret store holds 15 keys (`CRON_SECRET`, `ELK_*`, `GDRIVE_REFRESH_TOKEN`,
  `GITHUB_*`, `GOOGLE_*`, `GTMETRIX_API_KEY`, `PROMETHEUS_URL`, `SONAR_*`). There is no `RDS_QUERY_USER` /
  `RDS_QUERY_PASSWORD` and no `RDS_<ID>_USER` / `_PASSWORD`, in the store or in the process environment. `RDS_*` is also
  not in `MANAGED_KEYS` in `lib/secrets.ts`; step 5 checks whether `hydrateFromDb` loads unlisted keys and adds the two
  shared names if it does not. **So on day one the database half shows the "unavailable" state with the remedy text**,
  until the user adds a read-only login. The mock inventory has one MySQL instance (`rw-prod-rds-09112022`, us-east-2).
- **Elasticsearch half.** `esSearch(index, body)` tries the LAN URL with a 4 s timeout, then the public URL (15 s,
  unreachable from this host). User `RW-DEV` has roles `reporting_user, viewer`: `_search` works, cluster and index
  monitoring APIs return 403. Usable fields: `@timestamp`, `message` (text), `dissect.service`, `host.name`.
  There are no numeric duration fields, so durations can only be parsed from message text in Node.
- **ES is fragile.** The node hits its ~1.4 GB heap limit (circuit-breaker 400s, 429s). Queries must stay small.

### Measured queries (live cluster, 2026-11-12 around 09:50 IST, read-only)

One combined `filters` aggregation over 10 phrases: 1 h 2.0 s, 6 h 1.9 s, **24 h 12.1 s and `timed_out: true`**.
Rejected. Per-kind queries run one after another are far cheaper:

| Kind | Query clause on `message` | 6 h hits / time | 24 h hits / time |
|---|---|---|---|
| `sqlFailed` | `match_phrase "PreparedStatementCallback"` | 483 / 44 ms | 1,046 / 218 ms |
| `deadlock` | `match_phrase "Deadlock found"` | 1 / 22 ms | 13 / 162 ms |
| `lockWait` | `match_phrase "Lock wait timeout"` | 7 / 26 ms | 28 / 52 ms |
| `readTimeout` | `match_phrase "Read timed out"` | 694 / 618 ms | 2,566 / 4,435 ms |
| `mongoNoServer` | `match "ReadPreferenceServerSelector"` | 5,175 / 157 ms | 12,883 / 35 ms |
| `connPool` | `match_phrase "Connection is not available"` | 0 / 20 ms | 0 / 36 ms |
| `linkFailure` | `match_phrase "Communications link failure"` | 0 / 24 ms | 0 / 18 ms |
| `tooMany` | `match_phrase "Too many connections"` | 0 / 21 ms | 0 / 26 ms |

Each per-kind query body: `size: 0`, `timeout: "8s"`, `track_total_hits: true`, a `range` filter on `@timestamp`,
the clause above, and two aggregations: `date_histogram` (`fixed_interval` 5m / 30m / 1h for 1h / 6h / 24h,
`min_doc_count: 0`) and `terms` on `dissect.service` (size 12). Total for all kinds at 24 h: about 5 s.
`match_phrase "No server chosen"` took 8.0 s at 24 h, so the single-token form above is used instead.
"Read timed out" lines are Feign HTTP calls between services, not database calls; label them
"Service call timeouts" and say so in the UI.

Samples and timing lines:

| Purpose | Query | Size | Measured |
|---|---|---|---|
| Failed-statement grouping | `match_phrase "PreparedStatementCallback"`, newest first | 300 | 250 ms, avg 854 chars, max 9,617 |
| Timed operations | `match_phrase "TIMING"` + `match_phrase "took"`, 6 equal time slices | 300 per slice | 1,800 lines, 4.8 s total |
| Request durations | `match_phrase "Duration"` + `match_phrase "sec"`, newest first | 500 | 119 ms |
| Exact count of ≥ 1 s timings | `intervals` (`took`, wildcard `????*`, `ms`, ordered, `max_gaps: 0`) | 0 | 1 h 4.6 s, 6 h 4.2–5.9 s, **24 h 8.6–9.5 s timed out** |

`intervals` has no `regexp` rule on this cluster (HTTP 400), so there is no cheap exact "slow line" count. Decision:
timed operations are **sample-based** (clearly labelled "sampled, N lines"), and the `intervals` query is **not used**.
`[TIMING] … took` has 47,035 lines in 24 h, all from `rw-distributor-order-service`; `Duration: … sec` has 2,612, all
from `rw-punchout-cart-service`.

### Regexes verified on real lines

```ts
// Line prefix (two logback layouts) — matched 500 of 500 sampled lines.
const PREFIX = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}[.,]\d{3})Z?\s+(?:(\w+)\s+\d+\s+---\s+\[\s*([^\]]+)\]\s+(\S+)\s+:|(\w+)\s+\[([^\]]+)\]\s+(\S+)\s+-)\s/;
// Failed statement, its table and the driver's reason — matched 300 of 300 sqlFailed samples.
const SQL = /SQL \[([\s\S]*?)\](?=;|\s*$|\s+nested|\s)/;
const TABLE = /\b(?:INTO|UPDATE|FROM|JOIN)\s+`?([\w.]+)`?/i;
const CAUSE = /\];\s*([^;]+?)(?:;|$)/;          // then replace /'[^']*'/g with '?' and cut at " at org."
// Timed operations — matched every "[TIMING] … took" line in the sample.
const TIMING = /\[TIMING\]\s+(.+?)\s+took\s+(\d+)\s*ms/;
const DURATION = /-\s+(.+?)\.?\s+Duration:\s*([\d.]+)\s*sec/;   // matched 500 of 500
// Target of a service-call timeout.
const READ_TIMEOUT = /Read timed out executing (GET|POST|PUT|DELETE|PATCH) https?:\/\/[^/\s]+(\/[^\s?]*)/;
```

Sample lines (emails, IPs and quoted values removed):

```
… ERROR [JmsListenerEndpointContainer#2-89109] c.r.q.consumer.CustomerQueueConsumer - Failed to create/update customer due to the error is: PreparedStatementCallback; SQL [INSERT INTO hrwk2k22on.tbl_customer_ecom_details(customer_id, ref_id, store_id, ecom_ref_id) VALUES (?, ?, ?, ?)]; Duplicate entry '?' for key '?'
… ERROR [http-nio-8004-exec-14] c.r.quartz.services.JobService - Failed to insert job details due to -> com.mysql.cj.jdbc.exceptions.MySQLTransactionRollbackException: Lock wait timeout exceeded; try restarting transaction
… INFO [http-nio-8015-exec-9] c.r.cw.service.CwOrderService - [TIMING] CwOrderService.createOrder total took 219 ms
… INFO [http-nio-8023-exec-6] c.r.controller.RwMaxController - Request completed for calculating shipping estimation. Duration: 1.56 sec
… ERROR [edulerThread-11] c.r.edi.service.EdiCommonService : Exception occurred: Read timed out executing POST http://<ip>:8049/api/product/skus
… INFO [http-nio-8049-exec-8] org.mongodb.driver.cluster - No server chosen by ReadPreferenceServerSelector{readPreference=primary} …
```

Grouping the 300 newest `sqlFailed` samples gave: 282 × `INSERT INTO …tbl_customer_ecom_details` (Duplicate entry),
7 × `UPDATE …tbl_orders` (Lock wait timeout), 8 × `INSERT INTO …tbl_users` (Duplicate entry),
2 × `INSERT INTO …tbl_order_shipping_line_items` (foreign key fails), 1 × `DELETE FROM …tbl_product_categories_working_copy` (Deadlock).
Sampled timings: `CwOrderService.createOrder total` p50 175 ms, p95 374 ms; shipping estimation max 4.9 s.

Caveat found: `@timestamp` is ingest time. Some lines carry a much older time in the message (for example
`2026-09-09 15:07` returned for `now-24h`), so logs are sometimes re-shipped. Show the line's own time, and mark a row
"re-ingested" when it is more than 24 h older than `@timestamp`.

### Design

- **Route and nav:** page at `/slow-queries`; nav item `{ href: "/slow-queries", label: "Slow queries", icon: Gauge }`
  in the **Compute** group directly after "Databases". No dot in the path, so `middleware.ts` already guards it.
- **Range control:** `Segmented` with `1h | 6h | 24h`, default `6h`, kept in the URL as `?range=`. It applies to the
  log half only; the database half is cumulative since the last MySQL restart and says so.
- **Layout (top to bottom):** `PageHeader` with range control and Refresh; 4 KPIs (Failed SQL statements, Lock
  contention = deadlocks + lock waits, Service call timeouts, Slowest operation p95); a `Banner` listing rule-based
  notes; `Segmented` tabs **Service logs | Timed operations | Database**.
  - *Service logs:* stacked `TimeChart` of kinds over time; by-kind table (count, share bar, top service); by-service
    table; "Failed statements" table (statement, table, reason, count in sample, services, last seen). Clicking a kind or
    statement opens `SampleSheet`.
  - *Timed operations:* table of operation, service, samples, p50, p95, max, with a "sampled" label.
  - *Database:* one card per MySQL-family instance from `/api/rds`: issues list, then top statements with a
    `Segmented` sort (rows examined | total time | average latency). `available: false` renders reason plus remedy.
- **Caching:** `cached("slowq:logs:<range>", ttl)` with 5 min for 1h/6h and 10 min for 24h; `?refresh=1` bypasses it for
  a session user. Samples route cached 2 min per `(kind, range, service)`.
- **States:** loading uses `ScreenSkeleton`; ES failure uses `ErrorNote` with retry and the database tab still works;
  a kind whose query timed out is returned with `partial: true` and shown with a "partial" badge instead of a wrong zero;
  no data in range uses `EmptyState`.

### API response shapes

```ts
// GET /api/slow-queries/logs?range=6h
interface LogsResp {
  ok: true; range: "1h" | "6h" | "24h"; fetchedAt: string; via: string | null; cached: boolean;
  buckets: string[];                                   // ISO bucket starts shared by every kind
  kinds: Array<{ key: Kind; label: string; total: number; partial: boolean; error?: string;
                 trend: number[]; services: Array<{ service: string; count: number }> }>;
  statements: { sampled: number; groups: Array<{ statement: string; table: string | null; reason: string;
                 kind: "duplicate" | "lockWait" | "deadlock" | "foreignKey" | "other"; count: number;
                 services: string[]; lastAt: string | null }> };
  timeoutTargets: Array<{ method: string; path: string; count: number; services: string[] }>;   // from 200 samples
  operations: { sampled: number; rows: Array<{ operation: string; service: string; unit: "ms";
                 n: number; p50: number; p95: number; max: number }> };
  notes: Array<{ severity: "critical" | "warning" | "info"; title: string; evidence: string; action: string }>;
}
// GET /api/slow-queries/samples?kind=lockWait&range=6h&service=rw-order-service
interface SamplesResp { ok: true; kind: Kind; total: number; truncated: boolean;
  entries: Array<{ at: string | null; loggedAt: string | null; reingested: boolean; service: string;
                   host: string | null; level: string | null; logger: string | null; message: string }> }
```

Both routes: `getServerSession` → 401 JSON when absent, `export const dynamic = "force-dynamic"`, `maxDuration = 60`,
GET only, `range`/`kind` validated against a fixed map, `service` validated with `/^[a-z0-9-]{1,64}$/`. Failure → 502
`{ ok: false, error }` like the existing Spring routes.

### Redaction (server side, before anything is returned)

Log lines include customer emails, names and whole `ResultDTO [...]` dumps. `redact()` in `lib/slowQueryParse.ts` must:
cut the message at the first `ResultDTO [` or `DTO [`; replace emails with `<email>`, IPv4 addresses with `<ip>`,
quoted literals `'…'` with `'?'`, and any run of 24+ base64/hex characters with `<token>`; then truncate to 600
characters. Statements are already parameterised (`?`) and are kept, truncated to 400. Never return the raw message.

### Rule-based notes (no AI)

| Condition | Note |
|---|---|
| Duplicate-entry group ≥ 20 in sample | Same insert repeated: consumer is not idempotent. Use `INSERT … ON DUPLICATE KEY UPDATE` or check before insert; name the table and service. |
| Any lock-wait | Long transaction holding rows on the named table; look for missing index on the `WHERE` columns and shorten the transaction. |
| Any deadlock | Two writers taking locks in different order; make the order consistent and retry on deadlock. |
| Foreign-key failure | Child written before parent; queue ordering problem between the named tables. |
| `mongoNoServer` > 100 | MongoDB host unreachable from the named services; check the instance and its security group. |
| One timeout target ≥ 50% of read timeouts | Downstream endpoint is the bottleneck; name the path and the callers. |
| Operation p95 ≥ 1,000 ms | Slow operation; name it with p95 and max. |
| `connPool` / `tooMany` > 0 | Connection pool exhausted; critical. |

## Execution Steps

1. Create branch work in a worktree (`git worktree add .claude/worktrees/slow-queries -b main-2026-11-12` from `main`
   after the user confirms the branch name), so nothing is built in the live checkout. Copy the uncommitted live
   changes first only if the user has had them committed; otherwise stop and ask (see Risks).
2. `lib/elk.ts`: add `opts?: { timeoutMs?: number }` to `esSearch` and pass it to the LAN attempt
   (`opts?.timeoutMs ?? TIMEOUT_LAN_MS`). Move `withRetry` here and export it; update the import in
   `lib/snapshotFetchers.ts`. No change for existing callers.
3. `lib/slowQueryParse.ts`: the regexes above, `redact()`, `groupStatements()`, `summariseOperations()` (p50/p95/max),
   `timeoutTargets()`, `buildNotes()`. Pure functions only.
4. `lib/slowQueryLogs.ts`: `KINDS` table (key, label, clause), `RANGES` (`gte`, interval, slice count),
   `fetchLogTrouble(range)` that runs the per-kind queries **sequentially** with `esSearch(..., { timeoutMs: 9000 })`
   and `withRetry(fn, 2, 1500)`, records `partial` on `timed_out` or error instead of throwing, then the three sample
   queries (300 / 6 × 300 / 500 as measured, plus 200 read-timeout samples), and `fetchSamples(kind, range, service)`
   (size 50). Every body carries a `range` filter and `timeout: "8s"`.
5. `lib/rdsQueryInsights.ts`: add `orderBy: "rows" | "time" | "latency" = "rows"` mapped through a constant object to
   `sum_rows_examined`, `sum_timer_wait`, `avg_timer_wait` (never interpolate user input). Add `avg_timer_wait` handling
   only if needed for the mapping. `app/api/rds/[id]/queries/route.ts`: read `?sort=`, accept only those three values.
   Check `hydrateFromDb` in `lib/secrets.ts`; if it filters by `MANAGED_KEYS`, add `RDS_QUERY_USER` and
   `RDS_QUERY_PASSWORD` to that set.
6. `app/api/slow-queries/logs/route.ts` and `app/api/slow-queries/samples/route.ts` as specified above, wrapped in `cached()`.
7. `components/screens/slowqueries/*` and `app/slow-queries/page.tsx`. Reuse `Screen`, `PageHeader`, `KpiGrid`, `Kpi`,
   `Banner`, `EmptyState`, `ErrorNote`, `ScreenSkeleton`, `HeadRow`, `ShareBar`, `Dot`, `TimeChart`, `Card`,
   `CardHeader`, `Badge`, `Segmented`, `Sheet`, `SearchInput`, `useJson`, `num`, `ago`, `tint`. Tokens only, no
   hard-coded colours; kind colours from existing status tokens (`--danger`, `--orange`, `--warning`, `--info`, `--brand`).
   Tables scroll inside their card below their `min-w`, as on the Cron page. Keep each file under 350 lines.
8. `components/shell/nav.ts`: import `Gauge` and add the item after Databases.
9. Scratchpad `mocks.cjs`: add `/api/slow-queries/logs` (numbers from the measurements above, one kind with
   `partial: true`), `/api/slow-queries/samples` (6 redacted entries, one `reingested`), and a second
   `/api/rds/x/queries` variant with `available: true` and 5 statements for a screenshot of the populated state.
   Add `['slowq','/slow-queries']` to `shoot.cjs` and two checks to `interact.cjs` (switch to "Timed operations";
   open the sample sheet from a kind row).
10. `CLAUDE.md`: add one Conventions bullet describing the page, its two sources, sampling and redaction.
11. Run the Verification section. Report results and stop: do not commit, merge, build in the live checkout or restart.

## Expected Outcomes

- `/slow-queries` appears in the sidebar and command palette and renders in dark, light and at phone width.
- The log half shows real counts for 1h/6h/24h in under about 6 s uncached and instantly when cached.
- The database half shows the clear "unavailable" state with the remedy until a read-only login is added, and the
  top statements with three sort orders once it is.
- No customer email, IP address, quoted value or DTO dump reaches the browser.
- `npx tsc --noEmit` and `npm run build` pass; the existing 19 page views and 12 interaction checks still pass.

## Risks & Constraints

- **Do not load Elasticsearch harder than measured.** No 7-day range, no `intervals`/wildcard queries, no parallel
  fan-out of the per-kind queries, sizes as stated. Keep the cache.
- **Read-only everywhere.** ES: `_search` only. MySQL: `SELECT` on `performance_schema` only. AWS: Describe only.
- **Live service.** The main checkout is production. Building there or restarting `natasha-dashboard.service` needs
  the user's explicit approval. Nothing is committed or pushed without asking for the branch first.
- **Uncommitted live changes.** `lib/snapshotFetchers.ts` (retry), `components/screens/CronJobs.tsx` (IST times),
  `lib/sheetAllowlist.ts` (empty allowlist) and `CLAUDE.md` are modified but uncommitted in the main checkout. A new
  worktree from `main` will not contain them, and step 2 touches `lib/snapshotFetchers.ts`. Resolve by committing them
  first (user's call).
- **Hard-coded ELK password default** in `lib/elk.ts` in a public repo is a known open item; do not add any new
  credential defaults and do not print credentials in logs or responses.
- Do not change existing behaviour of `/api/rds/[id]/queries` without `?sort=`, or of `esSearch` without `opts`.
- Counts for `readTimeout` at 24 h take about 4.4 s; if the cluster is under pressure the kind comes back `partial`.
- Log timestamps: ingest time versus logged time can differ by months for re-shipped files.
- Timed operations and statement groups are samples, not totals; the UI must say so.

## Verification

1. `npx tsc --noEmit` in the worktree.
2. `npm run build` in the worktree (not in the live checkout).
3. Start the worktree build on port 3100 with the throwaway `NEXTAUTH_SECRET`, as in the earlier runs, and run:
   `node shoot.cjs` (dark 1440), `node shoot.cjs "" light`, `node shoot.cjs "" dark 390`, `node shoot.cjs "" light 390`,
   `node interact.cjs`. Expect: every page `ok`, `xoverflow=0`, no unmocked API, all interaction checks `PASS`.
   View the `slowq-*` screenshots for all three tabs and the open sample sheet.
4. Logged out: `curl` `/slow-queries` → 307 to `/login`; `/api/slow-queries/logs` and `/api/slow-queries/samples` → 401.
5. Real-data check without a browser session: a `tsx` one-off that calls `fetchLogTrouble("6h")` and
   `fetchSamples("lockWait","24h")` and prints counts, timings and three redacted entries; confirm no `@`, no IPv4 and
   no `ResultDTO` in any returned string, and that totals are close to the table in Analysis.
6. Stop the test server by exact PID from `ss -ltnp` on port 3100; confirm the live service still shows the same
   `MainPID` and `NRestarts=0`.
7. Report to the user and ask before: committing, merging to `main`, building in the live checkout, restarting.
