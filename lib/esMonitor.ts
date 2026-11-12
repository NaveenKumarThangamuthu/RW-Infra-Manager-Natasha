/**
 * Elasticsearch cluster monitoring for /elasticsearch, read from Prometheus
 * (elasticsearch_exporter, job "elasticsearch"). Read-only PromQL only.
 *
 * Every query aggregates (sum/avg/max) so the page keeps working if more
 * nodes are added. Rules that turn these numbers into issues live in
 * lib/esMonitorIssues.ts.
 */
import { query, queryRange, type PromRangeSeries, type PromSample } from "@/lib/prometheus";
import { buildEsIssues } from "@/lib/esMonitorIssues";

export const ES_WINDOWS = [3, 6, 24, 72, 168] as const;

/** Step and rate window per page window. Scrape interval is 30 s, so rate windows stay >= 5m. */
const WINDOW_CFG: Record<number, { step: number; w: string }> = {
  3: { step: 120, w: "5m" },
  6: { step: 300, w: "5m" },
  24: { step: 600, w: "10m" },
  72: { step: 1800, w: "30m" },
  168: { step: 3600, w: "1h" },
};
const DEFAULT_JOB = "elasticsearch";
const JOB_RE = /^[A-Za-z0-9 _.-]{1,60}$/;
const HOST_RE = /^[A-Za-z0-9.-]{1,80}$/;
const BATCH = 8;

export interface EsLine { label: string; points: Array<[number, number]> } // [epoch ms, value]
export interface EsStat { avg: number | null; max: number | null; min: number | null; last: number | null }
export type EsSeriesKey =
  | "cpu" | "load" | "heapPct" | "gc" | "breakerPct" | "diskFree" | "diskOps"
  | "searchRate" | "searchTime" | "searchQueue" | "searchActive" | "rejected"
  | "indexRate" | "indexTime" | "docs" | "storeSize" | "shards" | "segments" | "openFiles" | "pendingTasks";
export interface EsIssue { severity: "critical" | "warning" | "info"; title: string; evidence: string; action: string }
export interface EsMonitor {
  windowHours: number; stepSec: number; fetchedAt: string;
  cluster: string; version: string | null; target: string | null; exporterUp: boolean;
  lastScrapeAt: string | null;
  status: "green" | "yellow" | "red" | "unknown";
  nodes: Array<{ name: string; host: string }>; nodeCount: number | null;
  heapMaxBytes: number | null; diskSizeBytes: number | null; cpuCores: number | null;
  maxOpenFiles: number | null; uptimeSec: number | null; restarts: number | null;
  shards: { active: number | null; primary: number | null; unassigned: number | null; relocating: number | null; initializing: number | null };
  readOnlyIndices: number | null;
  breakerTrips: Array<{ breaker: string; count: number }>;
  rejections: Array<{ pool: string; count: number }>;
  series: Record<EsSeriesKey, EsLine[] | null>;
  stats: Record<string, EsStat>;
  failedQueries: string[];
  issues: EsIssue[];
  health: "healthy" | "attention" | "critical";
}
/** Values the issue rules need that are not part of the response. */
export interface EsRuleExtras { nodeLow: number | null; nodeHigh: number | null; throttled: number | null }

/** One range query. `label` is fixed, or read from a metric label (one line per series). */
interface RangeDef { key: EsSeriesKey; label: string | { by: string }; q: string }

