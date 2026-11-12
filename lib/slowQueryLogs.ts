/**
 * Database trouble in the Spring service logs (DEV ELK) for the Slow queries page.
 *
 * Elasticsearch holds no slow-query log, only application logs, so this counts
 * the lines that signal database or downstream trouble (failed statements,
 * deadlocks, lock waits, MongoDB unreachable, service-call timeouts) and parses
 * a bounded sample of lines for statements and timings.
 *
 * The cluster runs close to its heap limit. Every query is small, carries a
 * time range and `timeout`, and the per-kind queries run one after another,
 * never in parallel. A kind whose query times out or fails is returned with
 * `partial: true` rather than a misleading zero.
 */
import { esSearch, SPRING_LOG_INDEX, withRetry } from "@/lib/elk";
import {
  buildNotes, groupStatements, isReingested, parsePrefix, redact, scrub, summariseOperations, timeoutTargets,
  type Note, type OperationRow, type RawLine, type StatementGroup, type TimeoutTarget,
} from "@/lib/slowQueryParse";

export type Kind = "sqlFailed" | "deadlock" | "lockWait" | "readTimeout" | "mongoNoServer" | "connPool" | "linkFailure" | "tooMany";
export type Range = "1h" | "6h" | "24h";

type Clause = Record<string, unknown>;
const phrase = (p: string): Clause => ({ match_phrase: { message: p } });

export const KINDS: Array<{ key: Kind; label: string; clause: Clause }> = [
  { key: "sqlFailed", label: "Failed SQL statements", clause: phrase("PreparedStatementCallback") },
  { key: "deadlock", label: "Deadlocks", clause: phrase("Deadlock found") },
  { key: "lockWait", label: "Lock wait timeouts", clause: phrase("Lock wait timeout") },
  { key: "readTimeout", label: "Service call timeouts", clause: phrase("Read timed out") },
  // The single-token match is far cheaper than the phrase "No server chosen".
  { key: "mongoNoServer", label: "MongoDB unreachable", clause: { match: { message: "ReadPreferenceServerSelector" } } },
  { key: "connPool", label: "Connection pool exhausted", clause: phrase("Connection is not available") },
  { key: "linkFailure", label: "Database link failures", clause: phrase("Communications link failure") },
  { key: "tooMany", label: "Too many connections", clause: phrase("Too many connections") },
];
const KIND_BY_KEY = Object.fromEntries(KINDS.map((k) => [k.key, k])) as Record<Kind, (typeof KINDS)[number]>;

const HOUR = 3_600_000;
export const RANGES: Record<Range, { ms: number; intervalMs: number; interval: string; slices: number }> = {
  "1h": { ms: HOUR, intervalMs: 5 * 60_000, interval: "5m", slices: 3 },
  "6h": { ms: 6 * HOUR, intervalMs: 30 * 60_000, interval: "30m", slices: 6 },
  "24h": { ms: 24 * HOUR, intervalMs: HOUR, interval: "1h", slices: 6 },
};

const INDEX = SPRING_LOG_INDEX + "*";
const ES_TIMEOUT = "8s";
const LAN_TIMEOUT_MS = 9_000;
const SERVICE_TERMS = 12;
const STATEMENT_SAMPLE = 300;
const TIMING_SLICE_SAMPLE = 300;
const DURATION_SAMPLE = 500;
const TIMEOUT_SAMPLE = 200;
const DETAIL_SAMPLE = 50;
// Stay well inside the route's 60 s maxDuration even when the cluster is slow.
const BUDGET_MS = 40_000;

export interface KindResult {
  key: Kind; label: string; total: number; partial: boolean; error?: string;
  trend: number[]; services: Array<{ service: string; count: number }>;
}
export interface LogsResp {
  ok: true; range: Range; fetchedAt: string; via: string | null; cached: boolean;
  buckets: string[];
  kinds: KindResult[];
  statements: { sampled: number; error?: string; groups: StatementGroup[] };
  timeoutTargets: TimeoutTarget[];
  operations: { sampled: number; error?: string; rows: OperationRow[] };
  notes: Note[];
}
export interface SampleEntry {
  at: string | null; loggedAt: string | null; reingested: boolean; service: string;
  host: string | null; level: string | null; logger: string | null; message: string;
}
export interface SamplesResp { ok: true; kind: Kind; total: number; truncated: boolean; entries: SampleEntry[] }

