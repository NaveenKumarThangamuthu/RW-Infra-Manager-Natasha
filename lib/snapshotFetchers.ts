/**
 * Live-fetch routines for each source. Called by /api/refresh/snapshot.
 * Each fetcher returns the payload that will be JSON.stringify'd and stored.
 */
import { getSpringServicesHealth, alerts as promAlerts } from "@/lib/prometheus";
import { listAllInstancesHealth, listAllVolumes } from "@/lib/ec2Health";
import { listOpenAlarms } from "@/lib/cloudwatchAlarms";
import { esSearch, SPRING_LOG_INDEX, withRetry } from "@/lib/elk";
import { analyzeAllInstances } from "@/lib/recommendations";
import { listOhioLambdas } from "@/lib/lambdaOhio";
import { LOG_LEVEL_RUNTIME, levelFilters } from "./springLogLevel";

/** The level searches run a small script per matching line, so they get more time than the default. */
const LEVEL_QUERY_TIMEOUT_MS = 15_000;
/** How far back a service must have logged to count as known to the log store. */
const KNOWN_SERVICE_WINDOW = "now-7d";

export interface FetchOutcome<T> { payload: T; via: string | null; fetchMs: number }

async function timed<T>(fn: () => Promise<{ payload: T; via?: string | null }>): Promise<FetchOutcome<T>> {
  const t0 = Date.now();
  const { payload, via } = await fn();
  return { payload, via: via ?? null, fetchMs: Date.now() - t0 };
}

export function fetchSpringHealth() {
  return timed(async () => ({ payload: { services: await getSpringServicesHealth() } }));
}

export function fetchEc2Health() {
  return timed(async () => ({ payload: { instances: await listAllInstancesHealth() } }));
}

export function fetchCloudWatchAlarms() {
  return timed(async () => ({ payload: { alarms: await listOpenAlarms() } }));
}

export function fetchPromAlerts() {
  return timed(async () => ({ payload: { alerts: await promAlerts() } }));
}

export function fetchEc2Volumes() {
  return timed(async () => ({ payload: { volumes: await listAllVolumes() } }));
}

export function fetchLambdaOhio() {
  return timed(async () => ({ payload: { region: "us-east-2", functions: await listOhioLambdas() } }));
}

export function fetchRecommendations() {
  return timed(async () => {
    const health = await listAllInstancesHealth();
    const inputs = health.map((h) => ({
      instanceId: h.instanceId,
      name: h.name,
      region: h.region,
      type: h.type,
      state: h.state,
      publicIp: h.publicIp,
      privateIp: h.privateIp,
    }));
    const analyses = await analyzeAllInstances(inputs);
    return { payload: { analyses } };
  });
}

export function fetchSpringLogs() {
  return timed(async () => {
    const lastHour = { range: { "@timestamp": { gte: "now-1h" } } };
    const byService = { terms: { field: "dissect.service", size: 60, order: { _count: "desc" } } };
    type Buckets<T> = { aggregations: { services: { buckets: Array<{ key: string; doc_count: number } & T> } } };
    const index = SPRING_LOG_INDEX + "*";

    // Three searches: all lines, then ERROR and WARN lines by their real log level (see lib/springLogLevel).
    const all = await withRetry(() => esSearch<Buckets<{ hosts: { buckets: Array<{ key: string }> } }>>(index, {
      size: 0,
      query: { bool: { filter: [lastHour] } },
      aggs: { services: { ...byService, aggs: { hosts: { terms: { field: "host.name", size: 10 } } } } },
    }));
    const errors = await withRetry(() => esSearch<Buckets<{ latest: { hits: { hits: Array<{ _source: { "@timestamp"?: string; message?: string } }> } } }>>(index, {
      size: 0,
      runtime_mappings: LOG_LEVEL_RUNTIME,
      query: { bool: { filter: [lastHour, ...levelFilters("ERROR")] } },
      aggs: { services: { ...byService, aggs: { latest: { top_hits: { size: 1, sort: [{ "@timestamp": "desc" }], _source: ["@timestamp", "message", "host.name"] } } } } },
    }, { timeoutMs: LEVEL_QUERY_TIMEOUT_MS }));
    const warns = await withRetry(() => esSearch<Buckets<object>>(index, {
      size: 0,
      runtime_mappings: LOG_LEVEL_RUNTIME,
      query: { bool: { filter: [lastHour, ...levelFilters("WARN")] } },
      aggs: { services: byService },
    }, { timeoutMs: LEVEL_QUERY_TIMEOUT_MS }));

    const errorBy = new Map(errors.data.aggregations.services.buckets.map((b) => [b.key, b]));
    const warnBy = new Map(warns.data.aggregations.services.buckets.map((b) => [b.key, b.doc_count]));

    const services = all.data.aggregations.services.buckets.map((b) => {
      const err = errorBy.get(b.key);
      const lh = err?.latest.hits.hits[0];
      const errorCount = err?.doc_count ?? 0;
      return {
        service: b.key,
        total: b.doc_count,
        errors: errorCount,
        warns: warnBy.get(b.key) ?? 0,
        errorRate: b.doc_count > 0 ? errorCount / b.doc_count : 0,
        hosts: b.hosts.buckets.map((h) => h.key),
        latestError: lh ? { at: lh._source["@timestamp"] ?? null, message: (lh._source.message ?? "").slice(0, 400) } : null,
      };
    });
    // A service that logged nothing in the last hour is still a known service: list it with zeros, so the
    // page can tell "quiet this hour" from "does not ship logs under this name".
    const seen = new Set(services.map((s) => s.service));
    try {
      const week = await esSearch<Buckets<object>>(index, {
        size: 0,
        query: { bool: { filter: [{ range: { "@timestamp": { gte: KNOWN_SERVICE_WINDOW } } }] } },
        aggs: { services: { terms: { field: "dissect.service", size: 300 } } },
      }, { timeoutMs: LEVEL_QUERY_TIMEOUT_MS });
      for (const b of week.data.aggregations.services.buckets) {
        if (!seen.has(b.key)) services.push({ service: b.key, total: 0, errors: 0, warns: 0, errorRate: 0, hosts: [], latestError: null });
      }
    } catch {
      // The names list is a nicety; the hourly figures above are still correct without it.
    }

    const totals = services.reduce(
      (acc, s) => ({ total: acc.total + s.total, errors: acc.errors + s.errors, warns: acc.warns + s.warns }),
      { total: 0, errors: 0, warns: 0 },
    );
    return { payload: { window: "1h" as const, services, totals }, via: all.via };
  });
}