function rangeCatalogue(S: string, W: string): RangeDef[] {
  const rate = (m: string, extra = "") => `sum(rate(${m}{${S}${extra}}[${W}]))`;
  return [
    { key: "cpu", label: "Elasticsearch", q: `avg(elasticsearch_process_cpu_percent{${S}})` },
    { key: "cpu", label: "Whole server", q: `avg(elasticsearch_os_cpu_percent{${S}})` },
    { key: "load", label: "1 min", q: `avg(elasticsearch_os_load1{${S}})` },
    { key: "load", label: "5 min", q: `avg(elasticsearch_os_load5{${S}})` },
    { key: "load", label: "15 min", q: `avg(elasticsearch_os_load15{${S}})` },
    { key: "heapPct", label: "Heap in use", q: `100 * sum(elasticsearch_jvm_memory_used_bytes{${S},area="heap"}) / sum(elasticsearch_jvm_memory_max_bytes{${S},area="heap"})` },
    { key: "gc", label: { by: "gc" }, q: `1000 * sum by (gc) (rate(elasticsearch_jvm_gc_collection_seconds_sum{${S}}[${W}]))` },
    { key: "breakerPct", label: "Memory safety limit", q: `100 * max(elasticsearch_breakers_estimated_size_bytes{${S},breaker="parent"} / elasticsearch_breakers_limit_size_bytes{${S},breaker="parent"})` },
    { key: "diskFree", label: "Free disk", q: `sum(elasticsearch_filesystem_data_available_bytes{${S}})` },
    { key: "diskOps", label: "Reads", q: rate("elasticsearch_filesystem_io_stats_device_read_operations_count") },
    { key: "diskOps", label: "Writes", q: rate("elasticsearch_filesystem_io_stats_device_write_operations_count") },
    { key: "searchRate", label: "Searches", q: rate("elasticsearch_indices_search_query_total") },
    { key: "searchRate", label: "Fetches", q: rate("elasticsearch_indices_search_fetch_total") },
    { key: "searchTime", label: "Search", q: `1000 * ${rate("elasticsearch_indices_search_query_time_seconds")} / ${rate("elasticsearch_indices_search_query_total")}` },
    { key: "searchTime", label: "Fetch", q: `1000 * ${rate("elasticsearch_indices_search_fetch_time_seconds")} / ${rate("elasticsearch_indices_search_fetch_total")}` },
    { key: "searchQueue", label: "Search", q: `sum(elasticsearch_thread_pool_queue_count{${S},type="search"})` },
    { key: "searchQueue", label: "Write", q: `sum(elasticsearch_thread_pool_queue_count{${S},type="write"})` },
    { key: "searchActive", label: "Search", q: `sum(elasticsearch_thread_pool_active_count{${S},type="search"})` },
    { key: "rejected", label: "Search", q: `sum(increase(elasticsearch_thread_pool_rejected_count{${S},type="search"}[${W}]))` },
    { key: "rejected", label: "Write", q: `sum(increase(elasticsearch_thread_pool_rejected_count{${S},type="write"}[${W}]))` },
    { key: "indexRate", label: "Documents", q: rate("elasticsearch_indices_indexing_index_total") },
    { key: "indexTime", label: "Per document", q: `1000 * ${rate("elasticsearch_indices_indexing_index_time_seconds_total")} / ${rate("elasticsearch_indices_indexing_index_total")}` },
    { key: "docs", label: "Documents", q: `sum(elasticsearch_indices_docs{${S}})` },
    { key: "storeSize", label: "Stored data", q: `sum(elasticsearch_indices_store_size_bytes{${S}})` },
    { key: "shards", label: "Active", q: `sum(elasticsearch_cluster_health_active_shards{${S}})` },
    { key: "shards", label: "Unassigned", q: `sum(elasticsearch_cluster_health_unassigned_shards{${S}})` },
    { key: "segments", label: "Segments", q: `sum(elasticsearch_indices_segments_count{${S}})` },
    { key: "openFiles", label: "Open files", q: `sum(elasticsearch_process_open_files_count{${S}})` },
    { key: "pendingTasks", label: "Pending", q: `sum(elasticsearch_cluster_health_number_of_pending_tasks{${S}})` },
  ];
}

