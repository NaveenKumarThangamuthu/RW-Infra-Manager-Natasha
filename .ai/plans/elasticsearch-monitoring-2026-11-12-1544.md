---
model: opus
---

# Execution Plan: Elasticsearch monitoring page (Prometheus) with a search slow log panel

## Problem Statement

The user asked: "I need same as RDS — CPU and all details, take from Prometheus — and in ES itself slow query is
enabled, why are you not showing that?"

Deliver a monitoring page for the Elasticsearch cluster itself, modelled on the database detail page
(`/rds/[id]`): header with a time-range selector, a KPI strip, a "Detected issues" card built from rules, and a grid
of time-series charts. All metrics come from Prometheus (job `elasticsearch`, elasticsearch_exporter). Add a
"Search slow log" panel that is honest: the slow log is not readable by this app today, so the panel says so, says
exactly what is needed, and starts working by configuration alone once an index with the slow log exists.

## Skill

- Name: none applies. This is a Next.js 14 / TypeScript feature; the listed skills are for Java, Vue or reviews.
- SKILL.md path: none. Follow `/home/naveen5/Documents/projects/Infra/CLAUDE.md` (repo conventions).

## Scope

All paths below are given for the live checkout `/home/naveen5/Documents/projects/Infra`. **The executor works in a
git worktree created from commit `8dbb37c`** (the main session supplies the worktree path) and applies the same
relative paths there. Nothing is written in the live checkout.

Files to read (no change):

- `/home/naveen5/Documents/projects/Infra/CLAUDE.md`
- `/home/naveen5/Documents/projects/Infra/lib/prometheus.ts` (`query`, `queryRange`, `PromSample`, `PromRangeSeries`)
- `/home/naveen5/Documents/projects/Infra/lib/rdsPerformance.ts` (shape of `Series`, `RdsStat`, `RdsIssue`, rule style)
- `/home/naveen5/Documents/projects/Infra/app/api/rds/[id]/route.ts` (session check, window validation)
- `/home/naveen5/Documents/projects/Infra/components/screens/DatabaseDetail.tsx` (layout to copy; do NOT edit, see Risks)
- `/home/naveen5/Documents/projects/Infra/components/natasha/charts.tsx` (`TimeChart`), `primitives.tsx`, `format.ts`
- `/home/naveen5/Documents/projects/Infra/components/ui/card.tsx`, `components/ui/segmented.tsx`
- `/home/naveen5/Documents/projects/Infra/components/useJson.ts`, `lib/cache.ts`, `lib/elk.ts`, `lib/db.ts`
- `/home/naveen5/Documents/projects/Infra/app/api/slow-queries/logs/route.ts` (in-flight de-duplication pattern)

Files to create:

- `/home/naveen5/Documents/projects/Infra/lib/esMonitor.ts` (PromQL catalogue, fetch, stats; target under 350 lines)
- `/home/naveen5/Documents/projects/Infra/lib/esMonitorIssues.ts` (issue rules; under 250 lines)
- `/home/naveen5/Documents/projects/Infra/lib/esSlowlog.ts` (optional slow log reader; under 200 lines)
- `/home/naveen5/Documents/projects/Infra/app/api/elasticsearch/route.ts`
- `/home/naveen5/Documents/projects/Infra/app/api/elasticsearch/slowlog/route.ts`
- `/home/naveen5/Documents/projects/Infra/app/elasticsearch/page.tsx`
- `/home/naveen5/Documents/projects/Infra/components/screens/elasticsearch/ElasticsearchMonitor.tsx` (under 300 lines)
- `/home/naveen5/Documents/projects/Infra/components/screens/elasticsearch/MetricCard.tsx` (chart card around `TimeChart`)
- `/home/naveen5/Documents/projects/Infra/components/screens/elasticsearch/SlowLogPanel.tsx`
- `/home/naveen5/Documents/projects/Infra/components/screens/elasticsearch/types.ts` (client-side response types)

Files to modify:

- `/home/naveen5/Documents/projects/Infra/components/shell/nav.ts` (one nav item, one icon import)
- `/home/naveen5/Documents/projects/Infra/lib/secrets.ts` (add `ES_SLOWLOG_INDEX` to `MANAGED_KEYS`, one line)

Modules affected: sidebar/command palette (via `NAV`), Settings secrets list (shows one more known key). No Prisma
change, no new npm dependency, no middleware change (the new page and APIs are covered by the existing matcher).

## Analysis

### What exists

- `/rds/[id]` = `DatabaseDetail.tsx` + `GET /api/rds/[id]?region=&hours=` + `lib/rdsPerformance.ts`. Windows
  3/6/24/72/168 h. Response `{ ok, perf }` with `series`, `stats` (`avg/max/min/last`), `issues[]`
  (`severity/title/evidence/action`). Times are shown in IST with a fixed +330 min offset.
- `TimeChart` already accepts several series (`series: ChartSeries[]`), so multi-line charts need no new chart
  component. The `Chart` and `timeLabels` helpers in `DatabaseDetail.tsx` are file-local and not exported.
- `lib/prometheus.ts` uses the global `fetch` with a 10 s timeout and no TLS options.

### Prometheus facts re-checked on 2026-11-12 15:40 IST (read-only instant queries)

- **TLS: the stated "certificate expired on 2026-11-10" does not hold right now.** From this host,
  `curl` without `-k` returns 200 with `ssl_verify_result=0`, and Node 26 `fetch` succeeds with verification on.
  The certificate served is `CN=*.rwdomain.com`, GoDaddy, `notBefore 2026-10-10`, `notAfter 2026-12-07`. So no
  TLS bypass is needed and none is planned. Two caveats: the certificate expires again on **7 Dec 2026**, and the
  already-running live process was not tested (it opens a new TLS connection per request, so it should work).
- Job `elasticsearch`, target `172.31.29.22:9114`, scrape interval 30 s (20,157 samples in 7 days), retention 1 year.
  `rate()` windows must therefore be at least 2 minutes; this plan uses 5 minutes or more.
- Labels on node metrics: `cluster="elasticsearch"`, `name="ip-172-31-29-22"`, `host="172.31.29.22"`. Cluster health
  metrics carry only `cluster`, `instance`, `job`; status is three series with `color=green|yellow|red`, value 1 for
  the current one.
