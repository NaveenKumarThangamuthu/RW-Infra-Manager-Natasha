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
    const body = {
      size: 0,
      query: { bool: { filter: [{ range: { "@timestamp": { gte: "now-1h" } } }] } },
      aggs: {
        services: {
          terms: { field: "dissect.service", size: 60, order: { _count: "desc" } },
          aggs: {
            errors: { filter: { match_phrase: { message: "ERROR" } } },
            warns: { filter: { match_phrase: { message: "WARN" } } },
            hosts: { terms: { field: "host.name", size: 10 } },
            latest_error: {
              filter: { match_phrase: { message: "ERROR" } },
              aggs: { h: { top_hits: { size: 1, sort: [{ "@timestamp": "desc" }], _source: ["@timestamp", "message", "host.name"] } } },
            },
          },
        },
      },
    };
    const { data, via } = await withRetry(() => esSearch<{
      aggregations: { services: { buckets: Array<{
        key: string; doc_count: number;
        errors: { doc_count: number };
        warns: { doc_count: number };
        hosts: { buckets: Array<{ key: string }> };
        latest_error: { h: { hits: { hits: Array<{ _source: { "@timestamp"?: string; message?: string } }> } } };
      }> } };
    }>(SPRING_LOG_INDEX + "*", body));

    const services = data.aggregations.services.buckets.map((b) => {
      const lh = b.latest_error.h.hits.hits[0];
      return {
        service: b.key,
        total: b.doc_count,
        errors: b.errors.doc_count,
        warns: b.warns.doc_count,
        errorRate: b.doc_count > 0 ? b.errors.doc_count / b.doc_count : 0,
        hosts: b.hosts.buckets.map((h) => h.key),
        latestError: lh ? { at: lh._source["@timestamp"] ?? null, message: (lh._source.message ?? "").slice(0, 400) } : null,
      };
    });
    const totals = services.reduce(
      (acc, s) => ({ total: acc.total + s.total, errors: acc.errors + s.errors, warns: acc.warns + s.warns }),
      { total: 0, errors: 0, warns: 0 },
    );
    return { payload: { window: "1h" as const, services, totals }, via };
  });
}
