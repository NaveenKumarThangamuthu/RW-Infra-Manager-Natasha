/**
 * Per-instance recommendation engine.
 *
 * Pulls 24h CPU + memory + disk + credit metrics from Prometheus (preferred) and
 * CloudWatch (fallback), then applies rules to produce severity-tagged
 * recommendations with optional cost delta.
 */
import { GetMetricDataCommand, type MetricDataQuery } from "@aws-sdk/client-cloudwatch";
import { getCloudWatchClient } from "./aws";
import { query, findNodeTarget } from "./prometheus";
import {
  getInstanceSpecs,
  nextSmaller,
  nextLarger,
  priceMonth,
  modernEquivalents,
  isLegacyFamily,
  type InstanceSpec,
} from "./instanceTypes";

export type Severity = "INFO" | "WARN" | "CRIT";

export interface Recommendation {
  severity: Severity;
  kind: string;
  message: string;
  targetType?: string;
  monthlyDeltaUsd?: number; // negative = savings
  evidence?: Record<string, string | number>;
}

export interface InstanceAnalysis {
  instanceId: string;
  name: string;
  region: string;
  type: string;
  state: string;
  source: "prometheus" | "cloudwatch" | "none";
  cpuAvg24h: number | null;
  cpuP95_24h: number | null;
  memAvg24h: number | null;
  memMax24h: number | null;
  diskMaxPct: number | null;
  diskWorstMount: string | null;
  creditBalanceMin: number | null;
  creditBalancePct: number | null; // min as % of typical max
  recommendations: Recommendation[];
}

const CREDIT_MAX_FOR_TYPE: Record<string, number> = {
  // standard mode max credit balance for unlimited / std (approximate)
  "t2.nano": 72, "t2.micro": 144, "t2.small": 288, "t2.medium": 576,
  "t2.large": 864, "t2.xlarge": 1296, "t2.2xlarge": 1728,
  "t3.nano": 144, "t3.micro": 288, "t3.small": 576, "t3.medium": 576,
  "t3.large": 864, "t3.xlarge": 2304, "t3.2xlarge": 4608,
};

async function fetchPromAggregates(target: string): Promise<{
  cpuAvg: number | null; cpuP95: number | null;
  memAvg: number | null; memMax: number | null;
  diskMaxPct: number | null; diskMount: string | null;
}> {
  // 24-hour aggregates with step 5m
  const cpuQ = `avg_over_time((100 * (1 - avg by (instance)(rate(node_cpu_seconds_total{instance="${target}",mode="idle"}[5m]))))[24h:5m])`;
  const cpuP95Q = `quantile_over_time(0.95, (100 * (1 - avg by (instance)(rate(node_cpu_seconds_total{instance="${target}",mode="idle"}[5m]))))[24h:5m])`;
  const memUsedQ = `avg_over_time((100 * (1 - node_memory_MemAvailable_bytes{instance="${target}"} / node_memory_MemTotal_bytes{instance="${target}"}))[24h:5m])`;
  const memMaxQ = `max_over_time((100 * (1 - node_memory_MemAvailable_bytes{instance="${target}"} / node_memory_MemTotal_bytes{instance="${target}"}))[24h:5m])`;
  const diskQ = `100 * (1 - node_filesystem_avail_bytes{instance="${target}",fstype!~"tmpfs|devtmpfs|overlay|squashfs"} / node_filesystem_size_bytes{instance="${target}",fstype!~"tmpfs|devtmpfs|overlay|squashfs"})`;

  const [cpuR, cpuP95R, memR, memMaxR, diskR] = await Promise.all([
    query(cpuQ).catch(() => []),
    query(cpuP95Q).catch(() => []),
    query(memUsedQ).catch(() => []),
    query(memMaxQ).catch(() => []),
    query(diskQ).catch(() => []),
  ]);

  const first = (arr: Awaited<ReturnType<typeof query>>) =>
    arr.length ? Number(arr[0].value[1]) : null;

  let diskMaxPct: number | null = null;
  let diskMount: string | null = null;
  for (const s of diskR) {
    const pct = Number(s.value[1]);
    if (Number.isFinite(pct) && (diskMaxPct === null || pct > diskMaxPct)) {
      diskMaxPct = pct;
      diskMount = s.metric.mountpoint ?? null;
    }
  }

  return {
    cpuAvg: first(cpuR),
    cpuP95: first(cpuP95R),
    memAvg: first(memR),
    memMax: first(memMaxR),
    diskMaxPct,
    diskMount,
  };
}

