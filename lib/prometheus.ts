/**
 * Prometheus query helpers — READ-ONLY HTTP GET against PROMETHEUS_URL.
 * Used by the Performance section for Spring service health & active incidents.
 */
const PROM = process.env.PROMETHEUS_URL ?? "https://prometheus.rwdomain.com";

export interface PromSample {
  metric: Record<string, string>;
  value: [number, string];
}

export interface PromAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: "pending" | "firing" | "inactive";
  activeAt: string;
  value: string;
}

async function fetchJson<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, PROM);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`prometheus ${path} -> HTTP ${res.status}`);
  }
  const body = await res.json();
  if (body.status !== "success") {
    throw new Error(`prometheus ${path} -> ${body.errorType ?? "error"}`);
  }
  return body.data as T;
}

export async function query(promql: string): Promise<PromSample[]> {
  const data = await fetchJson<{ resultType: string; result: PromSample[] }>(
    "/api/v1/query",
    { query: promql },
  );
  return data.result ?? [];
}

export async function alerts(): Promise<PromAlert[]> {
  const data = await fetchJson<{ alerts: PromAlert[] }>("/api/v1/alerts");
  return data.alerts ?? [];
}

export interface PromRangeSeries {
  metric: Record<string, string>;
  values: Array<[number, string]>;
}

export async function queryRange(
  promql: string,
  startSec: number,
  endSec: number,
  stepSec: number,
): Promise<PromRangeSeries[]> {
  const data = await fetchJson<{ resultType: string; result: PromRangeSeries[] }>(
    "/api/v1/query_range",
    {
      query: promql,
      start: String(startSec),
      end: String(endSec),
      step: String(stepSec),
    },
  );
  return data.result ?? [];
}

export interface NodeMetricSeries {
  label: string;
  points: Array<[number, number]>;
}

export interface HostMetrics {
  scrapedBy: string; // e.g. "16.58.51.100:9100"
  cpuPct: NodeMetricSeries[]; // by mode (user/system/iowait) or single "cpu"
  memUsedPct: NodeMetricSeries[];
  memUsedBytes: NodeMetricSeries[];
  memTotalBytes: number | null;
  load: NodeMetricSeries[]; // load1, load5, load15
  diskByMount: NodeMetricSeries[]; // % used per mountpoint
  netIn: NodeMetricSeries[]; // bytes/sec per iface
  netOut: NodeMetricSeries[];
}

/** Locate the Prometheus node_exporter target for an instance by public/private IP. */
export async function findNodeTarget(ips: string[]): Promise<string | null> {
  const ups = await query('up{job=~".*Server Metrics.*"}');
  const ipSet = new Set(ips.filter(Boolean));
  for (const s of ups) {
    const inst = s.metric.instance ?? "";
    const host = inst.split(":")[0];
    if (ipSet.has(host)) return inst;
  }
  return null;
}

const toPoints = (s: PromRangeSeries): Array<[number, number]> =>
  s.values.map(([t, v]) => [t * 1000, Number(v)]);