function instantCatalogue(S: string, H: string) {
  return {
    status: `elasticsearch_cluster_health_status{${S}} == 1`,
    lastScrape: `timestamp(elasticsearch_cluster_health_status{${S},color="green"})`,
    version: `elasticsearch_version{${S}}`,
    heapMax: `elasticsearch_jvm_memory_max_bytes{${S},area="heap"}`,
    nodeCount: `max(elasticsearch_cluster_health_number_of_nodes{${S}})`,
    nodeLow: `min_over_time(elasticsearch_cluster_health_number_of_nodes{${S}}[${H}])`,
    nodeHigh: `max_over_time(elasticsearch_cluster_health_number_of_nodes{${S}}[${H}])`,
    shards: `{__name__=~"elasticsearch_cluster_health_(active_shards|active_primary_shards|unassigned_shards|relocating_shards|initializing_shards)",${S}}`,
    diskSize: `sum(elasticsearch_filesystem_data_size_bytes{${S}})`,
    maxFiles: `max(elasticsearch_process_max_files_descriptors{${S}})`,
    uptime: `max(elasticsearch_jvm_uptime_seconds{${S}})`,
    restarts: `sum(resets(elasticsearch_jvm_uptime_seconds{${S}}[${H}]))`,
    breakers: `sum by (breaker) (increase(elasticsearch_breakers_tripped{${S}}[${H}])) > 0`,
    rejected: `sum by (type) (increase(elasticsearch_thread_pool_rejected_count{${S}}[${H}])) > 0`,
    readOnly: `max(elasticsearch_indices_settings_stats_read_only_indices{${S}})`,
    throttled: `max(max_over_time(elasticsearch_indices_indexing_is_throttled{${S}}[${H}]))`,
  };
}
type InstantKey = keyof ReturnType<typeof instantCatalogue>;

/** Run thunks in batches of BATCH with allSettled, so one failure never sinks the rest. */
async function settleInBatches<T>(jobs: Array<() => Promise<T>>): Promise<PromiseSettledResult<T>[]> {
  const out: PromiseSettledResult<T>[] = [];
  for (let i = 0; i < jobs.length; i += BATCH) {
    out.push(...(await Promise.allSettled(jobs.slice(i, i + BATCH).map((j) => j()))));
  }
  return out;
}

export function describePromError(e: unknown): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string; name?: string } };
  const code = err?.cause?.code ?? err?.cause?.name ?? err?.name;
  if (code === "CERT_HAS_EXPIRED") {
    return "Prometheus could not be reached: its security certificate has expired. Renew the certificate for prometheus.rwdomain.com.";
  }
  if (code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "TimeoutError") return "Prometheus did not answer.";
  return err?.message ?? String(e);
}

const toPoints = (s: PromRangeSeries): Array<[number, number]> =>
  s.values.map(([t, v]): [number, number] => [t * 1000, Number(v)]).filter(([, v]) => Number.isFinite(v));

function statOf(line: EsLine): EsStat {
  if (!line.points.length) return { avg: null, max: null, min: null, last: null };
  const v = line.points.map((p) => p[1]);
  return { avg: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max(...v), min: Math.min(...v), last: v[v.length - 1] };
}

const first = (r: PromSample[] | undefined): number | null => {
  const v = r?.[0] ? Number(r[0].value[1]) : NaN;
  return Number.isFinite(v) ? v : null;
};

async function fetchSeries(S: string, W: string, start: number, end: number, step: number) {
  const defs = rangeCatalogue(S, W);
  const results = await settleInBatches(defs.map((d) => () => queryRange(d.q, start, end, step)));
  const lines = new Map<EsSeriesKey, EsLine[]>();
  const failed = new Set<EsSeriesKey>();
  defs.forEach((d, i) => {
    const r = results[i];
    if (r.status === "rejected") { failed.add(d.key); return; }
    const got = typeof d.label === "string"
      ? r.value.slice(0, 1).map((s) => ({ label: d.label as string, points: toPoints(s) }))
      : r.value.map((s) => ({ label: s.metric[(d.label as { by: string }).by] ?? "?", points: toPoints(s) }));
    const keep = got.filter((l) => l.points.length > 0);
    if (keep.length) lines.set(d.key, [...(lines.get(d.key) ?? []), ...keep]);
  });
  const keys = Array.from(new Set(defs.map((d) => d.key)));
  const series = Object.fromEntries(keys.map((k) => [k, lines.get(k) ?? null])) as Record<EsSeriesKey, EsLine[] | null>;
  // A key is "failed" only when a query threw and nothing else filled it in.
  const failedQueries = keys.filter((k) => failed.has(k) && !lines.get(k));
  return { series, failedQueries };
}