- Current values, for calibrating rules: status yellow; 1 node; 301 active shards (all primaries), 89 unassigned;
  heap 4.98 GB of 8 GB (58%); parent memory-safety limit at 61%; data disk 21.9 GB free of 124.7 GB (17.6% free);
  process CPU 22%, server CPU 24%, load1 1.56; ~211 shard searches/s at 0.27 ms average; search and write queues 0;
  no rejections; no breaker trips; 296.7 M documents, 81.3 GB stored, 6,108 segments; 1,603 open files of 65,535;
  uptime 131 days; 0 read-only indices.
- The same host has a node_exporter target `172.31.29.22:9100` (job `ERP Server Metrics`,
  `server_name="PROD-ELASTICSEARCH-SERVER"`, 2 CPU cores, 16.4 GB RAM). Used only to read the core count.
- Metrics that exist but are **not usable**: `elasticsearch_os_mem_actual_used_bytes`,
  `elasticsearch_os_mem_actual_free_bytes`, `elasticsearch_process_mem_resident_size_bytes` and
  `elasticsearch_transport_rx_size_bytes_total` all read 0. `elasticsearch_os_mem_used_bytes` includes the file
  cache (16.2 of 16.4 GB) and would read as a false alarm. No server-memory or network chart is planned.
- Thread pool label is `type` (`search`, `write`, ...). GC label is `gc` (`young`, `old`, `G1 Concurrent GC`).
  Breaker label is `breaker` (`parent`, `request`, `fielddata`, `inflight_requests`, ...). Disk I/O label `device`.

### Search slow log

Not readable today (verified by the main session): the only index the app's Elasticsearch login can search is
`logs-tcp-default` (Spring service logs), it holds no slow log lines, the exporter does not expose the slow log, and
the login gets 403 on settings/monitoring APIs. The slow log is a file on the node
(`*_index_search_slowlog.json`). The page therefore shows what Prometheus does have (search rate, average search
time, fetch time, search queue, rejected searches) and a panel that states the slow log is unavailable and why.

One thing could not be confirmed: `lib/elk.ts` describes its target as the "RW DEV cluster"
(`192.168.16.181` / `3.221.76.159`), while Prometheus scrapes `172.31.29.22`, labelled
`PROD-ELASTICSEARCH-SERVER`. A `GET /` to the public address did not answer from this host, so whether these are
the same cluster is unknown. The reader below searches whatever cluster `lib/elk.ts` points at; this is an open
question for the user (see end of the report to the main session) and the panel copy must not claim which cluster
it reads.

### Design decisions

- **One cluster, one page:** route `/elasticsearch` (no `[id]`), API `GET /api/elasticsearch?hours=`. All PromQL
  aggregates (`sum`/`avg`/`max`) so it still works if nodes are added.
- **Two API calls:** metrics and slow log are separate endpoints so the Prometheus part never waits on
  Elasticsearch, and the slow log endpoint makes zero Elasticsearch calls until an index is configured.
- **No edit to `DatabaseDetail.tsx`:** it has an uncommitted change in the live checkout, so the chart card is a
  small new file that wraps the existing `TimeChart`.
- **No TLS bypass.** If Prometheus cannot be reached, the API returns 502 with a plain reason and the page shows
  `ErrorNote` with Retry.

## Execution Steps

### 1. `lib/esMonitor.ts`

Constants: `const S = 'job="elasticsearch"'` (override with `process.env.ES_PROM_JOB` only if it matches
`/^[A-Za-z0-9 _.-]{1,60}$/`).

Windows, step and rate window (`W`):

| hours | UI label | step | W (rate window) | points |
|------:|----------|-----:|-----------------|-------:|
| 3 | 3h | 120 s | 5m | 90 |
| 6 | 6h | 300 s | 5m | 72 |
| 24 | 1d (default) | 600 s | 10m | 144 |
| 72 | 3d | 1800 s | 30m | 144 |
| 168 | 7d | 3600 s | 1h | 168 |

`end = floor(now / step) * step`, `start = end - hours * 3600`.

Types (exported):

```ts
export interface EsLine { label: string; points: Array<[number, number]> }   // [epoch ms, value]
export interface EsStat { avg: number | null; max: number | null; min: number | null; last: number | null }
export type EsSeriesKey =
  | "cpu" | "load" | "heapPct" | "gc" | "breakerPct" | "diskFree" | "diskOps"
  | "searchRate" | "searchTime" | "searchQueue" | "searchActive" | "rejected"
  | "indexRate" | "indexTime" | "docs" | "storeSize" | "shards" | "segments" | "openFiles" | "pendingTasks";
export interface EsIssue { severity: "critical" | "warning" | "info"; title: string; evidence: string; action: string }
export interface EsMonitor {
  windowHours: number; stepSec: number; fetchedAt: string;
  cluster: string; version: string | null; target: string | null; exporterUp: boolean;
  lastScrapeAt: string | null;                       // ISO, from timestamp()
  status: "green" | "yellow" | "red" | "unknown";
  nodes: Array<{ name: string; host: string }>; nodeCount: number | null;
  heapMaxBytes: number | null; diskSizeBytes: number | null; cpuCores: number | null;
  maxOpenFiles: number | null; uptimeSec: number | null; restarts: number | null;
  shards: { active: number | null; primary: number | null; unassigned: number | null; relocating: number | null; initializing: number | null };
  readOnlyIndices: number | null;
  breakerTrips: Array<{ breaker: string; count: number }>;      // increase over the window, > 0 only
  rejections: Array<{ pool: string; count: number }>;           // increase over the window, > 0 only
  series: Record<EsSeriesKey, EsLine[] | null>;                 // null = Prometheus returned nothing
  stats: Record<string, EsStat>;                                // keyed "<seriesKey>.<label>"
  failedQueries: string[];                                      // series keys whose query failed
  issues: EsIssue[];
  health: "healthy" | "attention" | "critical";
}
```

Range queries (`queryRange(q, start, end, step)`), one per line; `S` and `W` substituted:

