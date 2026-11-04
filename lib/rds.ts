/**
 * Cross-region RDS inventory + health signals — READ ONLY.
 *
 * Uses rds:DescribeDBInstances / rds:DescribeDBClusters and
 * cloudwatch:GetMetricStatistics, all covered by the AWS-managed
 * ReadOnlyAccess policy. No create, modify, delete or reboot calls.
 *
 * Cached in-process for 5 minutes, matching the Security Groups page, so
 * repeated views don't re-hit the AWS APIs.
 *
 * Risk flags are deliberately conservative — each one maps to a setting an
 * operator can act on, not a general style opinion:
 *   publicly-accessible — instance reachable from outside the VPC
 *   unencrypted         — storage encryption at rest disabled
 *   no-multi-az         — single-AZ, so a zone failure takes the database down
 *   backup-disabled     — automated backup retention is zero
 *   no-deletion-protect — deletion protection off
 *   storage-pressure    — free storage below 15% of allocated
 *   stopped             — instance not running but still incurring storage cost
 */
import {
  DescribeDBInstancesCommand,
  DescribeDBClustersCommand,
  type DBInstance,
} from "@aws-sdk/client-rds";
import { GetMetricStatisticsCommand } from "@aws-sdk/client-cloudwatch";
import { getRdsClient, getCloudWatchClient } from "./aws";
import { listRegions } from "./ec2";

const CACHE_TTL_MS = 5 * 60 * 1000;

export type RdsFlag =
  | "publicly-accessible"
  | "unencrypted"
  | "no-multi-az"
  | "backup-disabled"
  | "no-deletion-protect"
  | "storage-pressure"
  | "stopped";

export interface RdsMetrics {
  cpuAvg: number | null;        // percent, 24h average
  cpuMax: number | null;        // percent, 24h peak
  connectionsAvg: number | null;
  freeStorageBytes: number | null;
  freeStoragePct: number | null;
}

export interface RdsInstanceSummary {
  id: string;
  region: string;
  engine: string;
  engineVersion: string;
  instanceClass: string;
  status: string;
  multiAz: boolean;
  publiclyAccessible: boolean;
  storageEncrypted: boolean;
  allocatedStorageGb: number | null;
  storageType: string | null;
  backupRetentionDays: number | null;
  deletionProtection: boolean;
  endpoint: string | null;
  port: number | null;
  vpcId: string | null;
  clusterId: string | null;
  createdAt: string | null;
  tags: Record<string, string>;
  metrics: RdsMetrics;
  flags: RdsFlag[];
  /** Highest-priority flag, used for the row badge. */
  worstFlag: RdsFlag | null;
}

export interface RdsClusterSummary {
  id: string;
  region: string;
  engine: string;
  engineVersion: string;
  status: string;
  multiAz: boolean;
  storageEncrypted: boolean;
  backupRetentionDays: number | null;
  deletionProtection: boolean;
  endpoint: string | null;
  readerEndpoint: string | null;
  memberIds: string[];
}

export interface RdsInventory {
  fetchedAt: string;
  regions: string[];
  totalInstances: number;
  totalClusters: number;
  publicCount: number;
  unencryptedCount: number;
  singleAzCount: number;
  noBackupCount: number;
  stoppedCount: number;
  instances: RdsInstanceSummary[];
  clusters: RdsClusterSummary[];
  /** Regions that failed to respond, so the UI can say so rather than imply zero. */
  regionErrors: { region: string; error: string }[];
}

let cache: { at: number; data: RdsInventory } | null = null;

/** Severity order for picking the badge shown on a row. */
const FLAG_PRIORITY: RdsFlag[] = [
  "publicly-accessible",
  "unencrypted",
  "backup-disabled",
  "storage-pressure",
  "no-multi-az",
  "no-deletion-protect",
  "stopped",
];

function worstOf(flags: RdsFlag[]): RdsFlag | null {
  for (const f of FLAG_PRIORITY) if (flags.includes(f)) return f;
  return null;
}

