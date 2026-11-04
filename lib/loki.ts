/**
 * Loki client — LogQL queries against a Grafana Loki server.
 * Reads LOKI_URL (default http://3.144.78.177:3100). Read-only HTTP GET only.
 */
const DEFAULT_LOKI = "http://3.144.78.177:3100";

function base(): string {
  return (process.env.LOKI_URL ?? DEFAULT_LOKI).replace(/\/$/, "");
}

export interface LokiStream {
  stream: Record<string, string>;
  values: Array<[string, string]>;
}
export interface LokiQueryResult {
  status: string;
  data: {
    resultType: string;
    result: LokiStream[];
    stats?: Record<string, unknown>;
  };
}

async function fetchLoki<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(path, base());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`loki ${path} → HTTP ${r.status}`);
  return (await r.json()) as T;
}

export async function ready(): Promise<boolean> {
  try {
    const r = await fetch(`${base()}/ready`, { signal: AbortSignal.timeout(5_000) });
    return r.ok;
  } catch {
    return false;
  }
}

export interface LokiQueryOpts {
  query: string;
  startSec?: number;   // unix seconds
  endSec?: number;
  limit?: number;
  direction?: "forward" | "backward";
}

/** Query a time range. Timestamps in ns. */
export async function queryRange(opts: LokiQueryOpts): Promise<LokiQueryResult> {
  const end = opts.endSec ?? Math.floor(Date.now() / 1000);
  const start = opts.startSec ?? end - 3600; // default: last hour
  return fetchLoki<LokiQueryResult>("/loki/api/v1/query_range", {
    query: opts.query,
    start: `${start}000000000`,
    end: `${end}000000000`,
    limit: String(opts.limit ?? 500),
    direction: opts.direction ?? "backward",
  });
}

export async function listLabels(): Promise<string[]> {
  const j = await fetchLoki<{ data: string[] }>("/loki/api/v1/labels", {});
  return j.data ?? [];
}

export async function labelValues(label: string): Promise<string[]> {
  const j = await fetchLoki<{ data: string[] }>(`/loki/api/v1/label/${encodeURIComponent(label)}/values`, {});
  return j.data ?? [];
}

/** Convenience: flatten a query result to a chronological list of entries. */
export interface LokiEntry {
  timeNs: string; // string to avoid JS float precision loss
  timeMs: number;
  message: string;
  labels: Record<string, string>;
}
export function flattenEntries(r: LokiQueryResult): LokiEntry[] {
  const out: LokiEntry[] = [];
  for (const s of r.data.result) {
    for (const [ns, msg] of s.values) {
      out.push({
        timeNs: ns,
        timeMs: Math.floor(Number(ns) / 1_000_000),
        message: msg,
        labels: s.stream,
      });
    }
  }
  out.sort((a, b) => b.timeMs - a.timeMs); // newest first
  return out;
}

/** Loki severity heuristic — parses common Java/Spring log formats. */
export function guessSeverity(msg: string): "SEVERE" | "ERROR" | "WARN" | "INFO" | "FINE" | "DEBUG" | "TRACE" | "OTHER" {
  if (/\bSEVERE\b|\bFATAL\b/i.test(msg)) return "SEVERE";
  if (/\bERROR\b|\bEXCEPTION\b/.test(msg)) return "ERROR";
  if (/\bWARN(ING)?\b/.test(msg)) return "WARN";
  if (/\bINFO\b/.test(msg)) return "INFO";
  if (/\bFINE\b/.test(msg)) return "FINE";
  if (/\bDEBUG\b/.test(msg)) return "DEBUG";
  if (/\bTRACE\b/.test(msg)) return "TRACE";
  return "OTHER";
}