async function fetchCwAggregates(
  region: string,
  instanceId: string,
  type: string,
): Promise<{
  cpuAvg: number | null; cpuP95: number | null;
  creditMin: number | null;
}> {
  const endSec = Math.floor(Date.now() / 1000);
  const startSec = endSec - 86400;
  const client = getCloudWatchClient(region);
  const dim = [{ Name: "InstanceId", Value: instanceId }];

  const queries: MetricDataQuery[] = [
    { Id: "cpuAvg", MetricStat: { Metric: { Namespace: "AWS/EC2", MetricName: "CPUUtilization", Dimensions: dim }, Period: 3600, Stat: "Average" } },
    { Id: "cpuP95", MetricStat: { Metric: { Namespace: "AWS/EC2", MetricName: "CPUUtilization", Dimensions: dim }, Period: 3600, Stat: "p95" } },
  ];
  const burstable = type.startsWith("t");
  if (burstable) {
    queries.push({
      Id: "creditMin",
      MetricStat: { Metric: { Namespace: "AWS/EC2", MetricName: "CPUCreditBalance", Dimensions: dim }, Period: 3600, Stat: "Minimum" },
    });
  }

  const res = await client.send(
    new GetMetricDataCommand({
      MetricDataQueries: queries,
      StartTime: new Date(startSec * 1000),
      EndTime: new Date(endSec * 1000),
    }),
  );
  const byId = new Map<string, number[]>();
  for (const r of res.MetricDataResults ?? []) {
    byId.set(r.Id ?? "", r.Values ?? []);
  }
  const avg = (arr: number[] | undefined) =>
    arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const max = (arr: number[] | undefined) =>
    arr && arr.length ? Math.max(...arr) : null;
  const min = (arr: number[] | undefined) =>
    arr && arr.length ? Math.min(...arr) : null;

  return {
    cpuAvg: avg(byId.get("cpuAvg")),
    cpuP95: max(byId.get("cpuP95")), // p95-of-hours, then take the worst hour
    creditMin: burstable ? min(byId.get("creditMin")) : null,
  };
}