| key | line label | PromQL |
|---|---|---|
| cpu | Elasticsearch | `avg(elasticsearch_process_cpu_percent{S})` |
| cpu | Whole server | `avg(elasticsearch_os_cpu_percent{S})` |
| load | 1 min | `avg(elasticsearch_os_load1{S})` |
| load | 5 min | `avg(elasticsearch_os_load5{S})` |
| load | 15 min | `avg(elasticsearch_os_load15{S})` |
| heapPct | Heap in use | `100 * sum(elasticsearch_jvm_memory_used_bytes{S,area="heap"}) / sum(elasticsearch_jvm_memory_max_bytes{S,area="heap"})` |
| gc | (label = `gc`) | `1000 * sum by (gc) (rate(elasticsearch_jvm_gc_collection_seconds_sum{S}[W]))` (ms of clean-up per second) |
| breakerPct | Memory safety limit | `100 * max(elasticsearch_breakers_estimated_size_bytes{S,breaker="parent"} / elasticsearch_breakers_limit_size_bytes{S,breaker="parent"})` |
| diskFree | Free disk | `sum(elasticsearch_filesystem_data_available_bytes{S})` |
| diskOps | Reads | `sum(rate(elasticsearch_filesystem_io_stats_device_read_operations_count{S}[W]))` |
| diskOps | Writes | `sum(rate(elasticsearch_filesystem_io_stats_device_write_operations_count{S}[W]))` |
| searchRate | Searches | `sum(rate(elasticsearch_indices_search_query_total{S}[W]))` |
| searchRate | Fetches | `sum(rate(elasticsearch_indices_search_fetch_total{S}[W]))` |
| searchTime | Search | `1000 * sum(rate(elasticsearch_indices_search_query_time_seconds{S}[W])) / sum(rate(elasticsearch_indices_search_query_total{S}[W]))` |
| searchTime | Fetch | `1000 * sum(rate(elasticsearch_indices_search_fetch_time_seconds{S}[W])) / sum(rate(elasticsearch_indices_search_fetch_total{S}[W]))` |
| searchQueue | Search | `sum(elasticsearch_thread_pool_queue_count{S,type="search"})` |
| searchQueue | Write | `sum(elasticsearch_thread_pool_queue_count{S,type="write"})` |
| searchActive | Search | `sum(elasticsearch_thread_pool_active_count{S,type="search"})` |
| rejected | Search | `sum(increase(elasticsearch_thread_pool_rejected_count{S,type="search"}[W]))` |
| rejected | Write | `sum(increase(elasticsearch_thread_pool_rejected_count{S,type="write"}[W]))` |
| indexRate | Documents | `sum(rate(elasticsearch_indices_indexing_index_total{S}[W]))` |
| indexTime | Per document | `1000 * sum(rate(elasticsearch_indices_indexing_index_time_seconds_total{S}[W])) / sum(rate(elasticsearch_indices_indexing_index_total{S}[W]))` |
| docs | Documents | `sum(elasticsearch_indices_docs{S})` |
| storeSize | Stored data | `sum(elasticsearch_indices_store_size_bytes{S})` |
| shards | Active | `sum(elasticsearch_cluster_health_active_shards{S})` |
| shards | Unassigned | `sum(elasticsearch_cluster_health_unassigned_shards{S})` |
| segments | Segments | `sum(elasticsearch_indices_segments_count{S})` |
| openFiles | Open files | `sum(elasticsearch_process_open_files_count{S})` |
| pendingTasks | Pending | `sum(elasticsearch_cluster_health_number_of_pending_tasks{S})` |

Instant queries (`query(q)`); `H` = window, e.g. `24h`:

| purpose | PromQL |
|---|---|
| exporter up, target | `up{S}` |
| status | `elasticsearch_cluster_health_status{S} == 1` (read `color` label) |
| last scrape | `timestamp(elasticsearch_cluster_health_status{S,color="green"})` |
| version, cluster name | `elasticsearch_version{S}` (labels `version`, `cluster`) |
| nodes, heap max | `elasticsearch_jvm_memory_max_bytes{S,area="heap"}` (labels `name`, `host`; sum values) |
| node count | `max(elasticsearch_cluster_health_number_of_nodes{S})` |
| node count low/high | `min_over_time(elasticsearch_cluster_health_number_of_nodes{S}[H])`, `max_over_time(...[H])` |
| shard counts | `{__name__=~"elasticsearch_cluster_health_(active_shards\|active_primary_shards\|unassigned_shards\|relocating_shards\|initializing_shards)",S}` |
| disk size | `sum(elasticsearch_filesystem_data_size_bytes{S})` |
| max open files | `max(elasticsearch_process_max_files_descriptors{S})` |
| uptime, restarts | `max(elasticsearch_jvm_uptime_seconds{S})`, `sum(resets(elasticsearch_jvm_uptime_seconds{S}[H]))` |
| breaker trips | `sum by (breaker) (increase(elasticsearch_breakers_tripped{S}[H])) > 0` |
| rejected (all pools) | `sum by (type) (increase(elasticsearch_thread_pool_rejected_count{S}[H])) > 0` |
| read-only indices | `max(elasticsearch_indices_settings_stats_read_only_indices{S})` |
| writes throttled | `max(max_over_time(elasticsearch_indices_indexing_is_throttled{S}[H]))` |
| CPU cores (second pass) | `count(node_cpu_seconds_total{instance=~"<host>:.*",mode="idle"})`, `<host>` from the first node's `host` label, only if it matches `/^[A-Za-z0-9.-]{1,80}$/`, dots escaped as `\\.`; `null` when absent |

Behaviour:

- Run queries with `Promise.allSettled` in batches of 8. A failed or empty range query sets that line to absent; a
  series key with no lines is `null` and its key is added to `failedQueries` only when the query threw.
- Drop non-finite samples (`NaN`, `+Inf` from divide-by-zero) when converting; multiply timestamps by 1000.
- If `up{S}` itself throws, throw `new Error(describePromError(e))`. `describePromError` reads `e.cause?.code`:
  `CERT_HAS_EXPIRED` → "Prometheus could not be reached: its security certificate has expired. Renew the
  certificate for prometheus.rwdomain.com."; `ENOTFOUND`/`ECONNREFUSED`/`ETIMEDOUT`/`TimeoutError` → "Prometheus did
  not answer."; otherwise the original message. **Do not** add `rejectUnauthorized: false`,
  `NODE_TLS_REJECT_UNAUTHORIZED` or any other bypass. Do not change `lib/prometheus.ts`.
- `stats["<key>.<label>"] = statOf(line)` (same maths as `statOf` in `lib/rdsPerformance.ts`).
- `issues = buildEsIssues(base)`; `health` = `critical` if any critical, `attention` if any warning, else `healthy`.
- Export `getEsMonitor(hours: number): Promise<EsMonitor>` and `ES_WINDOWS = [3, 6, 24, 72, 168]`.

### 2. `lib/esMonitorIssues.ts` — `buildEsIssues(m): EsIssue[]`

