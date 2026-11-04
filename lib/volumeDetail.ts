/**
 * Aggregates everything for a single EBS volume detail page.
 */
import { DescribeVolumesCommand, DescribeSnapshotsCommand } from "@aws-sdk/client-ec2";
import { getEc2Client } from "./aws";
import { listRegions } from "./ec2";
import { getVolumeCwMetrics, type VolumeCwMetrics } from "./cloudwatchMetrics";

export interface VolumeSummary {
  volumeId: string;
  region: string;
  az: string;
  size: number;
  type: string;
  state: string;
  encrypted: boolean;
  iops: number | null;
  throughput: number | null;
  attachedInstance: string | null;
  device: string | null;
  createTime: string | null;
  kmsKeyId: string | null;
}

export interface VolumeSnapshotSummary {
  snapshotId: string;
  startTime: string;
  state: string;
  description: string;
  progress: string;
  sizeGiB: number;
}

export interface VolumeDetail {
  summary: VolumeSummary;
  snapshots: VolumeSnapshotSummary[];
  cw: VolumeCwMetrics | null;
}

async function locateVolume(volumeId: string) {
  const regions = await listRegions();
  for (const region of regions) {
    try {
      const res = await getEc2Client(region).send(
        new DescribeVolumesCommand({ VolumeIds: [volumeId] }),
      );
      const v = res.Volumes?.[0];
      if (v) return { region, v };
    } catch {
      /* not in this region */
    }
  }
  return null;
}

export async function getVolumeDetail(
  volumeId: string,
  windowSec: number,
): Promise<VolumeDetail | null> {
  const found = await locateVolume(volumeId);
  if (!found) return null;
  const { region, v } = found;
  const att = (v.Attachments ?? [])[0];

  const summary: VolumeSummary = {
    volumeId: v.VolumeId ?? volumeId,
    region,
    az: v.AvailabilityZone ?? "-",
    size: v.Size ?? 0,
    type: v.VolumeType ?? "-",
    state: v.State ?? "-",
    encrypted: Boolean(v.Encrypted),
    iops: v.Iops ?? null,
    throughput: v.Throughput ?? null,
    attachedInstance: att?.InstanceId ?? null,
    device: att?.Device ?? null,
    createTime: v.CreateTime ? v.CreateTime.toISOString() : null,
    kmsKeyId: v.KmsKeyId ?? null,
  };

  const endSec = Math.floor(Date.now() / 1000);
  const startSec = endSec - windowSec;

  const [snapsRes, cw] = await Promise.all([
    getEc2Client(region).send(
      new DescribeSnapshotsCommand({
        OwnerIds: ["self"],
        Filters: [{ Name: "volume-id", Values: [volumeId] }],
        MaxResults: 50,
      }),
    ).catch(() => ({ Snapshots: [] })),
    getVolumeCwMetrics(region, volumeId, startSec, endSec).catch(() => null),
  ]);

  const snapshots: VolumeSnapshotSummary[] = (snapsRes.Snapshots ?? [])
    .map((s) => ({
      snapshotId: s.SnapshotId ?? "-",
      startTime: s.StartTime ? s.StartTime.toISOString() : "",
      state: s.State ?? "-",
      description: s.Description ?? "",
      progress: s.Progress ?? "",
      sizeGiB: s.VolumeSize ?? 0,
    }))
    .sort((a, b) => b.startTime.localeCompare(a.startTime))
    .slice(0, 30);

  return { summary, snapshots, cw };
}
