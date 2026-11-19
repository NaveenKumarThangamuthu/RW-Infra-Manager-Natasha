import { buildServiceLookup } from "@/lib/springLogNames";

export interface SpringServiceHealth {
  serviceName: string; job: string; instance: string; up: boolean; cpu: number | null;
  heapUsedBytes: number | null; heapMaxBytes: number | null; heapPct: number | null;
}
export interface HealthResp { ok: boolean; fetchedAt: string; services: SpringServiceHealth[] }
export interface LogServiceStat {
  service: string; total: number; errors: number; warns: number; errorRate: number; hosts: string[];
  latestError: { at: string | null; message: string } | null;
}
export interface LogResp { ok: boolean; fetchedAt: string; window: "1h" | "24h"; via: "lan" | "public" | "override"; services: LogServiceStat[] }
export interface LogEntry { at: string | null; host: string | null; file: string | null; message: string }
export interface LogDetailsResp { ok: boolean; service: string; window: string; total: number; truncated: boolean; entries: LogEntry[] }
export type DetailWindow = "15m" | "1h" | "6h" | "24h";
export type DetailState = LogDetailsResp | { loading: true } | { error: string };

/** Health-monitoring name → log-store entry. The matching rule lives in lib/springLogNames. */
export function buildLogLookup(services: LogServiceStat[]): (name: string) => LogServiceStat | undefined {
  return buildServiceLookup(services);
}

export interface LogBucket { key: string; count: number; sample: LogEntry; hosts: string[]; lastAt: string | null }

/** Dedupe log entries by first line, with volatile tokens (ids, timestamps, IPs, numbers) masked. */
export function dedupeEntries(entries: LogEntry[]): LogBucket[] {
  const buckets = new Map<string, LogBucket>();
  for (const e of entries) {
    const key = ((e.message ?? "").split("\n")[0] ?? "")
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
      .replace(/\b[0-9a-f]{16,}\b/gi, "<hash>")
      .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*Z?\b/g, "<ts>")
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "<ip>")
      .replace(/\b\d+\b/g, "<n>")
      .slice(0, 300);
    const b = buckets.get(key);
    if (b) {
      b.count++;
      if (e.host && !b.hosts.includes(e.host)) b.hosts.push(e.host);
      if (e.at && (!b.lastAt || e.at > b.lastAt)) b.lastAt = e.at;
    } else {
      buckets.set(key, { key, count: 1, sample: e, hosts: e.host ? [e.host] : [], lastAt: e.at });
    }
  }
  return Array.from(buckets.values()).sort((a, b) => b.count - a.count);
}

/** "Production Spring Services Metrics" → "Production". */
export const jobShortName = (job: string) => job.replace(/\s*Spring Services? Metrics\s*$/i, "") || job;