A rule that cannot be evaluated (value `null`) stays silent. Sort critical, warning, info. `hrs` = window hours.

| # | Condition | Severity | Title | Evidence (numbers filled in) | Action |
|--:|---|---|---|---|---|
| 1 | `exporterUp === false` | critical | Monitoring cannot reach Elasticsearch | "The metrics collector on {target} is down." | "Check that Elasticsearch and its metrics exporter are running on the server." |
| 2 | `lastScrapeAt` older than 5 min | warning | Metrics are out of date | "Last reading {n} min ago." | "Numbers below may not reflect the current state." |
| 3 | `status === "red"` | critical | Cluster status is red | "Some data is unavailable: {unassigned} shard copies are not assigned." | "At least one index has no working primary copy. Searches on it fail until it is restored." |
| 4 | `status === "yellow"` and `nodeCount === 1` | warning | Cluster status is yellow | "{unassigned} backup copies cannot be placed because the cluster has only one server." | "All data is searchable, but there is no second copy. Add a second server, or set the number of replicas to 0 for these indices to clear the warning." |
| 5 | `status === "yellow"` and `nodeCount > 1` | warning | Cluster status is yellow | "{unassigned} backup copies are not assigned across {nodeCount} servers." | "Check for a server that left the cluster or a full disk." |
| 6 | node count low < high in window | critical | A server left the cluster | "Server count dropped from {high} to {low} in the last {hrs}h." | "Check the missing server." |
| 7 | `heapPct.avg >= 85` or `heapPct.max >= 95` | critical | Memory (heap) almost full | "Average {avg}%, peak {max}% of {heapMax} GB." | "Elasticsearch will slow down and start refusing requests. Reduce shard count or give the server more memory." |
| 8 | else `heapPct.avg >= 75` | warning | Memory (heap) running high | same numbers | "Little room is left for heavy searches." |
| 9 | any `breakerTrips` | critical | Requests refused to protect memory | "{breaker}: {count} times in {hrs}h" (list) | "A search or bulk request needed more memory than was safe. Look for very large searches or aggregations." |
| 10 | old-generation GC line avg >= 50 ms/s | warning | Long memory clean-ups | "Old-generation clean-up took {avg} ms of every second on average." | "This is a sign of memory pressure and pauses all requests while it runs." |
| 11 | `shards.active > 20 * heapMaxGB` | warning | Too many shards for the memory available | "{active} shards on {heapMaxGB} GB of heap; the usual guide is 20 per GB ({limit})." | "Merge or delete small old indices, or shrink the number of shards per index." |
| 12 | `cpu.Elasticsearch.avg >= 80` | critical | CPU sustained above 80% | "Average {avg}%, peak {max}% over {hrs}h." | "Find the heavy searches or add CPU." |
| 13 | else `cpu.Elasticsearch.avg >= 60` | warning | CPU running hot | same | "Headroom is thin for traffic spikes." |
| 14 | `cpuCores` known and `load.5 min.avg > 1.5 * cpuCores` | warning | Server is overloaded | "Average load {avg} on {cores} CPU cores." | "Work is queuing for CPU or disk." |
| 15 | disk free % (`diskFree.last / diskSizeBytes`) `< 10` | critical | Free disk below 10% | "{free} GB free of {size} GB ({pct}%)." | "Elasticsearch stops placing data on a disk this full and makes indices read-only at 5% free. Delete old indices or extend the disk now." |
| 16 | else `< 20` | warning | Free disk below 20% | same | "At 15% free Elasticsearch stops creating new shard copies here. Plan a clean-up or a larger disk." |
| 17 | `readOnlyIndices > 0` | critical | Indices are read-only | "{n} indices refuse writes." | "Usually caused by a full disk. Free space, then remove the read-only block." |
| 18 | rejected `search` count > 0 | critical | Searches were rejected | "{count} searches refused in {hrs}h because the queue was full." | "The cluster could not keep up. See search time and CPU for the same period." |
| 19 | rejected `write` count > 0 | warning | Writes were rejected | "{count} write requests refused in {hrs}h." | "Senders should retry; sustained rejections mean indexing is too heavy for this server." |
| 20 | `searchTime.Search.avg >= 1000` ms | critical | Searches are slow | "Average {avg} ms per shard search, peak {max} ms." | "Check the search slow log for the queries responsible." |
| 21 | else `>= 200` ms | warning | Search time elevated | same | same |
| 22 | `searchQueue.Search.max >= 100` | warning | Searches are queuing | "Up to {max} searches waited in the queue." | "Searches arrive faster than they finish." |
| 23 | writes-throttled value `=== 1` | warning | Indexing was throttled | "Elasticsearch slowed down writes during the window." | "Merging cannot keep up with indexing; usually a disk speed limit." |
| 24 | `openFiles.last / maxOpenFiles >= 0.8` | warning | Open file limit nearly reached | "{open} of {max} files open." | "Raise the limit or reduce shard count." |
| 25 | `pendingTasks.max >= 50` | warning | Cluster changes are backing up | "Up to {max} cluster tasks pending." | "The master node is slow to apply changes." |
| 26 | `restarts > 0` | info | Elasticsearch restarted | "{n} restart(s) in the last {hrs}h." | "Check whether this was planned." |

With today's data the expected output is rule 4, rule 11 (301 > 160) and rule 16 (17.6% free).

### 3. `app/api/elasticsearch/route.ts`

- `export const dynamic = "force-dynamic"; export const maxDuration = 60;`
- `GET`: `getServerSession(authOptions)`; no session → `401 { error: "Unauthorized" }`.
- `hours` from `?hours=`, accepted only if in `ES_WINDOWS`, else 24.
- `cached(\`es:monitor:${hours}\`, 60_000, () => getEsMonitor(hours))`, with an in-flight `Map<string, Promise>` so
  parallel requests share one fetch (same pattern as `app/api/slow-queries/logs/route.ts`).
- Success: `{ ok: true, monitor }`. Failure: `502 { error: message }`.

### 4. `lib/esSlowlog.ts` and `app/api/elasticsearch/slowlog/route.ts`

Configuration: `process.env.ES_SLOWLOG_INDEX` (an index or data-stream pattern, e.g. `es-slowlog-*`). Add
`"ES_SLOWLOG_INDEX"` to `MANAGED_KEYS` in `lib/secrets.ts` so it can be set from Settings without a redeploy.
Accept the value only if it matches `/^[a-z0-9][a-z0-9._*,-]{0,120}$/`.

Types:

