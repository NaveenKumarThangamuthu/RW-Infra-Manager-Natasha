/** Client-side copies of the /api/elasticsearch and /api/elasticsearch/slowlog response types. */
import { MONTHS_SHORT } from "@/components/natasha/format";

export interface EsLine { label: string; points: Array<[number, number]> }
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
  series: Partial<Record<EsSeriesKey, EsLine[] | null>>;
  stats: Record<string, EsStat>;
  failedQueries: string[];
  issues: EsIssue[];
  health: "healthy" | "attention" | "critical";
}

export interface SlowFinding { severity: "critical" | "warning" | "info"; title: string; evidence: string; action: string }
export interface SlowShape { index: string; shape: string; example: string; count: number; maxMs: number; medianMs: number; lastSeen: string; sizes: number[]; froms: number[]; flags: string[] }
export interface SlowEntry { at: string; index: string; tookMs: number; totalHits: string | null; searchType: string | null; level: string | null; shape: string }
export interface SlowLogOk {
  state: "ok"; windowHours: number; fetchedAt: string;
  total: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null; maxMs: number | null;
  levels: { warn: number; info: number; debug: number };
  searchTypes: Array<{ type: string; count: number }>;
  trend: Array<[number, number]>;
  byIndex: Array<{ index: string; count: number; p95Ms: number | null; maxMs: number | null; sampled: boolean }>;
  shapes: SlowShape[];
  slowest: SlowEntry[];
  findings: SlowFinding[];
  sampleSize: number;
}
export type SlowLogResp = SlowLogOk | { state: "not_configured" } | { state: "error"; message: string };

export const RANGES = [["3h", 3, "last 3h"], ["6h", 6, "last 6h"], ["1d", 24, "last 24h"], ["3d", 72, "last 3 days"], ["7d", 168, "last 7 days"]] as const;
export type RangeKey = (typeof RANGES)[number][0];

export const IST_MS = 330 * 60_000;
const p2 = (v: number) => String(v).padStart(2, "0");

/** Fixed +05:30 labels: "HH:mm" (or "Mon D" for long windows) and "Mon D, HH:mm IST" for hover. */
export function istParts(ts: number) {
  const t = new Date(ts + IST_MS);
  return { hm: `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`, dd: `${MONTHS_SHORT[t.getUTCMonth()]} ${t.getUTCDate()}` };
}
export function istLabels(ts: number[], long: boolean) {
  return {
    labels: ts.map((x) => { const m = istParts(x); return long ? m.dd : m.hm; }),
    full: ts.map((x) => { const m = istParts(x); return `${m.dd}, ${m.hm} IST`; }),
  };
}

/** Milliseconds as "3.5 s" from 1,000 ms up, else "840 ms". */
export function dur(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  // 9,950 ms and up rounds to whole seconds, so "10.0 s" never sits beside "10 s".
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 9_950 ? 0 : 1)} s` : `${Math.round(ms)} ms`;
}
