/**
 * Per-instance RDS performance time-series + issue detection — READ ONLY.
 *
 * Uses cloudwatch:GetMetricData against the AWS/RDS namespace plus
 * rds:DescribeDBInstances for the instance shape. No writes.
 *
 * Issue detection is intentionally conservative. Each rule maps to something an
 * operator can act on, states the evidence that triggered it, and says what to
 * do. Rules that cannot be evaluated (metric absent, instance class unknown)
 * stay silent rather than guessing — an absent metric is not a healthy one.
 */
import {
  GetMetricDataCommand,
  type MetricDataQuery,
} from "@aws-sdk/client-cloudwatch";
import { DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { getCloudWatchClient, getRdsClient } from "./aws";

export interface Series {
  label: string;
  unit: string;
  points: Array<[number, number]>;
}

export type IssueSeverity = "critical" | "warning" | "info";

export interface RdsIssue {
  severity: IssueSeverity;
  title: string;
  /** What was measured, in plain numbers. */
  evidence: string;
  /** What to do about it. */
  action: string;
}

export interface RdsStat {
  avg: number | null;
  max: number | null;
  min: number | null;
  last: number | null;
}

export interface RdsPerformance {
  id: string;
  region: string;
  windowHours: number;
  fetchedAt: string;

  engine: string;
  engineVersion: string;
  instanceClass: string;
  status: string;
  allocatedStorageGb: number | null;
  multiAz: boolean;
  /** vCPU count for the class, when known — needed to read load averages. */
  vcpu: number | null;
  /** True for t2/t3/t4g, where CPU credits can throttle the database. */
  burstable: boolean;

  series: {
    cpu: Series | null;
    connections: Series | null;
    freeableMemory: Series | null;
    freeStorage: Series | null;
    readIops: Series | null;
    writeIops: Series | null;
    readLatency: Series | null;
    writeLatency: Series | null;
    diskQueueDepth: Series | null;
    networkIn: Series | null;
    networkOut: Series | null;
    swapUsage: Series | null;
    cpuCreditBalance: Series | null;
    burstBalance: Series | null;
    replicaLag: Series | null;
  };

  stats: {
    cpu: RdsStat;
    connections: RdsStat;
    freeableMemory: RdsStat;
    freeStorage: RdsStat;
    readLatency: RdsStat;
    writeLatency: RdsStat;
    diskQueueDepth: RdsStat;
    swapUsage: RdsStat;
    cpuCreditBalance: RdsStat;
    burstBalance: RdsStat;
    replicaLag: RdsStat;
  };

  issues: RdsIssue[];
  /** Overall posture derived from the worst issue present. */
  health: "healthy" | "attention" | "critical";
}

/** vCPU counts for the RDS classes most likely to appear. Unknown -> null. */
const VCPU: Record<string, number> = {
  "db.t3.micro": 2, "db.t3.small": 2, "db.t3.medium": 2, "db.t3.large": 2,
  "db.t3.xlarge": 4, "db.t3.2xlarge": 8,
  "db.t4g.micro": 2, "db.t4g.small": 2, "db.t4g.medium": 2, "db.t4g.large": 2,
  "db.t4g.xlarge": 4, "db.t4g.2xlarge": 8,
  "db.m5.large": 2, "db.m5.xlarge": 4, "db.m5.2xlarge": 8, "db.m5.4xlarge": 16,
  "db.m6g.large": 2, "db.m6g.xlarge": 4, "db.m6g.2xlarge": 8, "db.m6g.4xlarge": 16,
  "db.r5.large": 2, "db.r5.xlarge": 4, "db.r5.2xlarge": 8, "db.r5.4xlarge": 16,
  "db.r6g.large": 2, "db.r6g.xlarge": 4, "db.r6g.2xlarge": 8, "db.r6g.4xlarge": 16,
};

function periodFor(windowSec: number): number {
  const target = Math.max(60, Math.floor(windowSec / 120));
  if (target <= 60) return 60;
  if (target <= 300) return 300;
  if (target <= 900) return 900;
  return 3600;
}

function statOf(s: Series | null): RdsStat {
  if (!s || s.points.length === 0) return { avg: null, max: null, min: null, last: null };
  const v = s.points.map((p) => p[1]);
  return {
    avg: v.reduce((a, b) => a + b, 0) / v.length,
    max: Math.max(...v),
    min: Math.min(...v),
    last: v[v.length - 1],
  };
}

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function buildIssues(p: Omit<RdsPerformance, "issues" | "health">): RdsIssue[] {
  const out: RdsIssue[] = [];
  const s = p.stats;
  const hrs = p.windowHours;

  // --- CPU ---------------------------------------------------------------
  if (s.cpu.avg != null && s.cpu.max != null) {
    if (s.cpu.avg >= 80) {
      out.push({
        severity: "critical",
        title: "CPU sustained above 80%",
        evidence: `Average ${s.cpu.avg.toFixed(1)}% over ${hrs}h, peaking at ${s.cpu.max.toFixed(1)}%.`,
        action: `Scale up from ${p.instanceClass}, or find the expensive queries via Performance Insights / slow query log.`,
      });
    } else if (s.cpu.avg >= 60) {
      out.push({
        severity: "warning",
        title: "CPU running hot",
        evidence: `Average ${s.cpu.avg.toFixed(1)}% over ${hrs}h, peaking at ${s.cpu.max.toFixed(1)}%.`,
        action: "Headroom is thin for traffic spikes. Review query plans before this becomes a capacity incident.",
      });
    } else if (s.cpu.max < 10 && s.cpu.avg < 5) {
      out.push({
        severity: "info",
        title: "Instance looks over-provisioned",
        evidence: `CPU never exceeded ${s.cpu.max.toFixed(1)}% over ${hrs}h (average ${s.cpu.avg.toFixed(1)}%).`,
        action: `${p.instanceClass} may be larger than needed. Check memory and IOPS before downsizing.`,
      });
    }
  }

  // --- Burstable credit exhaustion --------------------------------------
  // On t-class the database is throttled to baseline once credits hit zero,
  // which looks like a sudden unexplained slowdown.
  if (p.burstable && s.cpuCreditBalance.min != null) {
    if (s.cpuCreditBalance.min <= 0) {
      out.push({
        severity: "critical",
        title: "CPU credits exhausted",
        evidence: `Credit balance reached ${s.cpuCreditBalance.min.toFixed(0)} during the window (last ${s.cpuCreditBalance.last?.toFixed(0) ?? "?"}).`,
        action: `${p.instanceClass} is burstable — at zero credits it is throttled to baseline CPU regardless of load. Move to an m/r class or enable unlimited mode.`,
      });
    } else if (s.cpuCreditBalance.min < 50) {
      out.push({
        severity: "warning",
        title: "CPU credits running low",
        evidence: `Credit balance dipped to ${s.cpuCreditBalance.min.toFixed(0)}.`,
        action: "Sustained load is outpacing credit accrual. A non-burstable class would give predictable performance.",
      });
    }
  }

  // --- Memory ------------------------------------------------------------
  if (s.freeableMemory.min != null) {
    if (s.freeableMemory.min < 256 * MB) {
      out.push({
        severity: "critical",
        title: "Freeable memory critically low",
        evidence: `Dropped to ${(s.freeableMemory.min / MB).toFixed(0)} MB.`,
        action: "The engine is close to swapping or OOM. Scale to a memory-optimised class or reduce buffer pool / connection count.",
      });
    } else if (s.freeableMemory.min < 1 * GB) {
      out.push({
        severity: "warning",
        title: "Freeable memory low",
        evidence: `Dropped to ${(s.freeableMemory.min / MB).toFixed(0)} MB.`,
        action: "Watch alongside swap usage — persistent pressure degrades query latency.",
      });
    }
  }
  if (s.swapUsage.max != null && s.swapUsage.max > 50 * MB) {
    out.push({
      severity: "warning",
      title: "Database is swapping",
      evidence: `Swap usage peaked at ${(s.swapUsage.max / MB).toFixed(0)} MB.`,
      action: "Swapping on a database is always a latency problem. Add memory rather than tuning around it.",
    });
  }

  // --- Storage -----------------------------------------------------------
  if (s.freeStorage.min != null && p.allocatedStorageGb) {
    const pctFree = (s.freeStorage.min / (p.allocatedStorageGb * GB)) * 100;
    if (pctFree < 10) {
      out.push({
        severity: "critical",
        title: "Free storage below 10%",
        evidence: `${(s.freeStorage.min / GB).toFixed(1)} GB free of ${p.allocatedStorageGb} GB (${pctFree.toFixed(1)}%).`,
        action: "RDS will force the instance into storage-full and stop accepting writes. Extend storage or enable autoscaling now.",
      });
    } else if (pctFree < 20) {
      out.push({
        severity: "warning",
        title: "Free storage below 20%",
        evidence: `${(s.freeStorage.min / GB).toFixed(1)} GB free of ${p.allocatedStorageGb} GB (${pctFree.toFixed(1)}%).`,
        action: "Plan a storage increase or enable storage autoscaling before it becomes urgent.",
      });
    }
  }
  if (s.burstBalance.min != null && s.burstBalance.min < 20) {
    out.push({
      severity: "warning",
      title: "EBS burst balance low",
      evidence: `Burst balance fell to ${s.burstBalance.min.toFixed(0)}%.`,
      action: "gp2 volumes throttle to baseline IOPS at zero burst. Migrate to gp3 for provisioned, predictable throughput.",
    });
  }

  // --- Latency and queueing ---------------------------------------------
  const latencyIssue = (st: RdsStat, kind: "Read" | "Write") => {
    if (st.avg == null) return;
    if (st.avg > 0.05) {
      out.push({
        severity: "warning",
        title: `${kind} latency elevated`,
        evidence: `Average ${(st.avg * 1000).toFixed(1)} ms${st.max != null ? `, peak ${(st.max * 1000).toFixed(1)} ms` : ""}.`,
        action: "Above ~50 ms typically means IO contention or missing indexes rather than a slow disk.",
      });
    }
  };
  latencyIssue(s.readLatency, "Read");
  latencyIssue(s.writeLatency, "Write");

  if (s.diskQueueDepth.avg != null && s.diskQueueDepth.avg > 5) {
    out.push({
      severity: "warning",
      title: "Disk queue depth high",
      evidence: `Average queue depth ${s.diskQueueDepth.avg.toFixed(1)}.`,
      action: "IO requests are backing up. Increase provisioned IOPS or reduce write amplification.",
    });
  }

  // --- Connections -------------------------------------------------------
  if (s.connections.max != null && s.connections.avg != null) {
    if (s.connections.max > 0 && s.connections.avg < 1 && s.connections.max < 5) {
      out.push({
        severity: "info",
        title: "Very low connection count",
        evidence: `Average ${s.connections.avg.toFixed(1)} connections, peak ${s.connections.max.toFixed(0)}.`,
        action: "If this is a production database, confirm traffic is actually reaching it.",
      });
    }
  }

  // --- Availability ------------------------------------------------------
  if (!p.multiAz) {
    out.push({
      severity: "warning",
      title: "Single-AZ deployment",
      evidence: "Multi-AZ is not enabled.",
      action: "An availability-zone failure takes this database offline with no automatic failover.",
    });
  }
  if (s.replicaLag.max != null && s.replicaLag.max > 30) {
    out.push({
      severity: "warning",
      title: "Replica lag high",
      evidence: `Peak lag ${s.replicaLag.max.toFixed(0)}s.`,
      action: "Reads from the replica may return stale data. Check write volume and replica sizing.",
    });
  }

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export async function getRdsPerformance(
  region: string,
  dbId: string,
  windowHours = 24,
): Promise<RdsPerformance> {
  // Instance shape first — the issue rules need class, storage and Multi-AZ.
  const desc = await getRdsClient(region).send(
    new DescribeDBInstancesCommand({ DBInstanceIdentifier: dbId }),
  );
  const inst = (desc.DBInstances ?? [])[0];
  if (!inst) throw new Error(`RDS instance not found: ${dbId} in ${region}`);

  const instanceClass = inst.DBInstanceClass ?? "";
  const burstable = /^db\.t[234]g?\./.test(instanceClass);

  const end = Math.floor(Date.now() / 1000);
  const start = end - windowHours * 3600;
  const period = periodFor(end - start);
  const dim = [{ Name: "DBInstanceIdentifier", Value: dbId }];
  const q = (id: string, name: string, stat = "Average"): MetricDataQuery => ({
    Id: id,
    MetricStat: { Metric: { Namespace: "AWS/RDS", MetricName: name, Dimensions: dim }, Period: period, Stat: stat },
  });

  const queries: MetricDataQuery[] = [
    q("cpu", "CPUUtilization"),
    q("conns", "DatabaseConnections"),
    q("mem", "FreeableMemory"),
    q("storage", "FreeStorageSpace"),
    q("riops", "ReadIOPS"),
    q("wiops", "WriteIOPS"),
    q("rlat", "ReadLatency"),
    q("wlat", "WriteLatency"),
    q("queue", "DiskQueueDepth"),
    q("netin", "NetworkReceiveThroughput"),
    q("netout", "NetworkTransmitThroughput"),
    q("swap", "SwapUsage"),
    q("credits", "CPUCreditBalance", "Minimum"),
    q("burst", "BurstBalance", "Minimum"),
    q("lag", "ReplicaLag", "Maximum"),
  ];

  const cw = getCloudWatchClient(region);
  const map = new Map<string, Series>();
  let nextToken: string | undefined;
  do {
    const res = await cw.send(
      new GetMetricDataCommand({
        MetricDataQueries: queries,
        StartTime: new Date(start * 1000),
        EndTime: new Date(end * 1000),
        ScanBy: "TimestampAscending",
        NextToken: nextToken,
      }),
    );
    for (const r of res.MetricDataResults ?? []) {
      if (!r.Id) continue;
      const ts = r.Timestamps ?? [];
      const vs = r.Values ?? [];
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < ts.length && i < vs.length; i++) pts.push([ts[i].getTime(), vs[i]]);
      const existing = map.get(r.Id);
      if (existing) existing.points.push(...pts);
      else map.set(r.Id, { label: r.Label ?? r.Id, unit: "", points: pts });
    }
    nextToken = res.NextToken;
  } while (nextToken);

  // A metric with no datapoints is reported as absent, not as zero.
  const g = (id: string): Series | null => {
    const s = map.get(id);
    return s && s.points.length ? s : null;
  };

  const series = {
    cpu: g("cpu"), connections: g("conns"), freeableMemory: g("mem"),
    freeStorage: g("storage"), readIops: g("riops"), writeIops: g("wiops"),
    readLatency: g("rlat"), writeLatency: g("wlat"), diskQueueDepth: g("queue"),
    networkIn: g("netin"), networkOut: g("netout"), swapUsage: g("swap"),
    cpuCreditBalance: g("credits"), burstBalance: g("burst"), replicaLag: g("lag"),
  };

  const stats = {
    cpu: statOf(series.cpu),
    connections: statOf(series.connections),
    freeableMemory: statOf(series.freeableMemory),
    freeStorage: statOf(series.freeStorage),
    readLatency: statOf(series.readLatency),
    writeLatency: statOf(series.writeLatency),
    diskQueueDepth: statOf(series.diskQueueDepth),
    swapUsage: statOf(series.swapUsage),
    cpuCreditBalance: statOf(series.cpuCreditBalance),
    burstBalance: statOf(series.burstBalance),
    replicaLag: statOf(series.replicaLag),
  };

  const base = {
    id: dbId,
    region,
    windowHours,
    fetchedAt: new Date().toISOString(),
    engine: inst.Engine ?? "unknown",
    engineVersion: inst.EngineVersion ?? "",
    instanceClass,
    status: inst.DBInstanceStatus ?? "unknown",
    allocatedStorageGb: inst.AllocatedStorage ?? null,
    multiAz: Boolean(inst.MultiAZ),
    vcpu: VCPU[instanceClass] ?? null,
    burstable,
    series,
    stats,
  };

  const issues = buildIssues(base);
  const health: RdsPerformance["health"] = issues.some((i) => i.severity === "critical")
    ? "critical"
    : issues.some((i) => i.severity === "warning")
      ? "attention"
      : "healthy";

  return { ...base, issues, health };
}