```ts
export interface SlowLogEntry {
  at: string; tookMs: number | null; index: string | null; shard: string | null;
  totalHits: string | null; searchType: string | null; level: string | null; query: string | null; // query cut to 1,500 chars
}
export type SlowLogResp =
  | { state: "not_configured" }
  | { state: "ok"; index: string; windowHours: number; total: number; totalCapped: boolean; entries: SlowLogEntry[]; fetchedAt: string }
  | { state: "empty"; index: string; windowHours: number; fetchedAt: string }
  | { state: "error"; index: string; message: string };
```

`fetchSlowLog(hours)`:

- Index unset or invalid → return `{ state: "not_configured" }` **without contacting Elasticsearch**.
- Window = `min(hours, 24)` (never more than 24 h, whatever the page range).
- Exactly one `esSearch(index, body, { timeoutMs: 6000 })` call, no `withRetry`, no aggregations:

```json
{
  "size": 25, "timeout": "5s", "track_total_hits": 1000,
  "_source": ["@timestamp", "log.level", "message", "event.duration", "elasticsearch.index.name",
              "elasticsearch.shard.id", "elasticsearch.slowlog.*"],
  "query": { "bool": { "filter": [
    { "range": { "@timestamp": { "gte": "now-<window>h" } } },
    { "bool": { "minimum_should_match": 1, "should": [
      { "exists": { "field": "elasticsearch.slowlog.took_millis" } },
      { "exists": { "field": "elasticsearch.slowlog.took" } },
      { "term": { "event.dataset": "elasticsearch.slowlog" } } ] } } ] } },
  "sort": [ { "elasticsearch.slowlog.took_millis": { "order": "desc", "unmapped_type": "long" } },
            { "@timestamp": { "order": "desc" } } ]
}
```

- Field reading must accept both nested objects and flat dotted keys. `tookMs` = `elasticsearch.slowlog.took_millis`,
  else `event.duration / 1e6`. `index`/`shard` from `elasticsearch.index.name` / `elasticsearch.shard.id`, else from
  a leading `[index][shard]` in `elasticsearch.slowlog.message` or `message`. `query` =
  `elasticsearch.slowlog.source`, truncated.
- 0 hits → `empty`. HTTP 403 → `error` "The Elasticsearch login used by this dashboard is not allowed to read
  {index}." 404 → `error` "Index {index} does not exist." Other → `error` with the first 200 characters.
- This reader has never run against real slow log data (none exists). Say so in a code comment, and do not add
  sample data, fixtures or fallbacks that could display invented entries.

Route: session check as in step 3; `await ensureSecretsHydrated()` (from `@/lib/db`); `hours` validated against
`ES_WINDOWS`; `cached(\`es:slowlog:${min(hours,24)}\`, 10 * 60_000, ...)` with in-flight de-duplication; do not cache
`not_configured`; always HTTP 200 with the `SlowLogResp` body.

### 5. `components/screens/elasticsearch/types.ts`

Client copies of `EsMonitor`, `EsLine`, `EsStat`, `EsIssue`, `SlowLogResp`, `SlowLogEntry`, plus
`RANGES = [["3h",3,"last 3h"],["6h",6,"last 6h"],["1d",24,"last 24h"],["3d",72,"last 3 days"],["7d",168,"last 7 days"]]`.

### 6. `components/screens/elasticsearch/MetricCard.tsx`

A `Card` with title on the left, a short stat on the right, then `TimeChart` (`height={110} ticks={4} yTicks={3}
area strokeWidth={1.5} axisWidth={40}`), same classes as `Chart` in `DatabaseDetail.tsx`. Props:
`{ title, stat, lines: EsLine[] | null, colors: string[], long: boolean, scale?: number, fmt, zero?: boolean, wide?: boolean }`.
`area` only when there is one line. Labels in IST using the same fixed +330 min method: `HH:mm` when
`hours <= 24`, `Mon D` otherwise; hover text `Mon D, HH:mm IST`. Take the x-axis from the longest line and align the
others by timestamp (missing → previous value, or 0 at the start). Empty state: "Prometheus returned no data for this
metric. That is not the same as a healthy zero."

### 7. `components/screens/elasticsearch/ElasticsearchMonitor.tsx`

`"use client"`. `useJson<{ monitor: EsMonitor }>(\`/api/elasticsearch?hours=${hours}\`)`. Layout, top to bottom, using
`Screen label="Elasticsearch"`, `ErrorNote`, `ScreenSkeleton kpis={4}`, `Segmented`, `Card`:

1. Header: `h1` = cluster name ("elasticsearch"); subtitle
   `Elasticsearch {version} · {nodeCount} server(s) · {node names} · up {days} days · fetched {time}`; right side
   `Segmented` (3h/6h/1d/3d/7d, default 1d) and the refresh button (same markup as the database page).
2. KPI strip (6 cells, `grid-cols-[repeat(var(--k6,6),minmax(0,1fr))]`):
   - **Cluster status**: Green/Yellow/Red (colour `--success`/`--warning`/`--danger`); sub "{n} server(s) · {unassigned} copies unassigned".
   - **CPU average**: `cpu.Elasticsearch.avg` %; sub "Peak {max}%".
   - **Memory in use**: `heapPct.last` %; sub "{used} of {heapMax} GB heap · peak {max}%".
   - **Free disk**: `diskFree.last` GB; sub "Of {size} GB · {pct}% free".
   - **Search time**: `searchTime.Search.avg` ms (2 decimals under 10 ms); sub "{searchRate avg} searches/s".
   - **Issues**: "{crit} / {warn}"; sub "Critical / warning"; colour as on the database page.
3. If `failedQueries.length`: a `Banner tone="var(--warning)"`: "Some charts could not be loaded from Prometheus:
   {list}."