/** 24h CloudWatch averages for one instance. Returns nulls rather than throwing. */
async function fetchMetrics(region: string, dbId: string, allocatedGb: number | null): Promise<RdsMetrics> {
  const empty: RdsMetrics = {
    cpuAvg: null, cpuMax: null, connectionsAvg: null,
    freeStorageBytes: null, freeStoragePct: null,
  };
  try {
    const cw = getCloudWatchClient(region);
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const common = {
      Namespace: "AWS/RDS",
      Dimensions: [{ Name: "DBInstanceIdentifier", Value: dbId }],
      StartTime: start,
      EndTime: end,
      Period: 3600,
    };

    const [cpu, conns, storage] = await Promise.all([
      cw.send(new GetMetricStatisticsCommand({ ...common, MetricName: "CPUUtilization", Statistics: ["Average", "Maximum"] })),
      cw.send(new GetMetricStatisticsCommand({ ...common, MetricName: "DatabaseConnections", Statistics: ["Average"] })),
      cw.send(new GetMetricStatisticsCommand({ ...common, MetricName: "FreeStorageSpace", Statistics: ["Average"] })),
    ]);

    const avg = (pts: { Average?: number }[] | undefined) => {
      const v = (pts ?? []).map((p) => p.Average).filter((n): n is number => typeof n === "number");
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const max = (pts: { Maximum?: number }[] | undefined) => {
      const v = (pts ?? []).map((p) => p.Maximum).filter((n): n is number => typeof n === "number");
      return v.length ? Math.max(...v) : null;
    };

    const freeBytes = avg(storage.Datapoints);
    const allocatedBytes = allocatedGb ? allocatedGb * 1024 ** 3 : null;
    return {
      cpuAvg: avg(cpu.Datapoints),
      cpuMax: max(cpu.Datapoints),
      connectionsAvg: avg(conns.Datapoints),
      freeStorageBytes: freeBytes,
      freeStoragePct: freeBytes != null && allocatedBytes ? (freeBytes / allocatedBytes) * 100 : null,
    };
  } catch {
    return empty;
  }
}

function summarise(inst: DBInstance, region: string, metrics: RdsMetrics): RdsInstanceSummary {
  const flags: RdsFlag[] = [];
  const status = inst.DBInstanceStatus ?? "unknown";

  if (inst.PubliclyAccessible) flags.push("publicly-accessible");
  if (!inst.StorageEncrypted) flags.push("unencrypted");
  if (!inst.MultiAZ) flags.push("no-multi-az");
  if (!inst.BackupRetentionPeriod) flags.push("backup-disabled");
  if (!inst.DeletionProtection) flags.push("no-deletion-protect");
  if (metrics.freeStoragePct != null && metrics.freeStoragePct < 15) flags.push("storage-pressure");
  if (status === "stopped") flags.push("stopped");

  const tags: Record<string, string> = {};
  for (const t of inst.TagList ?? []) if (t.Key) tags[t.Key] = t.Value ?? "";

  return {
    id: inst.DBInstanceIdentifier ?? "(unknown)",
    region,
    engine: inst.Engine ?? "unknown",
    engineVersion: inst.EngineVersion ?? "",
    instanceClass: inst.DBInstanceClass ?? "",
    status,
    multiAz: Boolean(inst.MultiAZ),
    publiclyAccessible: Boolean(inst.PubliclyAccessible),
    storageEncrypted: Boolean(inst.StorageEncrypted),
    allocatedStorageGb: inst.AllocatedStorage ?? null,
    storageType: inst.StorageType ?? null,
    backupRetentionDays: inst.BackupRetentionPeriod ?? null,
    deletionProtection: Boolean(inst.DeletionProtection),
    endpoint: inst.Endpoint?.Address ?? null,
    port: inst.Endpoint?.Port ?? null,
    vpcId: inst.DBSubnetGroup?.VpcId ?? null,
    clusterId: inst.DBClusterIdentifier ?? null,
    createdAt: inst.InstanceCreateTime?.toISOString() ?? null,
    tags,
    metrics,
    flags,
    worstFlag: worstOf(flags),
  };
}

export async function fetchRdsInventory(opts: { force?: boolean } = {}): Promise<RdsInventory> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const regions = await listRegions();
  const instances: RdsInstanceSummary[] = [];
  const clusters: RdsClusterSummary[] = [];
  const regionErrors: { region: string; error: string }[] = [];

  await Promise.all(
    regions.map(async (region) => {
      try {
        const rds = getRdsClient(region);

        // Instances (paginated).
        const raw: DBInstance[] = [];
        let marker: string | undefined;
        do {
          const res = await rds.send(new DescribeDBInstancesCommand({ Marker: marker }));
          raw.push(...(res.DBInstances ?? []));
          marker = res.Marker;
        } while (marker);

        // Metrics are per-instance; fetch them in parallel within the region.
        const withMetrics = await Promise.all(
          raw.map(async (inst) => {
            const m = await fetchMetrics(region, inst.DBInstanceIdentifier ?? "", inst.AllocatedStorage ?? null);
            return summarise(inst, region, m);
          }),
        );
        instances.push(...withMetrics);

        // Aurora / Multi-AZ clusters.
        let cMarker: string | undefined;
        do {
          const res = await rds.send(new DescribeDBClustersCommand({ Marker: cMarker }));
          for (const c of res.DBClusters ?? []) {
            clusters.push({
              id: c.DBClusterIdentifier ?? "(unknown)",
              region,
              engine: c.Engine ?? "unknown",
              engineVersion: c.EngineVersion ?? "",
              status: c.Status ?? "unknown",
              multiAz: Boolean(c.MultiAZ),
              storageEncrypted: Boolean(c.StorageEncrypted),
              backupRetentionDays: c.BackupRetentionPeriod ?? null,
              deletionProtection: Boolean(c.DeletionProtection),
              endpoint: c.Endpoint ?? null,
              readerEndpoint: c.ReaderEndpoint ?? null,
              memberIds: (c.DBClusterMembers ?? [])
                .map((m) => m.DBInstanceIdentifier)
                .filter((x): x is string => Boolean(x)),
            });
          }
          cMarker = res.Marker;
        } while (cMarker);
      } catch (e) {
        // A region the account hasn't opted into, or a permissions gap. Record it
        // so the UI can distinguish "no databases" from "could not look".
        regionErrors.push({ region, error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );

  instances.sort((a, b) => {
    const rank = (i: RdsInstanceSummary) => (i.worstFlag ? FLAG_PRIORITY.indexOf(i.worstFlag) : 99);
    return rank(a) - rank(b) || a.id.localeCompare(b.id);
  });

  const data: RdsInventory = {
    fetchedAt: new Date().toISOString(),
    regions,
    totalInstances: instances.length,
    totalClusters: clusters.length,
    publicCount: instances.filter((i) => i.publiclyAccessible).length,
    unencryptedCount: instances.filter((i) => !i.storageEncrypted).length,
    singleAzCount: instances.filter((i) => !i.multiAz).length,
    noBackupCount: instances.filter((i) => !i.backupRetentionDays).length,
    stoppedCount: instances.filter((i) => i.status === "stopped").length,
    instances,
    clusters,
    regionErrors,
  };

  cache = { at: Date.now(), data };
  return data;
}
