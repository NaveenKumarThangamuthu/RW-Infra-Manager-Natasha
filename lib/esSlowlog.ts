/**
 * Elasticsearch search slow log for /elasticsearch, read with `_search` only
 * from the Filebeat data streams `slowlog-*` on the production cluster (the
 * one Prometheus monitors; NOT the cluster in lib/elk.ts).
 *
 * Each slow-log line is shipped twice into these streams (two pipelines read
 * the same file at the same offset): one copy carries
 * `elasticsearch.slowlog.took_millis` and no index name, the other carries
 * `elasticsearch.index.name` and `event.duration` (ns). Counting both doubles
 * every total, and per-index metrics on `took_millis` come back empty because
 * no document has both fields. So every query keeps only the copy that has
 * `elasticsearch.index.name` and times come from `event.duration`.
 *
 * Credentials and host never leave the server and are never logged.
 */
import { buildFindings, buildShapes, type SlowFinding, type SlowRow } from "@/lib/esSlowlogShapes";

export const SLOWLOG_WINDOWS = [3, 6, 24, 72, 168] as const;
const INTERVAL: Record<number, { es: string; label: string }> = {
  3: { es: "10m", label: "10 minutes" },
  6: { es: "15m", label: "15 minutes" },
  24: { es: "1h", label: "hour" },
  72: { es: "3h", label: "3 hours" },
  168: { es: "6h", label: "6 hours" },
};
const DEFAULT_INDEX = "slowlog-*";
const INDEX_RE = /^[a-z0-9][a-z0-9._*,-]{0,120}$/;
const DATASET = "elasticsearch.index_search_slowlog";
const COPY_FIELD = "elasticsearch.index.name";
const DURATION_FIELD = "event.duration";
const NS_PER_MS = 1e6;
const TIMEOUT_MS = 10_000;
const SAMPLE_SIZE = 200;
const TOP_SLOWEST = 25;
const TOP_INDICES = 15;

export interface SlowLogOk {
  state: "ok"; windowHours: number; fetchedAt: string;
  total: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null; maxMs: number | null;
  levels: { warn: number; info: number; debug: number };
  searchTypes: Array<{ type: string; count: number }>;
  trend: Array<[number, number]>;
  byIndex: Array<{ index: string; count: number; p95Ms: number | null; maxMs: number | null; sampled: boolean }>;
  shapes: Array<{ index: string; shape: string; example: string; count: number; maxMs: number; medianMs: number; lastSeen: string; sizes: number[]; froms: number[]; flags: string[] }>;
  slowest: Array<{ at: string; index: string; tookMs: number; totalHits: string | null; searchType: string | null; level: string | null; shape: string }>;
  findings: SlowFinding[];
  sampleSize: number;
}
export type SlowLogResp = SlowLogOk | { state: "not_configured" } | { state: "error"; message: string };

interface Conf { base: string; auth: string; index: string }
type SearchResult = { ok: true; body: EsBody } | { ok: false; message: string };
interface Bucket { key: string | number; doc_count: number; [k: string]: unknown }
interface EsBody {
  hits?: { total?: { value?: number }; hits?: Array<{ _source?: Record<string, unknown> }> };
  aggregations?: Record<string, { buckets?: Bucket[]; value?: number | null; values?: Record<string, number | null> }>;
  error?: { reason?: string; type?: string } | string;
}

