/**
 * CloudWatch GetMetricData wrappers for EC2 instance and EBS volume time-series.
 */
import {
  GetMetricDataCommand,
  type GetMetricDataCommandInput,
  type MetricDataQuery,
} from "@aws-sdk/client-cloudwatch";
import { GetConsoleOutputCommand } from "@aws-sdk/client-ec2";
import { getCloudWatchClient, getEc2Client } from "./aws";

export interface MetricSeries {
  label: string;
  unit: string;
  points: Array<[number, number]>;
}

function periodFor(windowSec: number): number {
  // Aim for ~60 points
  const target = Math.max(60, Math.floor(windowSec / 60));
  // Snap to a CW-supported period
  if (target <= 60) return 60;
  if (target <= 300) return 300;
  if (target <= 900) return 900;
  if (target <= 3600) return 3600;
  return 3600;
}

async function getMetricData(
  region: string,
  queries: MetricDataQuery[],
  startSec: number,
  endSec: number,
): Promise<Map<string, MetricSeries>> {
  const client = getCloudWatchClient(region);
  const out = new Map<string, MetricSeries>();
  let nextToken: string | undefined;
  do {
    const input: GetMetricDataCommandInput = {
      MetricDataQueries: queries,
      StartTime: new Date(startSec * 1000),
      EndTime: new Date(endSec * 1000),
      ScanBy: "TimestampAscending",
      NextToken: nextToken,
    };
    const res = await client.send(new GetMetricDataCommand(input));
    for (const r of res.MetricDataResults ?? []) {
      if (!r.Id) continue;
      const ts = r.Timestamps ?? [];
      const vs = r.Values ?? [];
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < ts.length && i < vs.length; i++) {
        pts.push([ts[i].getTime(), vs[i]]);
      }
      const existing = out.get(r.Id);
      if (existing) {
        existing.points.push(...pts);
      } else {
        out.set(r.Id, { label: r.Label ?? r.Id, unit: "", points: pts });
      }
    }
    nextToken = res.NextToken;
  } while (nextToken);
  return out;
}

export interface InstanceCwMetrics {
  cpuUtilization: MetricSeries | null;
  networkIn: MetricSeries | null;
  networkOut: MetricSeries | null;
  diskReadBytes: MetricSeries | null;
  diskWriteBytes: MetricSeries | null;
  statusCheckFailed: MetricSeries | null;
}

export async function getInstanceCwMetrics(
  region: string,
  instanceId: string,
  startSec: number,
  endSec: number,
): Promise<InstanceCwMetrics> {
  const period = periodFor(endSec - startSec);
  const dim = [{ Name: "InstanceId", Value: instanceId }];
  const queries: MetricDataQuery[] = [
    { Id: "cpu", MetricStat: { Metric: { Namespace: "AWS/EC2", MetricName: "CPUUtilization", Dimensions: dim }, Period: period, Stat: "Average" } },
    { Id: "netIn", MetricStat: { Metric: { Namespace: "AWS/EC2", MetricName: "NetworkIn", Dimensions: dim }, Period: period, Stat: "Sum" } },
    { Id: "netOut", MetricStat: { Metric: { Namespace: "AWS/EC2", MetricName: "NetworkOut", Dimensions: dim }, Period: period, Stat: "Sum" } },
    { Id: "diskRead", MetricStat: { Metric: { Namespace: "AWS/EC2", MetricName: "DiskReadBytes", Dimensions: dim }, Period: period, Stat: "Sum" } },
    { Id: "diskWrite", MetricStat: { Metric: { Namespace: "AWS/EC2", MetricName: "DiskWriteBytes", Dimensions: dim }, Period: period, Stat: "Sum" } },
    { Id: "statusFail", MetricStat: { Metric: { Namespace: "AWS/EC2", MetricName: "StatusCheckFailed", Dimensions: dim }, Period: period, Stat: "Maximum" } },
  ];
  const map = await getMetricData(region, queries, startSec, endSec);
  return {
    cpuUtilization: map.get("cpu") ?? null,
    networkIn: map.get("netIn") ?? null,
    networkOut: map.get("netOut") ?? null,
    diskReadBytes: map.get("diskRead") ?? null,
    diskWriteBytes: map.get("diskWrite") ?? null,
    statusCheckFailed: map.get("statusFail") ?? null,
  };
}

export interface VolumeCwMetrics {
  readOps: MetricSeries | null;
  writeOps: MetricSeries | null;
  readBytes: MetricSeries | null;
  writeBytes: MetricSeries | null;
  queueLength: MetricSeries | null;
  burstBalance: MetricSeries | null;
  totalReadTimeSec: MetricSeries | null;
  totalWriteTimeSec: MetricSeries | null;
}

export async function getVolumeCwMetrics(
  region: string,
  volumeId: string,
  startSec: number,
  endSec: number,
): Promise<VolumeCwMetrics> {
  const period = periodFor(endSec - startSec);
  const dim = [{ Name: "VolumeId", Value: volumeId }];
  const mk = (id: string, name: string, stat: string): MetricDataQuery => ({
    Id: id,
    MetricStat: { Metric: { Namespace: "AWS/EBS", MetricName: name, Dimensions: dim }, Period: period, Stat: stat },
  });
  const queries: MetricDataQuery[] = [
    mk("rOps", "VolumeReadOps", "Sum"),
    mk("wOps", "VolumeWriteOps", "Sum"),
    mk("rBytes", "VolumeReadBytes", "Sum"),
    mk("wBytes", "VolumeWriteBytes", "Sum"),
    mk("qLen", "VolumeQueueLength", "Average"),
    mk("burst", "BurstBalance", "Average"),
    mk("rTime", "VolumeTotalReadTime", "Sum"),
    mk("wTime", "VolumeTotalWriteTime", "Sum"),
  ];
  const map = await getMetricData(region, queries, startSec, endSec);
  return {
    readOps: map.get("rOps") ?? null,
    writeOps: map.get("wOps") ?? null,
    readBytes: map.get("rBytes") ?? null,
    writeBytes: map.get("wBytes") ?? null,
    queueLength: map.get("qLen") ?? null,
    burstBalance: map.get("burst") ?? null,
    totalReadTimeSec: map.get("rTime") ?? null,
    totalWriteTimeSec: map.get("wTime") ?? null,
  };
}

export async function getInstanceConsoleOutput(
  region: string,
  instanceId: string,
): Promise<{ timestamp: string | null; output: string }> {
  const res = await getEc2Client(region).send(
    new GetConsoleOutputCommand({ InstanceId: instanceId, Latest: true }),
  );
  let decoded = "";
  if (res.Output) {
    // AWS returns base64; SDK v3 may or may not decode based on response shape
    try {
      decoded = Buffer.from(res.Output, "base64").toString("utf-8");
    } catch {
      decoded = res.Output;
    }
  }
  return {
    timestamp: res.Timestamp ? res.Timestamp.toISOString() : null,
    output: decoded,
  };
}