function applyRules(
  analysis: Omit<InstanceAnalysis, "recommendations">,
  spec: InstanceSpec | undefined,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const t = analysis.type;
  const burstable = spec?.burstable ?? t.startsWith("t");

  // Disk
  if (analysis.diskMaxPct !== null) {
    if (analysis.diskMaxPct > 95) {
      recs.push({
        severity: "CRIT",
        kind: "disk-full",
        message: `Filesystem ${analysis.diskWorstMount ?? ""} at ${analysis.diskMaxPct.toFixed(0)}%. Expand the volume now — risk of disk-full failure.`,
        evidence: { mount: analysis.diskWorstMount ?? "", pct: Math.round(analysis.diskMaxPct) },
      });
    } else if (analysis.diskMaxPct > 85) {
      recs.push({
        severity: "WARN",
        kind: "disk-near-full",
        message: `Filesystem ${analysis.diskWorstMount ?? ""} at ${analysis.diskMaxPct.toFixed(0)}%. Plan to expand the volume.`,
        evidence: { mount: analysis.diskWorstMount ?? "", pct: Math.round(analysis.diskMaxPct) },
      });
    }
  }

  // CPU upsize
  if (analysis.cpuP95_24h !== null && analysis.cpuP95_24h > 85) {
    const target = nextLarger(t);
    const cur = priceMonth(t);
    const tgt = target ? priceMonth(target) : null;
    recs.push({
      severity: "WARN",
      kind: "cpu-upsize",
      message: `CPU p95 at ${analysis.cpuP95_24h.toFixed(0)}% over 24h. Consider upsizing${target ? ` to ${target}` : ""} or moving to a compute-optimized family (c5/c6i).`,
      targetType: target ?? undefined,
      monthlyDeltaUsd: cur !== null && tgt !== null ? +(tgt - cur).toFixed(2) : undefined,
      evidence: { cpuP95: Math.round(analysis.cpuP95_24h) },
    });
  }

  // CPU downsize (only if CPU avg low AND p95 low AND not credit-starved)
  const creditOk = !burstable || (analysis.creditBalancePct ?? 100) > 30;
  if (
    analysis.cpuAvg24h !== null &&
    analysis.cpuP95_24h !== null &&
    analysis.cpuAvg24h < 10 &&
    analysis.cpuP95_24h < 25 &&
    creditOk &&
    analysis.state === "running"
  ) {
    const target = nextSmaller(t);
    const cur = priceMonth(t);
    const tgt = target ? priceMonth(target) : null;
    if (target) {
      recs.push({
        severity: "INFO",
        kind: "cpu-downsize",
        message: `CPU averages ${analysis.cpuAvg24h.toFixed(1)}% (p95 ${analysis.cpuP95_24h.toFixed(1)}%) over 24h. Downsize candidate: ${target}.`,
        targetType: target,
        monthlyDeltaUsd: cur !== null && tgt !== null ? +(tgt - cur).toFixed(2) : undefined,
        evidence: { cpuAvg: +analysis.cpuAvg24h.toFixed(1), cpuP95: +analysis.cpuP95_24h.toFixed(1) },
      });
    }
  }

  // CPU credits low (burstable only)
  if (burstable && analysis.creditBalancePct !== null && analysis.creditBalancePct < 20) {
    recs.push({
      severity: "WARN",
      kind: "credits-low",
      message: `CPU credit balance dipped to ${analysis.creditBalancePct.toFixed(0)}% of typical max in last 24h. Consider unlimited mode or upsizing.`,
      evidence: { creditMin: analysis.creditBalanceMin ?? 0, pct: Math.round(analysis.creditBalancePct) },
    });
  }

  // Memory pressure
  if (analysis.memAvg24h !== null && analysis.memAvg24h > 85) {
    recs.push({
      severity: "WARN",
      kind: "memory-pressure",
      message: `Memory averaging ${analysis.memAvg24h.toFixed(0)}% over 24h. Upsize or move to memory-optimized (r5/r6i).`,
      evidence: { memAvg: Math.round(analysis.memAvg24h), memMax: Math.round(analysis.memMax24h ?? 0) },
    });
  }

  // Memory over-provisioned + CPU low → downsize
  if (
    analysis.memAvg24h !== null && analysis.memAvg24h < 30 &&
    analysis.cpuAvg24h !== null && analysis.cpuAvg24h < 30 &&
    analysis.state === "running"
  ) {
    if (!recs.some((r) => r.kind === "cpu-downsize")) {
      const target = nextSmaller(t);
      const cur = priceMonth(t);
      const tgt = target ? priceMonth(target) : null;
      if (target) {
        recs.push({
          severity: "INFO",
          kind: "rightsizing-downsize",
          message: `Both CPU (${analysis.cpuAvg24h.toFixed(0)}%) and RAM (${analysis.memAvg24h.toFixed(0)}%) underused over 24h. Downsize candidate: ${target}.`,
          targetType: target,
          monthlyDeltaUsd: cur !== null && tgt !== null ? +(tgt - cur).toFixed(2) : undefined,
        });
      }
    }
  }

  // Stopped instance
  if (analysis.state === "stopped") {
    recs.push({
      severity: "INFO",
      kind: "stopped",
      message: "Instance is stopped. Verify it's still needed — terminate to drop attached EBS volume cost.",
    });
  }

  // Modernize legacy families — always suggested when the instance is on t2/m5/c5/r5 etc.
  // Emit one recommendation per modern equivalent, ordered cheapest-first so the biggest saving lands first.
  if (isLegacyFamily(t)) {
    const cur = priceMonth(t);
    const mods = modernEquivalents(t)
      .map((m) => ({ type: m, price: priceMonth(m) }))
      .filter((m): m is { type: string; price: number } => m.price !== null)
      .sort((a, b) => a.price - b.price);
    for (const m of mods) {
      const delta = cur != null ? m.price - cur : null;
      const savingsPct = cur != null && cur > 0 ? Math.round(((cur - m.price) / cur) * 100) : null;
      // Only emit if it's actually cheaper OR same-price (modernization = free upgrade)
      if (delta != null && delta > 0.1) continue;
      recs.push({
        severity: "INFO",
        kind: "modernize",
        message: `Current family "${parseFamily(t)}" is a legacy generation. ${m.type} offers same size on a newer/AMD platform${savingsPct && savingsPct > 0 ? ` at ~${savingsPct}% lower cost` : " at the same cost"}. Zero code change, requires a stop+start with new instance type.`,
        targetType: m.type,
        monthlyDeltaUsd: delta ?? undefined,
        evidence: { currentType: t, replacementFamily: parseFamily(m.type) },
      });
    }
  }

  // If no recs and instance is running, add a friendly OK
  if (recs.length === 0 && analysis.state === "running") {
    recs.push({
      severity: "INFO",
      kind: "ok",
      message: "All signals look healthy.",
    });
  }

  return recs;
}

function parseFamily(t: string): string {
  return (t.split(".")[0] ?? "").toLowerCase();
}

