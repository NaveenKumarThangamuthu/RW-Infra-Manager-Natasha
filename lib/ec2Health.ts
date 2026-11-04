/**
 * EC2 + EBS health helpers — READ-ONLY (Describe* only).
 * Fans out across every enabled region in parallel.
 */
import {
  DescribeInstancesCommand,
  DescribeInstanceStatusCommand,
  DescribeVolumesCommand,
} from "@aws-sdk/client-ec2";
import { getEc2Client } from "./aws";
import { listRegions } from "./ec2";

export interface InstanceHealth {
  instanceId: string;
  name: string;
  region: string;
  az: string;
  type: string;
  state: string;
  publicIp: string | null;
  privateIp: string | null;
  launchTime: string | null;
  systemCheck: string;
  instanceCheck: string;
  overallOk: boolean;
}

export interface VolumeHealth {
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
}

const nameOf = (tags: Array<{ Key?: string; Value?: string }> | undefined) =>
  tags?.find((t) => t.Key === "Name")?.Value ?? "(no name)";

export async function listAllInstancesHealth(): Promise<InstanceHealth[]> {
  const regions = await listRegions();
  const all: InstanceHealth[] = [];

  await Promise.all(
    regions.map(async (region) => {
      try {
        const client = getEc2Client(region);

        // Fetch instances and status checks in parallel
        const [instData, statusData] = await Promise.all([
          (async () => {
            const out = [];
            let next: string | undefined;
            do {
              const res = await client.send(
                new DescribeInstancesCommand({ NextToken: next, MaxResults: 1000 }),
              );
              for (const r of res.Reservations ?? []) out.push(...(r.Instances ?? []));
              next = res.NextToken;
            } while (next);
            return out;
          })(),
          (async () => {
            const map = new Map<string, { sys: string; inst: string }>();
            let next: string | undefined;
            do {
              const res = await client.send(
                new DescribeInstanceStatusCommand({
                  NextToken: next,
                  IncludeAllInstances: true,
                  MaxResults: 1000,
                }),
              );
              for (const s of res.InstanceStatuses ?? []) {
                if (!s.InstanceId) continue;
                map.set(s.InstanceId, {
                  sys: s.SystemStatus?.Status ?? "n/a",
                  inst: s.InstanceStatus?.Status ?? "n/a",
                });
              }
              next = res.NextToken;
            } while (next);
            return map;
          })(),
        ]);

        for (const inst of instData) {
          if (!inst.InstanceId) continue;
          const checks = statusData.get(inst.InstanceId) ?? { sys: "n/a", inst: "n/a" };
          all.push({
            instanceId: inst.InstanceId,
            name: nameOf(inst.Tags),
            region,
            az: inst.Placement?.AvailabilityZone ?? "-",
            type: inst.InstanceType ?? "-",
            state: inst.State?.Name ?? "-",
            publicIp: inst.PublicIpAddress ?? null,
            privateIp: inst.PrivateIpAddress ?? null,
            launchTime: inst.LaunchTime ? inst.LaunchTime.toISOString() : null,
            systemCheck: checks.sys,
            instanceCheck: checks.inst,
            overallOk:
              (checks.sys === "ok" || checks.sys === "not-applicable") &&
              (checks.inst === "ok" || checks.inst === "not-applicable"),
          });
        }
      } catch {
        /* region disabled / unauthorized */
      }
    }),
  );

  all.sort((a, b) => {
    if (a.overallOk !== b.overallOk) return a.overallOk ? 1 : -1; // problems first
    return a.name.localeCompare(b.name);
  });
  return all;
}

export async function listAllVolumes(): Promise<VolumeHealth[]> {
  const regions = await listRegions();
  const all: VolumeHealth[] = [];

  await Promise.all(
    regions.map(async (region) => {
      try {
        const client = getEc2Client(region);
        let next: string | undefined;
        do {
          const res = await client.send(
            new DescribeVolumesCommand({ NextToken: next, MaxResults: 500 }),
          );
          for (const v of res.Volumes ?? []) {
            if (!v.VolumeId) continue;
            const att = (v.Attachments ?? [])[0];
            all.push({
              volumeId: v.VolumeId,
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
            });
          }
          next = res.NextToken;
        } while (next);
      } catch {
        /* region disabled / unauthorized */
      }
    }),
  );

  all.sort((a, b) => {
    if (a.state !== b.state) {
      if (a.state === "available" && b.state !== "available") return -1; // unattached first
      if (b.state === "available" && a.state !== "available") return 1;
    }
    return b.size - a.size;
  });
  return all;
}