interface HitSource { "@timestamp"?: string; message?: string; dissect?: { service?: string }; host?: { name?: string } }
interface SearchResp {
  timed_out?: boolean;
  hits: { total?: { value: number; relation: string }; hits: Array<{ _source: HitSource }> };
  aggregations?: {
    trend?: { buckets: Array<{ key: number; doc_count: number }> };
    services?: { buckets: Array<{ key: string; doc_count: number }> };
  };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const rangeFilter = (gte: string, lte: string): Clause => ({ range: { "@timestamp": { gte, lte } } });
const toLine = (s: HitSource): RawLine => ({ message: s.message ?? "", service: s.dissect?.service ?? "unknown", at: s["@timestamp"] ?? null, host: s.host?.name ?? null });

/** The LAN URL answered with an HTTP error: the cluster is up but shedding load. */
const clusterAnswered = (e: unknown) => /LAN: ES \d{3}/.test(errText(e)) || /^ES \d{3}/.test(errText(e));

class Session {
  via: string | null = null;
  readonly started = Date.now();
  async search(body: Clause): Promise<SearchResp> {
    const { data, via } = await withRetry(() => esSearch<SearchResp>(INDEX, body, { timeoutMs: LAN_TIMEOUT_MS }), 2, 1_500);
    this.via ??= via;
    return data;
  }
  get overBudget() { return Date.now() - this.started > BUDGET_MS; }
}

async function countKind(s: Session, kind: (typeof KINDS)[number], gte: string, lte: string, cfg: (typeof RANGES)[Range], starts: number[]): Promise<KindResult> {
  const base: KindResult = { key: kind.key, label: kind.label, total: 0, partial: true, trend: starts.map(() => 0), services: [] };
  if (s.overBudget) return { ...base, error: "Skipped: Elasticsearch was too slow for this request." };
  try {
    const data = await s.search({
      size: 0, timeout: ES_TIMEOUT, track_total_hits: true,
      query: { bool: { filter: [rangeFilter(gte, lte), kind.clause] } },
      aggs: {
        trend: { date_histogram: { field: "@timestamp", fixed_interval: cfg.interval, min_doc_count: 0 } },
        services: { terms: { field: "dissect.service", size: SERVICE_TERMS } },
      },
    });
    const trend = starts.map(() => 0);
    for (const b of data.aggregations?.trend?.buckets ?? []) {
      const i = Math.floor((b.key - starts[0]) / cfg.intervalMs);
      if (i >= 0 && i < trend.length) trend[i] += b.doc_count;
    }
    return {
      ...base, partial: !!data.timed_out, total: data.hits.total?.value ?? 0, trend,
      services: (data.aggregations?.services?.buckets ?? []).map((b) => ({ service: b.key, count: b.doc_count })),
    };
  } catch (e) {
    // Nothing has answered yet and the cluster is unreachable: fail the request, not just this kind.
    if (s.via == null && !clusterAnswered(e)) throw e;
    return { ...base, error: errText(e) };
  }
}

async function sampleLines(s: Session, clauses: Clause[], gte: string, lte: string, size: number): Promise<RawLine[]> {
  const data = await s.search({
    size, timeout: ES_TIMEOUT, track_total_hits: false, sort: [{ "@timestamp": "desc" }],
    _source: ["@timestamp", "message", "dissect.service", "host.name"],
    query: { bool: { filter: [rangeFilter(gte, lte), ...clauses] } },
  });
  return data.hits.hits.map((h) => toLine(h._source));
}

async function timingLines(s: Session, from: number, to: number, slices: number): Promise<RawLine[]> {
  const out: RawLine[] = [];
  const step = (to - from) / slices;
  for (let i = 0; i < slices && !s.overBudget; i++) {
    const lte = new Date(to - i * step).toISOString(), gte = new Date(to - (i + 1) * step).toISOString();
    out.push(...await sampleLines(s, [phrase("TIMING"), phrase("took")], gte, lte, TIMING_SLICE_SAMPLE));
  }
  return out;
}

async function guarded<T>(s: Session, fallback: T, fn: () => Promise<T>): Promise<{ value: T; error?: string }> {
  if (s.overBudget) return { value: fallback, error: "Skipped: Elasticsearch was too slow for this request." };
  try {
    return { value: await fn() };
  } catch (e) {
    return { value: fallback, error: errText(e) };
  }
}

export async function fetchLogTrouble(range: Range): Promise<LogsResp> {
  const cfg = RANGES[range];
  const now = Date.now();
  const first = Math.floor((now - cfg.ms) / cfg.intervalMs) * cfg.intervalMs;
  const starts: number[] = [];
  for (let t = first; t <= now; t += cfg.intervalMs) starts.push(t);
  const gte = new Date(now - cfg.ms).toISOString(), lte = new Date(now).toISOString();
  const s = new Session();

  const kinds: KindResult[] = [];
  for (const kind of KINDS) kinds.push(await countKind(s, kind, gte, lte, cfg, starts));

  const sql = await guarded(s, [] as RawLine[], () => sampleLines(s, [KIND_BY_KEY.sqlFailed.clause], gte, lte, STATEMENT_SAMPLE));
  const timing = await guarded(s, [] as RawLine[], () => timingLines(s, now - cfg.ms, now, cfg.slices));
  const duration = await guarded(s, [] as RawLine[], () => sampleLines(s, [phrase("Duration"), phrase("sec")], gte, lte, DURATION_SAMPLE));
  const timeouts = await guarded(s, [] as RawLine[], () => sampleLines(s, [KIND_BY_KEY.readTimeout.clause], gte, lte, TIMEOUT_SAMPLE));

  const groups = groupStatements(sql.value);
  const targets = timeoutTargets(timeouts.value);
  const rows = summariseOperations([...timing.value, ...duration.value]);
  const notes = buildNotes({
    totals: Object.fromEntries(kinds.map((k) => [k.key, k.total])),
    kindServices: Object.fromEntries(kinds.map((k) => [k.key, k.services])),
    groups, targets, operations: rows,
  });

  return {
    ok: true, range, fetchedAt: new Date().toISOString(), via: s.via, cached: false,
    buckets: starts.map((t) => new Date(t).toISOString()),
    kinds,
    statements: { sampled: sql.value.length, error: sql.error, groups },
    timeoutTargets: targets,
    operations: { sampled: timing.value.length + duration.value.length, error: timing.error ?? duration.error, rows },
    notes,
  };
}

export async function fetchSamples(kind: Kind, range: Range, service?: string | null): Promise<SamplesResp> {
  const now = Date.now();
  const filter: Clause[] = [rangeFilter(new Date(now - RANGES[range].ms).toISOString(), new Date(now).toISOString()), KIND_BY_KEY[kind].clause];
  if (service) filter.push({ term: { "dissect.service": service } });
  const data = await new Session().search({
    size: DETAIL_SAMPLE, timeout: ES_TIMEOUT, track_total_hits: true, sort: [{ "@timestamp": "desc" }],
    _source: ["@timestamp", "message", "dissect.service", "host.name"],
    query: { bool: { filter } },
  });
  const entries = data.hits.hits.map((h): SampleEntry => {
    const line = toLine(h._source);
    const p = parsePrefix(line.message);
    return {
      at: line.at, loggedAt: p.loggedAt, reingested: isReingested(p.loggedAt, line.at), service: line.service,
      host: line.host ? scrub(line.host) : null, level: p.level, logger: p.logger, message: redact(p.body),
    };
  });
  const total = data.hits.total?.value ?? entries.length;
  return { ok: true, kind, total, truncated: total > entries.length, entries };
}

export const isRange = (v: string | null): v is Range => v != null && Object.prototype.hasOwnProperty.call(RANGES, v);
export const isKind = (v: string | null): v is Kind => v != null && Object.prototype.hasOwnProperty.call(KIND_BY_KEY, v);
