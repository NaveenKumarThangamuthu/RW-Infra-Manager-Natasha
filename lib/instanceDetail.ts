/**
 * Aggregates everything we know about a single EC2 instance for the detail page.
 */
import {
  DescribeInstancesCommand,
  DescribeInstanceStatusCommand,
  DescribeVolumesCommand,
  DescribeSnapshotsCommand,
} from "@aws-sdk/client-ec2";
import { getEc2Client } from "./aws";
import { listRegions } from "./ec2";
import { findNodeTarget, getHostMetrics, type HostMetrics } from "./prometheus";
import { getInstanceCwMetrics, type InstanceCwMetrics } from "./cloudwatchMetrics";

export interface InstanceSummary {
  instanceId: string;
  name: string;
  region: string;
  az: string;
  type: string;
  state: string;
  publicIp: string | null;
  privateIp: string | null;
  vpcId: string | null;
  subnetId: string | null;
  imageId: string | null;
  launchTime: string | null;
  tags: Record<string, string>;
  systemCheck: string;
  instanceCheck: string;
}

export interface AttachedVolumeSummary {
  volumeId: string;
  size: number;
  type: string;
  device: string;
  state: string;
}

export interface SnapshotSummary {
  snapshotId: string;
  volumeId: string;
  startTime: string;
  state: string;
  description: string;
  sizeGiB: number;
}

export interface InstanceDetail {
  summary: InstanceSummary;
  volumes: AttachedVolumeSummary[];
  snapshots: SnapshotSummary[];
  source: "prometheus" | "cloudwatch";
  promTarget: string | null;
  host: HostMetrics | null;
  cw: InstanceCwMetrics | null;
}

/** Find the region + raw EC2 record for an instance by ID, scanning regions. */
async function locateInstance(instanceId: string) {
  const regions = await listRegions();
  for (const region of regions) {
    try {
      const res = await getEc2Client(region).send(
        new DescribeInstancesCommand({ InstanceIds: [instanceId] }),
      );
      const inst = res.Reservations?.[0]?.Instances?.[0];
      if (inst) return { region, inst };
    } catch {
      /* not in this region */
    }
  }
  return null;
}

export async function getInstanceDetail(
  instanceId: string,
  windowSec: number,
): Promise<InstanceDetail | null> {
  const found = await locateInstance(instanceId);
  if (!found) return null;
  const { region, inst } = found;
  const client = getEc2Client(region);

  const tags: Record<string, string> = {};
  for (const t of inst.Tags ?? []) {
    if (t.Key) tags[t.Key] = t.Value ?? "";
  }
  const summaryBase: Omit<InstanceSummary, "systemCheck" | "instanceCheck"> = {
    instanceId: inst.InstanceId ?? instanceId,
    name: tags.Name ?? "(no name)",
    region,
    az: inst.Placement?.AvailabilityZone ?? "-",
    type: inst.InstanceType ?? "-",
    state: inst.State?.Name ?? "-",
    publicIp: inst.PublicIpAddress ?? null,
    privateIp: inst.PrivateIpAddress ?? null,
    vpcId: inst.VpcId ?? null,
    subnetId: inst.SubnetId ?? null,
    imageId: inst.ImageId ?? null,
    launchTime: inst.LaunchTime ? inst.LaunchTime.toISOString() : null,
    tags,
  };
  const attachedVolIds = (inst.BlockDeviceMappings ?? [])
    .map((b) => b.Ebs?.VolumeId)
    .filter((v): v is string => Boolean(v));
  const ips = [summaryBase.publicIp, summaryBase.privateIp].filter((x): x is string => Boolean(x));

  const endSec = Math.floor(Date.now() / 1000);
  const startSec = endSec - windowSec;

  const [status, volsRes, snapsRes, target, cw] = await Promise.all([
    client.send(new DescribeInstanceStatusCommand({ InstanceIds: [instanceId], IncludeAllInstances: true })),
    attachedVolIds.length
      ? client.send(new DescribeVolumesCommand({ VolumeIds: attachedVolIds }))
      : Promise.resolve({ Volumes: [] }),
    attachedVolIds.length
      ? client.send(new DescribeSnapshotsCommand({
          OwnerIds: ["self"],
          Filters: [{ Name: "volume-id", Values: attachedVolIds }],
          MaxResults: 50,
        }))
      : Promise.resolve({ Snapshots: [] }),
    findNodeTarget(ips).catch(() => null),
    getInstanceCwMetrics(region, instanceId, startSec, endSec).catch(() => null),
  ]);

  const st = status.InstanceStatuses?.[0];
  const summary: InstanceSummary = {
    ...summaryBase,
    systemCheck: st?.SystemStatus?.Status ?? "n/a",
    instanceCheck: st?.InstanceStatus?.Status ?? "n/a",
  };

  const volumes: AttachedVolumeSummary[] = (volsRes.Volumes ?? []).map((v) => {
    const att = (v.Attachments ?? []).find((a) => a.InstanceId === instanceId);
    return {
      volumeId: v.VolumeId ?? "-",
      size: v.Size ?? 0,
      type: v.VolumeType ?? "-",
      device: att?.Device ?? "-",
      state: v.State ?? "-",
    };
  });

  const snapshots: SnapshotSummary[] = (snapsRes.Snapshots ?? [])
    .map((s) => ({
      snapshotId: s.SnapshotId ?? "-",
      volumeId: s.VolumeId ?? "-",
      startTime: s.StartTime ? s.StartTime.toISOString() : "",
      state: s.State ?? "-",
      description: s.Description ?? "",
      sizeGiB: s.VolumeSize ?? 0,
    }))
    .sort((a, b) => b.startTime.localeCompare(a.startTime))
    .slice(0, 20);

  let host: HostMetrics | null = null;
  if (target) {
    const stepSec = Math.max(15, Math.floor(windowSec / 60));
    host = await getHostMetrics(target, startSec, endSec, stepSec).catch(() => null);
  }

  return {
    summary,
    volumes,
    snapshots,
    source: host ? "prometheus" : "cloudwatch",
    promTarget: target,
    host,
    cw,
  };
}