4. "Detected issues" card: same markup as the database page (icon, title, severity chip, evidence, action; "No
   issues detected in this window." when empty).
5. `<SlowLogPanel hours={hours} />`.
6. Section heading "Performance · {range label}" with "Prometheus · times in IST" on the right, then the chart
   grid (`grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4`), in this order:

| Chart title | series key | unit / format | colours |
|---|---|---|---|
| CPU utilisation | cpu | % | `--danger`, `--info` |
| Server load | load | 2 decimals | `--info`, `--orange`, `--cshared` |
| Memory (heap) in use | heapPct | % | `--cshared` |
| Memory clean-up time | gc | ms per second | `--info`, `--danger`, `--cinfra` |
| Memory safety limit used | breakerPct | % | `--warning` |
| Free disk | diskFree | GB (`scale = 1024**3`) | `--cinfra` |
| Disk operations | diskOps | ops/s | `--info`, `--orange` |
| Search rate | searchRate | per second | `--info`, `--cshared` |
| Search time | searchTime | ms | `--info`, `--orange` |
| Searches running at once | searchActive | count | `--info` |
| Waiting in queue | searchQueue | count | `--warning`, `--orange` |
| Rejected requests | rejected | count per interval | `--danger`, `--orange` |
| Indexing rate | indexRate | documents/s | `--orange` |
| Indexing time | indexTime | ms per document | `--orange` |
| Documents | docs | `compact()`, `zero={false}` | `--info` |
| Stored data | storeSize | GB, `zero={false}` | `--cinfra` |
| Shards | shards | count | `--success`, `--warning` |
| Segments | segments | count, `zero={false}` | `--c30` |
| Open files | openFiles | count | `--info` |
| Pending cluster tasks | pendingTasks | count | `--warning` |

Copy rules: plain words, no "JVM", "circuit breaker", "thread pool" or "fetch phase" in headings. Where a term needs
one line of help, use the card's `stat` slot (for example "Memory safety limit used" → stat "requests are refused at
100%").

### 8. `components/screens/elasticsearch/SlowLogPanel.tsx`

`useJson<SlowLogResp>(\`/api/elasticsearch/slowlog?hours=${hours}\`)`. A `Card` titled "Search slow log", one of:

- `not_configured` (today's state) — exact copy:
  - Heading: "Not available yet"
  - Body: "Elasticsearch writes its slow log to a file on its own server. That file is not sent anywhere this
    dashboard can read, so individual slow searches cannot be listed here. The charts below still show how many
    searches ran, how long they took on average, and whether any were queued or rejected."
  - "To turn this on:" 1. "On the Elasticsearch server, send the file ending in `_index_search_slowlog.json` into
    Elasticsearch with Filebeat or Elastic Agent (the Elasticsearch module's slow log setting)." 2. "Allow the
    dashboard's read-only login to search that index." 3. "In Settings, set `ES_SLOWLOG_INDEX` to the index name."
  - Note: "Only searches slower than the limits set on each index are logged."
- `ok`: sub-line "Slowest searches · last {windowHours}h · {total}{totalCapped ? '+' : ''} logged · from {index}";
  rows (`HeadRow` grid): Time (IST), Took, Index, Hits, Query (monospace, 2 lines, full text in `title`).
- `empty`: "No slow searches were logged in the last {windowHours}h in {index}."
- `error`: `Banner tone="var(--warning)"` with `message`.
- Footer link in every state: "Looking for slow database queries from the applications? Open Slow queries" →
  `/slow-queries`.

### 9. `app/elasticsearch/page.tsx`

Same shape as `app/slow-queries/page.tsx`: `export const dynamic = "force-dynamic"` and render
`<ElasticsearchMonitor />` (wrapped in `Suspense` inside the screen file if it uses `useSearchParams`; it does not
need to).

### 10. `components/shell/nav.ts`

In the "Compute" group, directly after the `/rds` "Databases" item and before `/slow-queries`, add
`{ href: "/elasticsearch", label: "Elasticsearch", icon: DatabaseZap }` and import `DatabaseZap` from
`lucide-react` (present in the installed version). Header title and command palette pick it up from `NAV`.

### 11. Verify (section below), report, and stop

Do not commit, merge, build in the live checkout or restart anything. If something is not covered by this plan,
stop and return the question.

## Expected Outcomes

- `/elasticsearch` is in the sidebar under Compute and renders header, six KPIs, detected issues, the slow log
  panel and 20 charts for 3h/6h/1d/3d/7d, with times in IST, in dark, light and at phone width.
- With today's data: status Yellow, three warnings (yellow on a single server, too many shards for the heap, free
  disk below 20%), no criticals.
- The slow log panel shows "Not available yet" with the three steps, and makes no Elasticsearch request.
- When Prometheus is unreachable the page shows one clear message with Retry; no TLS verification is disabled.
- `npx tsc --noEmit` passes; every new file is under 500 lines; no new dependency.

## Risks & Constraints

- **Live service.** The main checkout is production. Work only in the worktree. No `next build` / `next dev` in the
  live checkout, no restart, no commit or push without the user's say-so.
- **Uncommitted live change.** `components/screens/DatabaseDetail.tsx` is modified (28 lines removed) and
  uncommitted in the live checkout. This plan does not touch that file, so there is no conflict; keep it that way.
- **No extra load on Elasticsearch.** The metrics page talks to Prometheus only. The slow log reader is off until
  configured, then at most one small search per 10 minutes per window, 5 s server timeout, no aggregations, no retry.
- **Prometheus load.** About 29 range queries and 16 instant queries per uncached view, in batches of 8, cached 60 s
  per window. Do not shorten the steps in the table.
- **TLS.** No bypass of certificate checks anywhere. The certificate for `*.rwdomain.com` expires 7 Dec 2026; after
  that the page (and every other Prometheus screen) will show the "certificate has expired" message until renewed.
- **Slow log text can contain search terms** (possibly personal data). It is shown only to signed-in users,
  truncated to 1,500 characters, and never logged server-side.
- **Unverified reader.** The slow log field mapping follows the Filebeat/ECS layout but has not been tested on real
  data. It must fail to `empty` or `error`, never to made-up rows.
- **Which cluster.** `lib/elk.ts` may point at a different cluster from the one Prometheus monitors (see Analysis).
  Panel copy must not state which cluster the slow log comes from beyond the index name.
- **Per-shard timing.** `search_query_time / search_query_total` is time per shard-level search, not per user
  request; with 301 shards one request can be many shard searches. The KPI sub-line and chart stat say "per shard
  search".
- Existing behaviour of `lib/prometheus.ts`, `lib/elk.ts`, `/rds/[id]` and `/slow-queries` must not change.
- Do not add credential defaults; do not print credentials or secret values.

## Verification

1. `npx tsc --noEmit` in the worktree. `wc -l` on every new file (all under 500).
2. `npm run build` in the worktree only (never the live checkout).
3. Start the worktree build on port 3100 with a throwaway `NEXTAUTH_SECRET`, as in earlier runs. The main session
   runs the external Playwright harness with these mocks added:

   `GET /api/elasticsearch?hours=24` (use the same body for the other windows, changing `windowHours`/`stepSec`):

   ```json
   { "ok": true, "monitor": {
     "windowHours": 24, "stepSec": 600, "fetchedAt": "2026-11-12T10:10:00.000Z",
     "cluster": "elasticsearch", "version": "8.9.0", "target": "172.31.29.22:9114", "exporterUp": true,
     "lastScrapeAt": "2026-11-12T10:09:40.000Z", "status": "yellow",
     "nodes": [{ "name": "ip-172-31-29-22", "host": "172.31.29.22" }], "nodeCount": 1,
     "heapMaxBytes": 8589934592, "diskSizeBytes": 124678225920, "cpuCores": 2, "maxOpenFiles": 65535,
     "uptimeSec": 11337429, "restarts": 0,
     "shards": { "active": 301, "primary": 301, "unassigned": 89, "relocating": 0, "initializing": 0 },
     "readOnlyIndices": 0, "breakerTrips": [], "rejections": [],
     "series": {
       "cpu": [ { "label": "Elasticsearch", "points": [[1794441600000, 22], [1794442200000, 31]] },
                { "label": "Whole server", "points": [[1794441600000, 24], [1794442200000, 35]] } ],
       "heapPct": [ { "label": "Heap in use", "points": [[1794441600000, 58.0], [1794442200000, 63.2]] } ],
       "searchTime": [ { "label": "Search", "points": [[1794441600000, 0.27], [1794442200000, 0.31]] },
                       { "label": "Fetch", "points": [[1794441600000, 0.05], [1794442200000, 0.06]] } ],
       "rejected": null
     },
     "stats": { "cpu.Elasticsearch": { "avg": 26.5, "max": 31, "min": 22, "last": 31 },
                "heapPct.Heap in use": { "avg": 60.6, "max": 63.2, "min": 58, "last": 63.2 } },
     "failedQueries": [],
     "issues": [ { "severity": "warning", "title": "Cluster status is yellow",
                   "evidence": "89 backup copies cannot be placed because the cluster has only one server.",
                   "action": "All data is searchable, but there is no second copy." } ],
     "health": "attention" } }
   ```

   (The real mock should carry all 20 series keys with about 144 points each; `null` is valid for any key.)

   `GET /api/elasticsearch/slowlog?hours=24`, three variants:

   ```json
   { "state": "not_configured" }
   ```
   ```json
   { "state": "ok", "index": "es-slowlog-*", "windowHours": 24, "total": 37, "totalCapped": false,
     "fetchedAt": "2026-11-12T10:10:00.000Z",
     "entries": [ { "at": "2026-11-12T09:58:12.000Z", "tookMs": 4210, "index": "logs-tcp-default", "shard": "0",
                    "totalHits": "10000+ hits", "searchType": "QUERY_THEN_FETCH", "level": "WARN",
                    "query": "{\"query\":{\"match_phrase\":{\"message\":\"Read timed out\"}}}" } ] }
   ```
   ```json
   { "state": "error", "index": "es-slowlog-*", "message": "Index es-slowlog-* does not exist." }
   ```

   Also one failure mock for the main API: HTTP 502
   `{ "error": "Prometheus could not be reached: its security certificate has expired. Renew the certificate for prometheus.rwdomain.com." }`.

   Expect: page `ok` in dark/light at 1440 and 390 wide, `xoverflow=0`, no unmocked API call, range switch re-fetches
   with the new `hours`, refresh button re-fetches, the error mock shows `ErrorNote` with Retry, existing page and
   interaction checks still pass.
4. Logged out: `/elasticsearch` → 307 to `/login`; `/api/elasticsearch` and `/api/elasticsearch/slowlog` → 401.
5. Real-data check without a browser session: a `tsx` one-off (in the scratchpad, not the repo) that calls
   `getEsMonitor(24)` and `getEsMonitor(168)` and prints status, node count, each series key with its point count,
   `failedQueries`, the issues, and the elapsed time. Expect: status yellow, no failed queries, point counts near
   144 and 168, rules 4, 11 and 16 present, each call under about 5 s. Then call `fetchSlowLog(24)` with
   `ES_SLOWLOG_INDEX` unset and confirm `not_configured` and that no Elasticsearch request was made.
6. Stop the test server by exact PID from `ss -ltnp` on port 3100; confirm the live service has the same `MainPID`
   and `NRestarts=0`.
7. Report to the user and ask before committing, merging, building in the live checkout or restarting.

---

## AMENDMENT 1 (2026-11-12 16:20 IST) — the search slow log is readable. This section OVERRIDES steps 4 and 8, the `ES_SLOWLOG_INDEX` item in Scope, and the slow-log parts of Verification.

### New facts (verified with read-only requests)

- The user saved a production login in the secret store: `ELASTICSEARCH_HOST` (value is a URL with scheme and a trailing
  slash, e.g. `http://<ip>/`), `ELASTICSEARCH_PORT`, `ELASTICSEARCH_USER`, `ELASTICSEARCH_PASSWORD`. Base URL =
  host with trailing slashes removed + `:` + port (if the host has no scheme, prefix `http://`). This is the same
  cluster Prometheus monitors (cluster uuid matches, node `ip-172-31-29-22`, 8.9.0). It is NOT the cluster in
  `lib/elk.ts`; do not change `lib/elk.ts` and do not reuse `esSearch` from it.
- The slow log is shipped by Filebeat's elasticsearch module into data streams `slowlog-YYYY.MM.DD` (149 of them,
  current through today). They also hold GC and server logs, so every query MUST filter
  `{ "term": { "event.dataset": "elasticsearch.index_search_slowlog" } }` plus a `@timestamp` range.
- 7 days = 23,064 slow-log records (16,886 on 11 Nov; 500–1,300 on other days). An aggregation over 7 days took 165 ms.
- Fields (all flat dotted keys in `_source`): `@timestamp`, `log.level` (WARN / INFO / DEBUG),
  `elasticsearch.index.name` (keyword), `elasticsearch.slowlog.took_millis` (long), `elasticsearch.slowlog.took`
  (keyword, e.g. "39.8s"), `elasticsearch.slowlog.total_hits` (keyword, e.g. "10000+ hits"),
  `elasticsearch.slowlog.total_shards`, `elasticsearch.slowlog.search_type`, `elasticsearch.slowlog.source`
  (keyword, the query JSON with escaped quotes), `elasticsearch.slowlog.message` (e.g. "[idx_products][0]"),
  `event.duration` (long, nanoseconds).
- KNOWN QUIRK: a `percentiles`/`max` sub-aggregation on `elasticsearch.slowlog.took_millis` under a `terms` on
  `elasticsearch.index.name` returned 0 / null, while the same metrics at the top level worked (p50 3,137 ms, p95
  5,427 ms, p99 8,313 ms, max 39,887 ms). Investigate briefly (try `event.duration`, or a runtime fallback); if a
  per-index metric cannot be made reliable, compute per-index p95/max from the sampled rows and label it "from the
  slowest N sampled". Never show a 0 that means "unknown".
- The login's role `Read-only` allows `_search` on these streams, `_cluster/health`, `_nodes/stats`, `_tasks`,
  `_cat/thread_pool`, index settings. It is refused (403) on `_cat/indices` and `_stats`. Use only `_search` for
  the slow log; do not add other Elasticsearch calls to the page.
- The host is plain HTTP on a public IP. Do not log the URL with credentials, never send the password anywhere but
  the Authorization header, and never return host, user or password to the browser.

### Replacement for step 4 — `lib/esSlowlog.ts` and `app/api/elasticsearch/slowlog/route.ts`

- Config: the four `ELASTICSEARCH_*` keys (read `process.env` after `await ensureSecretsHydrated()`); optional
  `ES_SLOWLOG_INDEX` (default `slowlog-*`). Add all five to `MANAGED_KEYS` in `lib/secrets.ts` and to the list in
  `scripts/seed-secrets.mjs`. If host/user/password are missing return `{ state: "not_configured" }` without any request.
- A small private `search(body)` helper: POST `${base}/${index}/_search`, Basic auth, 10 s timeout, one attempt,
  `ignore_unavailable=true`. Map network errors / non-200 to `{ state: "error", message }` (plain words, no URL).
- Windows follow the page range selector (3h, 6h, 24h, 72h, 168h). Two requests per load, run sequentially:
  1. Aggregations (`size: 0`, `track_total_hits: true`): total; `date_histogram` trend (interval: 10m for 3h, 15m
     for 6h, 1h for 24h, 3h for 72h, 6h for 168h); top-level percentiles 50/95/99 and max of `took_millis`;
     `terms` on `log.level`; `terms` on `elasticsearch.index.name` size 15 (count, plus p95/max if the quirk is
     solved); `terms` on `elasticsearch.slowlog.search_type` size 5.
  2. Slowest rows: `size: 200`, sort `took_millis` desc, `_source` limited to the fields above.
- From the 200 sampled rows build "query shapes": parse `elasticsearch.slowlog.source` (unescape `\"`, JSON.parse
  in try/catch), replace every leaf value with `?`, keep keys and structure, collapse arrays of same-shaped items
  to one, and group by index + shape. Per group: count in sample, max and median took, example time, `size` and
  `from` values seen, flags (see rules). Keep the normalised shape (truncated to 600 chars) and one redacted
  example. Redaction: leaf string/number values in the example are replaced by `?` too — the query bodies can
  contain business identifiers, so do not return raw values to the browser.
- Rule-based findings (no AI), each with evidence and a suggested action in plain words:
  spike (one bucket/day holds > 50% of the window's total and total > 500); deep paging (`from` + `size` > 10,000 or
  `size` >= 10,000); leading-wildcard / `wildcard` / `regexp` / `query_string` with leading `*`; `script` in query
  or sort; aggregation-heavy (`size: 0` with `aggs`) taking > 5 s; one index holding > 50% of all slow searches;
  any search over 30 s. Thresholds as named constants.
- Response type `SlowLogResp`:
  `{ state: "ok", windowHours, fetchedAt, total, p50Ms, p95Ms, p99Ms, maxMs, levels: {warn, info, debug},
     trend: Array<[tsMs, count]>, byIndex: Array<{ index, count, p95Ms: number | null, maxMs: number | null, sampled: boolean }>,
     shapes: Array<{ index, shape, count, maxMs, medianMs, lastSeen, flags: string[] }>,
     slowest: Array<{ at, index, tookMs, totalHits, searchType, level, shape }>,   // top 25
     findings: Array<{ severity, title, evidence, action }>, sampleSize }`
  or `{ state: "not_configured" }` or `{ state: "error", message }`.
- Route: session check like the other routes; `?hours=` validated against the window list; `cached()` 5 minutes per
  window with in-flight de-duplication; do not cache `error` results; `?refresh=1` honoured at most once a minute.

### Replacement for step 8 — `components/screens/elasticsearch/SlowLogPanel.tsx` (split into two files if it nears 300 lines)

A section headed "Search slow log", below "Detected issues" and above the performance charts, following the page
range. Contents when `state: "ok"`:
1. A stat row: slow searches, typical (p50), p95, slowest — formatted in seconds above 1,000 ms.
2. Findings list (same visual style as "Detected issues"); hidden if none.
3. Trend chart "Slow searches over time" (existing `TimeChart`, IST labels).
4. Table "By index": index, count, share bar, p95, slowest. Show "—" for null metrics; if `sampled`, a caption says
   the timings come from the slowest sampled searches.
5. Table "Query patterns": index, pattern (monospace, 2-line clamp, full text in a sheet/dialog on click using an
   existing ui primitive), count in sample, median, slowest, flags as small badges. Caption: "Grouped from the
   200 slowest searches in this window, values removed."
6. Table "Slowest searches": time (IST), index, took, hits, level.
`not_configured`: one short card saying which four Settings keys are needed. `error`: `ErrorNote` with Retry.
Loading: skeleton rows. Empty (`total === 0`): "No slow searches recorded in this window."
The "Detected issues" card on the page stays Prometheus-only; do not merge the two lists.
Also add a one-line link under the page header to `/slow-queries` ("Application database trouble is on Slow queries").

### Verification changes

- Mocks: `/api/elasticsearch/slowlog` with the `ok` shape above (include at least 3 indices, 4 shapes with flags, 2
  findings, a 24-point trend with one spike), plus `not_configured` and `error` variants.
- Real-data check (one-off script outside the repo, in the scratchpad given by the main session): call the lib
  function for 24h and 168h, print totals, percentiles, top 5 indices, number of shapes and findings, and elapsed
  ms. Confirm no raw leaf values appear in `shapes`/`slowest` output (spot-check for digits-only or quoted
  literals), and that nothing prints the password or the Authorization header.
- Report the outcome of the per-index percentile quirk.