async function fetchCpuCores(host: string | undefined): Promise<number | null> {
  if (!host || !HOST_RE.test(host)) return null;
  const re = host.replace(/\./g, "\\\\.");
  try {
    const v = first(await query(`count(node_cpu_seconds_total{instance=~"${re}:.*",mode="idle"})`));
    return v && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function getEsMonitor(hours: number): Promise<EsMonitor> {
  const cfg = WINDOW_CFG[hours] ?? WINDOW_CFG[24];
  const windowHours = WINDOW_CFG[hours] ? hours : 24;
  const job = process.env.ES_PROM_JOB;
  const S = `job="${job && JOB_RE.test(job) ? job : DEFAULT_JOB}"`;
  const end = Math.floor(Date.now() / 1000 / cfg.step) * cfg.step;
  const start = end - windowHours * 3600;

  let up: PromSample[];
  try {
    up = await query(`up{${S}}`);
  } catch (e) {
    throw new Error(describePromError(e));
  }

  const inst = instantCatalogue(S, `${windowHours}h`);
  const instKeys = Object.keys(inst) as InstantKey[];
  const [{ series, failedQueries }, instRes] = await Promise.all([
    fetchSeries(S, cfg.w, start, end, cfg.step),
    settleInBatches(instKeys.map((k) => () => query(inst[k]))),
  ]);
  const I = Object.fromEntries(instKeys.map((k, i) => [k, instRes[i].status === "fulfilled" ? instRes[i].value : undefined])) as Record<InstantKey, PromSample[] | undefined>;

  const nodes = (I.heapMax ?? []).map((s) => ({ name: s.metric.name ?? "?", host: s.metric.host ?? "" }));
  const heapVals = (I.heapMax ?? []).map((s) => Number(s.value[1])).filter(Number.isFinite);
  const shardOf = (name: string) => {
    const vals = (I.shards ?? []).filter((s) => s.metric.__name__ === `elasticsearch_cluster_health_${name}`).map((s) => Number(s.value[1]));
    return vals.length ? Math.max(...vals) : null;
  };
  const color = I.status?.[0]?.metric.color;
  const lastScrape = first(I.lastScrape);
  const stats: Record<string, EsStat> = {};
  for (const [key, lines] of Object.entries(series)) for (const l of lines ?? []) stats[`${key}.${l.label}`] = statOf(l);

  const base: Omit<EsMonitor, "issues" | "health"> = {
    windowHours, stepSec: cfg.step, fetchedAt: new Date().toISOString(),
    cluster: I.version?.[0]?.metric.cluster ?? I.status?.[0]?.metric.cluster ?? "elasticsearch",
    version: I.version?.[0]?.metric.version ?? null,
    target: up[0]?.metric.instance ?? null,
    exporterUp: up.some((s) => s.value[1] === "1"),
    lastScrapeAt: lastScrape != null ? new Date(lastScrape * 1000).toISOString() : null,
    status: color === "green" || color === "yellow" || color === "red" ? color : "unknown",
    nodes, nodeCount: first(I.nodeCount),
    heapMaxBytes: heapVals.length ? heapVals.reduce((a, b) => a + b, 0) : null,
    diskSizeBytes: first(I.diskSize),
    cpuCores: await fetchCpuCores(nodes[0]?.host),
    maxOpenFiles: first(I.maxFiles), uptimeSec: first(I.uptime), restarts: first(I.restarts),
    shards: { active: shardOf("active_shards"), primary: shardOf("active_primary_shards"), unassigned: shardOf("unassigned_shards"), relocating: shardOf("relocating_shards"), initializing: shardOf("initializing_shards") },
    readOnlyIndices: first(I.readOnly),
    breakerTrips: (I.breakers ?? []).map((s) => ({ breaker: s.metric.breaker ?? "?", count: Math.round(Number(s.value[1])) })).filter((b) => b.count > 0),
    rejections: (I.rejected ?? []).map((s) => ({ pool: s.metric.type ?? "?", count: Math.round(Number(s.value[1])) })).filter((r) => r.count > 0),
    series, stats, failedQueries,
  };
  const issues = buildEsIssues(base, { nodeLow: first(I.nodeLow), nodeHigh: first(I.nodeHigh), throttled: first(I.throttled) });
  const health = issues.some((i) => i.severity === "critical") ? "critical" : issues.some((i) => i.severity === "warning") ? "attention" : "healthy";
  return { ...base, issues, health };
}
