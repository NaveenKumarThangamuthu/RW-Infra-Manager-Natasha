/**
 * EC2 metadata helpers — READ ONLY (DescribeRegions / DescribeInstances).
 * Used to map a cost line's instance ID -> its IP addresses, name and region.
 */
import {
  DescribeInstancesCommand,
  DescribeRegionsCommand,
  DescribeVolumesCommand,
  DescribeAddressesCommand,
} from "@aws-sdk/client-ec2";
import { getEc2Client } from "./aws";

export interface InstanceInfo {
  instanceId: string;
  region: string;
  name: string;
  type: string;
  state: string;
  privateIp: string;
  publicIp: string;
  vpcId: string;
}

/** All enabled regions for this account. Falls back to us-east-1 on error. */
export async function listRegions(): Promise<string[]> {
  try {
    const res = await getEc2Client("us-east-1").send(
      new DescribeRegionsCommand({ AllRegions: false }),
    );
    const regions = (res.Regions ?? [])
      .map((r) => r.RegionName)
      .filter((r): r is string => Boolean(r));
    return regions.length ? regions : ["us-east-1"];
  } catch {
    return ["us-east-1"];
  }
}

/** Describe all instances across all regions, keyed by instance ID. */
export async function getAllInstances(): Promise<Map<string, InstanceInfo>> {
  const regions = await listRegions();
  const byId = new Map<string, InstanceInfo>();

  await Promise.all(
    regions.map(async (region) => {
      try {
        const client = getEc2Client(region);
        let nextToken: string | undefined;
        do {
          const res = await client.send(
            new DescribeInstancesCommand({ NextToken: nextToken, MaxResults: 1000 }),
          );
          for (const reservation of res.Reservations ?? []) {
            for (const inst of reservation.Instances ?? []) {
              if (!inst.InstanceId) continue;
              const nameTag = (inst.Tags ?? []).find((t) => t.Key === "Name");
              byId.set(inst.InstanceId, {
                instanceId: inst.InstanceId,
                region,
                name: nameTag?.Value ?? "(no name)",
                type: inst.InstanceType ?? "-",
                state: inst.State?.Name ?? "-",
                privateIp: inst.PrivateIpAddress ?? "-",
                publicIp: inst.PublicIpAddress ?? "-",
                vpcId: inst.VpcId ?? "-",
              });
            }
          }
          nextToken = res.NextToken;
        } while (nextToken);
      } catch {
        // A region may be disabled / unauthorized; skip it silently.
      }
    }),
  );

  return byId;
}

/**
 * Map EBS volume id -> attached instance id (across regions), so volume cost
 * can be attributed to the instance. Volumes with no attachment are skipped.
 */
export async function getVolumeInstanceMap(): Promise<Map<string, string>> {
  const regions = await listRegions();
  const map = new Map<string, string>();
  await Promise.all(
    regions.map(async (region) => {
      try {
        const client = getEc2Client(region);
        let nextToken: string | undefined;
        do {
          const res = await client.send(new DescribeVolumesCommand({ NextToken: nextToken, MaxResults: 500 }));
          for (const v of res.Volumes ?? []) {
            const inst = (v.Attachments ?? [])[0]?.InstanceId;
            if (v.VolumeId && inst) map.set(v.VolumeId, inst);
          }
          nextToken = res.NextToken;
        } while (nextToken);
      } catch {
        /* region disabled / unauthorized */
      }
    }),
  );
  return map;
}

/**
 * Map Elastic IP identifiers (allocation id AND public IP) -> instance id, so
 * EIP / public-IPv4 charges can be attributed to the instance using them.
 */
export async function getEipInstanceMap(): Promise<Map<string, string>> {
  const regions = await listRegions();
  const map = new Map<string, string>();
  await Promise.all(
    regions.map(async (region) => {
      try {
        const res = await getEc2Client(region).send(new DescribeAddressesCommand({}));
        for (const a of res.Addresses ?? []) {
          const inst = a.InstanceId;
          if (!inst) continue;
          if (a.AllocationId) map.set(a.AllocationId, inst);
          if (a.PublicIp) map.set(a.PublicIp, inst);
        }
      } catch {
        /* region disabled / unauthorized */
      }
    }),
  );
  return map;
}