export async function getHostMetrics(
  target: string,
  startSec: number,
  endSec: number,
  stepSec: number,
): Promise<HostMetrics> {
  const sel = `{instance="${target}"}`;
  const range = (q: string) => queryRange(q, startSec, endSec, stepSec);

  const [cpu, memAvail, memTotal, memTotalNow, load1, load5, load15, fsAvail, fsSize, netRx, netTx] = await Promise.all([
    // CPU % = 100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"})))
    range(`100 * (1 - avg by (instance) (rate(node_cpu_seconds_total{instance="${target}",mode="idle"}[2m])))`),
    range(`node_memory_MemAvailable_bytes${sel}`),
    range(`node_memory_MemTotal_bytes${sel}`),
    query(`node_memory_MemTotal_bytes${sel}`),
    range(`node_load1${sel}`),
    range(`node_load5${sel}`),
    range(`node_load15${sel}`),
    range(`node_filesystem_avail_bytes{instance="${target}",fstype!~"tmpfs|devtmpfs|overlay|squashfs"}`),
    range(`node_filesystem_size_bytes{instance="${target}",fstype!~"tmpfs|devtmpfs|overlay|squashfs"}`),
    range(`rate(node_network_receive_bytes_total{instance="${target}",device!~"lo|veth.*|docker.*"}[2m])`),
    range(`rate(node_network_transmit_bytes_total{instance="${target}",device!~"lo|veth.*|docker.*"}[2m])`),
  ]);

  // Build memory used %
  const memAvailByTs = new Map<number, number>();
  const memTotalByTs = new Map<number, number>();
  memAvail[0]?.values.forEach(([t, v]) => memAvailByTs.set(t, Number(v)));
  memTotal[0]?.values.forEach(([t, v]) => memTotalByTs.set(t, Number(v)));
  const memUsedPctPoints: Array<[number, number]> = [];
  const memUsedBytesPoints: Array<[number, number]> = [];
  for (const [t, total] of memTotalByTs.entries()) {
    const avail = memAvailByTs.get(t);
    if (avail !== undefined && total > 0) {
      memUsedPctPoints.push([t * 1000, ((total - avail) / total) * 100]);
      memUsedBytesPoints.push([t * 1000, total - avail]);
    }
  }
  const memTotalBytes = memTotalNow[0] ? Number(memTotalNow[0].value[1]) : null;

  // Build per-filesystem disk % used = 100 * (1 - avail/size)
  const fsAvailMap = new Map<string, Map<number, number>>();
  for (const s of fsAvail) {
    const key = `${s.metric.mountpoint ?? "?"}|${s.metric.device ?? "?"}`;
    const m = fsAvailMap.get(key) ?? new Map<number, number>();
    s.values.forEach(([t, v]) => m.set(t, Number(v)));
    fsAvailMap.set(key, m);
  }
  const diskByMount: NodeMetricSeries[] = [];
  for (const s of fsSize) {
    const key = `${s.metric.mountpoint ?? "?"}|${s.metric.device ?? "?"}`;
    const availMap = fsAvailMap.get(key);
    if (!availMap) continue;
    const points: Array<[number, number]> = [];
    for (const [t, size] of s.values) {
      const sz = Number(size);
      const av = availMap.get(t);
      if (av !== undefined && sz > 0) {
        points.push([t * 1000, (1 - av / sz) * 100]);
      }
    }
    if (points.length) diskByMount.push({ label: s.metric.mountpoint ?? key, points });
  }
  diskByMount.sort((a, b) => a.label.localeCompare(b.label));

  return {
    scrapedBy: target,
    cpuPct: cpu.map((s) => ({ label: "cpu", points: toPoints(s) })),
    memUsedPct: memUsedPctPoints.length ? [{ label: "memory", points: memUsedPctPoints }] : [],
    memUsedBytes: memUsedBytesPoints.length ? [{ label: "memory", points: memUsedBytesPoints }] : [],
    memTotalBytes,
    load: [
      ...load1.map((s) => ({ label: "load1", points: toPoints(s) })),
      ...load5.map((s) => ({ label: "load5", points: toPoints(s) })),
      ...load15.map((s) => ({ label: "load15", points: toPoints(s) })),
    ],
    diskByMount,
    netIn: netRx.map((s) => ({
      label: s.metric.device ?? "iface",
      points: toPoints(s),
    })),
    netOut: netTx.map((s) => ({
      label: s.metric.device ?? "iface",
      points: toPoints(s),
    })),
  };
}

export interface SpringServiceHealth {
  serviceName: string;
  job: string;
  instance: string;
  up: boolean;
  cpu: number | null;
  heapUsedBytes: number | null;
  heapMaxBytes: number | null;
  heapPct: number | null;
}

export async function getSpringServicesHealth(): Promise<SpringServiceHealth[]> {
  const [ups, cpus, heapUsed, heapMax] = await Promise.all([
    query('up{job=~".*Spring Services.*"}'),
    query('process_cpu_usage{job=~".*Spring Services.*"}'),
    query('sum by (service_name, instance, job) (jvm_memory_used_bytes{job=~".*Spring Services.*", area="heap"})'),
    query('sum by (service_name, instance, job) (jvm_memory_max_bytes{job=~".*Spring Services.*", area="heap"})'),
  ]);

  const keyOf = (m: Record<string, string>) =>
    `${m.service_name ?? "?"}|${m.instance ?? "?"}|${m.job ?? "?"}`;

  const cpuMap = new Map<string, number>();
  for (const s of cpus) cpuMap.set(keyOf(s.metric), Number(s.value[1]));
  const usedMap = new Map<string, number>();
  for (const s of heapUsed) usedMap.set(keyOf(s.metric), Number(s.value[1]));
  const maxMap = new Map<string, number>();
  for (const s of heapMax) maxMap.set(keyOf(s.metric), Number(s.value[1]));

  return ups
    .map((s) => {
      const k = keyOf(s.metric);
      const used = usedMap.get(k) ?? null;
      const max = maxMap.get(k) ?? null;
      return {
        serviceName: s.metric.service_name ?? "(unknown)",
        job: s.metric.job ?? "-",
        instance: s.metric.instance ?? "-",
        up: s.value[1] === "1",
        cpu: cpuMap.get(k) ?? null,
        heapUsedBytes: used,
        heapMaxBytes: max,
        heapPct: used !== null && max !== null && max > 0 ? (used / max) * 100 : null,
      };
    })
    .sort((a, b) => {
      if (a.up !== b.up) return a.up ? 1 : -1; // down first
      return a.serviceName.localeCompare(b.serviceName);
    });
}