export async function analyzeInstance(
  instance: {
    instanceId: string;
    name: string;
    region: string;
    type: string;
    state: string;
    publicIp: string | null;
    privateIp: string | null;
  },
): Promise<InstanceAnalysis> {
  const ips = [instance.publicIp, instance.privateIp].filter((x): x is string => Boolean(x));
  const target = ips.length ? await findNodeTarget(ips).catch(() => null) : null;
  const specs = await getInstanceSpecs([instance.type], instance.region).catch(() => new Map<string, InstanceSpec>());
  const spec = specs.get(instance.type);

  let prom: Awaited<ReturnType<typeof fetchPromAggregates>> | null = null;
  if (target) {
    prom = await fetchPromAggregates(target).catch(() => null);
  }

  const cw = await fetchCwAggregates(instance.region, instance.instanceId, instance.type)
    .catch(() => null);

  const cpuAvg = prom?.cpuAvg ?? cw?.cpuAvg ?? null;
  const cpuP95 = prom?.cpuP95 ?? cw?.cpuP95 ?? null;
  const creditMin = cw?.creditMin ?? null;
  const creditMax = CREDIT_MAX_FOR_TYPE[instance.type] ?? null;
  const creditBalancePct = creditMin !== null && creditMax !== null && creditMax > 0
    ? (creditMin / creditMax) * 100
    : null;

  const analysisCore: Omit<InstanceAnalysis, "recommendations"> = {
    instanceId: instance.instanceId,
    name: instance.name,
    region: instance.region,
    type: instance.type,
    state: instance.state,
    source: prom ? "prometheus" : cw ? "cloudwatch" : "none",
    cpuAvg24h: cpuAvg !== null ? +cpuAvg.toFixed(2) : null,
    cpuP95_24h: cpuP95 !== null ? +cpuP95.toFixed(2) : null,
    memAvg24h: prom?.memAvg !== null && prom?.memAvg !== undefined ? +prom.memAvg.toFixed(2) : null,
    memMax24h: prom?.memMax !== null && prom?.memMax !== undefined ? +prom.memMax.toFixed(2) : null,
    diskMaxPct: prom?.diskMaxPct !== null && prom?.diskMaxPct !== undefined ? +prom.diskMaxPct.toFixed(2) : null,
    diskWorstMount: prom?.diskMount ?? null,
    creditBalanceMin: creditMin !== null ? Math.round(creditMin) : null,
    creditBalancePct: creditBalancePct !== null ? +creditBalancePct.toFixed(1) : null,
  };

  const recommendations = applyRules(analysisCore, spec);
  return { ...analysisCore, recommendations };
}

export async function analyzeAllInstances(
  instances: Array<{
    instanceId: string; name: string; region: string; type: string; state: string;
    publicIp: string | null; privateIp: string | null;
  }>,
): Promise<InstanceAnalysis[]> {
  // Bound parallelism so we don't overload Prometheus
  const out: InstanceAnalysis[] = [];
  const BATCH = 6;
  for (let i = 0; i < instances.length; i += BATCH) {
    const slice = instances.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map((inst) =>
        analyzeInstance(inst).catch((err) => ({
          instanceId: inst.instanceId,
          name: inst.name,
          region: inst.region,
          type: inst.type,
          state: inst.state,
          source: "none" as const,
          cpuAvg24h: null, cpuP95_24h: null,
          memAvg24h: null, memMax24h: null,
          diskMaxPct: null, diskWorstMount: null,
          creditBalanceMin: null, creditBalancePct: null,
          recommendations: [{
            severity: "INFO" as Severity,
            kind: "analysis-error",
            message: `Could not analyze: ${err instanceof Error ? err.message : "unknown"}`,
          }],
        })),
      ),
    );
    out.push(...results);
  }
  // Sort: CRIT first, then WARN, then by potential savings
  const severityRank: Record<Severity, number> = { CRIT: 0, WARN: 1, INFO: 2 };
  out.sort((a, b) => {
    const aMax = a.recommendations.reduce((m, r) => Math.min(m, severityRank[r.severity]), 3);
    const bMax = b.recommendations.reduce((m, r) => Math.min(m, severityRank[r.severity]), 3);
    if (aMax !== bMax) return aMax - bMax;
    const aSav = Math.min(0, ...a.recommendations.map((r) => r.monthlyDeltaUsd ?? 0));
    const bSav = Math.min(0, ...b.recommendations.map((r) => r.monthlyDeltaUsd ?? 0));
    return aSav - bSav; // more negative (savings) first
  });
  return out;
}