function config(): Conf | "not_configured" | "bad_index" {
  const host = process.env.ELASTICSEARCH_HOST?.trim();
  const port = process.env.ELASTICSEARCH_PORT?.trim();
  const user = process.env.ELASTICSEARCH_USER;
  const pass = process.env.ELASTICSEARCH_PASSWORD;
  if (!host || !user || !pass) return "not_configured";
  const index = process.env.ES_SLOWLOG_INDEX?.trim() || DEFAULT_INDEX;
  if (!INDEX_RE.test(index)) return "bad_index";
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(host) ? host : `http://${host}`);
  } catch {
    return "not_configured";
  }
  if (port && !url.port) url.port = port;
  return { base: url.origin, auth: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`, index };
}

/** One POST to `_search`, one attempt, 10 s timeout. Errors are plain words without the URL. */
async function search(c: Conf, body: object): Promise<SearchResult> {
  let res: Response;
  try {
    res = await fetch(`${c.base}/${c.index}/_search?ignore_unavailable=true`, {
      method: "POST",
      headers: { Authorization: c.auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    return { ok: false, message: name === "TimeoutError" ? "Elasticsearch did not answer within 10 seconds." : "Elasticsearch could not be reached." };
  }
  const json = (await res.json().catch(() => null)) as EsBody | null;
  if (res.ok && json) return { ok: true, body: json };
  if (res.status === 401) return { ok: false, message: "Elasticsearch refused the dashboard's login. Check ELASTICSEARCH_USER and ELASTICSEARCH_PASSWORD in Settings." };
  if (res.status === 403) return { ok: false, message: `The Elasticsearch login used by this dashboard is not allowed to read ${c.index}.` };
  if (res.status === 404) return { ok: false, message: `Index ${c.index} does not exist.` };
  const reason = typeof json?.error === "string" ? json.error : json?.error?.reason ?? json?.error?.type ?? "";
  return { ok: false, message: `Elasticsearch returned HTTP ${res.status}${reason ? `: ${reason}` : ""}`.slice(0, 200) };
}

/** Read a field from `_source` whether it is stored as nested objects or flat dotted keys. */
function pick(src: unknown, path: string): unknown {
  if (!src || typeof src !== "object") return undefined;
  const o = src as Record<string, unknown>;
  if (path in o) return o[path];
  const parts = path.split(".");
  for (let i = 1; i < parts.length; i++) {
    const head = parts.slice(0, i).join(".");
    if (head in o) {
      const v = pick(o[head], parts.slice(i).join("."));
      if (v !== undefined) return v;
    }
  }
  return undefined;
}
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? null : String(v));
const nsToMs = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v / NS_PER_MS : null);

function filters(hours: number) {
  return [
    { term: { "event.dataset": DATASET } },
    { exists: { field: COPY_FIELD } },
    { range: { "@timestamp": { gte: `now-${hours}h` } } },
  ];
}

function aggBody(hours: number) {
  const pcts = { field: DURATION_FIELD, percents: [50, 95, 99] };
  return {
    size: 0, track_total_hits: true, timeout: "8s",
    query: { bool: { filter: filters(hours) } },
    aggs: {
      trend: { date_histogram: { field: "@timestamp", fixed_interval: INTERVAL[hours].es, time_zone: "Asia/Kolkata", min_doc_count: 0, extended_bounds: { min: `now-${hours}h`, max: "now" } } },
      pct: { percentiles: pcts },
      mx: { max: { field: DURATION_FIELD } },
      lvl: { terms: { field: "log.level", size: 5 } },
      typ: { terms: { field: "elasticsearch.slowlog.search_type", size: 5 } },
      idx: {
        terms: { field: COPY_FIELD, size: TOP_INDICES },
        aggs: { p: { percentiles: { field: DURATION_FIELD, percents: [95] } }, mx: { max: { field: DURATION_FIELD } } },
      },
    },
  };
}

function rowsBody(hours: number) {
  return {
    size: SAMPLE_SIZE, timeout: "8s", track_total_hits: false,
    query: { bool: { filter: filters(hours) } },
    sort: [{ [DURATION_FIELD]: { order: "desc" } }],
    _source: ["@timestamp", "log.level", COPY_FIELD, DURATION_FIELD, "elasticsearch.slowlog.total_hits", "elasticsearch.slowlog.search_type", "elasticsearch.slowlog.source"],
  };
}

function toRows(body: EsBody): SlowRow[] {
  return (body.hits?.hits ?? []).flatMap((h) => {
    const s = h._source;
    const tookMs = nsToMs(pick(s, DURATION_FIELD) as number);
    const at = str(pick(s, "@timestamp"));
    if (tookMs == null || !at) return [];
    return [{
      at, tookMs, index: str(pick(s, COPY_FIELD)) ?? "?",
      totalHits: str(pick(s, "elasticsearch.slowlog.total_hits")), searchType: str(pick(s, "elasticsearch.slowlog.search_type")),
      level: str(pick(s, "log.level")), source: str(pick(s, "elasticsearch.slowlog.source")),
    }];
  });
}

/** p95 of a list (nearest rank), used only when the per-index aggregation came back empty. */
function p95(v: number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}

export async function fetchSlowLog(hours: number): Promise<SlowLogResp> {
  const windowHours = INTERVAL[hours] ? hours : 24;
  const c = config();
  if (c === "not_configured") return { state: "not_configured" };
  if (c === "bad_index") return { state: "error", message: "ES_SLOWLOG_INDEX in Settings is not a valid index name or pattern." };

  const agg = await search(c, aggBody(windowHours));
  if (!agg.ok) return { state: "error", message: agg.message };
  const a = agg.body.aggregations ?? {};
  const total = agg.body.hits?.total?.value ?? 0;
  const rowsRes = total > 0 ? await search(c, rowsBody(windowHours)) : null;
  if (rowsRes && !rowsRes.ok) return { state: "error", message: rowsRes.message };
  const rows = rowsRes?.ok ? toRows(rowsRes.body) : [];

  const lv = new Map((a.lvl?.buckets ?? []).map((b) => [String(b.key).toUpperCase(), b.doc_count]));
  const byIndex = (a.idx?.buckets ?? []).map((b) => {
    const p = nsToMs((b.p as { values?: Record<string, number | null> })?.values?.["95.0"]);
    const m = nsToMs((b.mx as { value?: number | null })?.value);
    if (p != null && m != null) return { index: String(b.key), count: b.doc_count, p95Ms: p, maxMs: m, sampled: false };
    const mine = rows.filter((r) => r.index === b.key).map((r) => r.tookMs);
    return { index: String(b.key), count: b.doc_count, p95Ms: p95(mine), maxMs: mine.length ? Math.max(...mine) : null, sampled: mine.length > 0 };
  });
  const trend = (a.trend?.buckets ?? []).map((b): [number, number] => [Number(b.key), b.doc_count]);
  const { shapes, rowShape } = buildShapes(rows);
  const maxMs = nsToMs(a.mx?.value);

  return {
    state: "ok", windowHours, fetchedAt: new Date().toISOString(), total,
    p50Ms: nsToMs(a.pct?.values?.["50.0"]), p95Ms: nsToMs(a.pct?.values?.["95.0"]), p99Ms: nsToMs(a.pct?.values?.["99.0"]), maxMs,
    levels: { warn: lv.get("WARN") ?? 0, info: lv.get("INFO") ?? 0, debug: lv.get("DEBUG") ?? 0 },
    searchTypes: (a.typ?.buckets ?? []).map((b) => ({ type: String(b.key), count: b.doc_count })),
    trend, byIndex, shapes,
    slowest: rows.slice(0, TOP_SLOWEST).map((r, i) => ({ at: r.at, index: r.index, tookMs: r.tookMs, totalHits: r.totalHits, searchType: r.searchType, level: r.level, shape: rowShape[i] })),
    findings: buildFindings({ windowHours, total, maxMs, interval: INTERVAL[windowHours].label, trend, byIndex, shapes, rows }),
    sampleSize: rows.length,
  };
}
