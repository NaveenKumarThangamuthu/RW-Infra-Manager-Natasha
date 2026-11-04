/**
 * Per-instance EC2 cost itemization — shared by the live allocation API and the
 * twice-daily snapshot, so both compute the same Compute / Data Transfer / EBS /
 * Elastic IP numbers. READ-ONLY against AWS.
 *
 * - Compute: instance-hours (GetCostAndUsageWithResources on EC2-Compute).
 * - Data Transfer / EBS: EC2-Other lines, attributed to the instance (EBS via
 *   volume->instance map).
 * - Elastic IP / Public IPv4: billed under the VPC service; the in-use total is
 *   shared across instances that hold a public IP. Idle address cost is returned
 *   separately (unattached).
 */
import { costByGroups, resourceCostForService, SERVICE, type CostItem } from "./costExplorer";
import { getAllInstances, getVolumeInstanceMap, getEipInstanceMap, type InstanceInfo } from "./ec2";

export interface Itemized {
  compute: number;
  dataTransfer: number;
  ebs: number;
  eip: number;
  other: number;
}

type Component = "dataTransfer" | "ebs" | "eip" | "other";

function classify(usageType: string): Component {
  const u = usageType.toLowerCase();
  if (u.includes("bytes") || u.includes("datatransfer") || u.includes("dataxfer")) return "dataTransfer";
  if (u.includes("ebs") || u.includes("volume")) return "ebs";
  if (u.includes("ipv4") || u.includes("ip4") || u.includes("elasticip") || u.includes("address")) return "eip";
  return "other";
}

export interface Ec2ItemizedResult {
  items: Map<string, Itemized>;
  instances: Map<string, InstanceInfo>;
  monthServices: CostItem[];
  unattributedEc2Other: number;
  pubIpIdle: number;
}

export async function ec2ItemizedByInstance(
  range14: { Start: string; End: string },
  mRange: { Start: string; End: string },
): Promise<Ec2ItemizedResult> {
  const [compute, instances, monthServices, ec2Other, volMap, eipMap, allUsage] = await Promise.all([
    resourceCostForService(SERVICE.EC2, range14),
    getAllInstances(),
    costByGroups(mRange, [{ Type: "DIMENSION", Key: "SERVICE" }]),
    resourceCostForService(SERVICE.EC2_OTHER, range14, "USAGE_TYPE"),
    getVolumeInstanceMap(),
    getEipInstanceMap(),
    costByGroups(range14, [{ Type: "DIMENSION", Key: "USAGE_TYPE" }]),
  ]);

  // Public-IPv4 / Elastic-IP totals (billed under VPC service), split in-use/idle.
  let pubIpInUse = 0, pubIpIdle = 0;
  for (const it of allUsage) {
    const u = it.key.toLowerCase();
    if (u.includes("publicipv4") || u.includes("elasticip")) {
      if (u.includes("idle")) pubIpIdle += it.amount;
      else pubIpInUse += it.amount;
    }
  }
  const hasPubIp = (id: string) => {
    const ip = instances.get(id)?.publicIp;
    return Boolean(ip && ip !== "-");
  };
  const pubIpCount = compute.filter((c) => hasPubIp(c.key.split("/").pop()!.trim())).length;
  const perInstanceEip = pubIpCount > 0 ? pubIpInUse / pubIpCount : 0;

  const items = new Map<string, Itemized>();
  const ensure = (id: string) => {
    let v = items.get(id);
    if (!v) { v = { compute: 0, dataTransfer: 0, ebs: 0, eip: 0, other: 0 }; items.set(id, v); }
    return v;
  };

  for (const c of compute) {
    const id = c.key.split("/").pop()!.trim();
    const v = ensure(id);
    v.compute += c.amount;
    if (hasPubIp(id)) v.eip += perInstanceEip;
  }

  let unattributedEc2Other = 0;
  for (const row of ec2Other) {
    const [resourceId, usageType = ""] = row.key.split(" / ");
    const comp = classify(usageType);
    let instanceId: string | undefined;
    if (resourceId?.startsWith("i-")) instanceId = resourceId;
    else if (resourceId?.startsWith("vol-")) instanceId = volMap.get(resourceId);
    else if (resourceId?.startsWith("eipalloc-")) instanceId = eipMap.get(resourceId);
    else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(resourceId ?? "")) instanceId = eipMap.get(resourceId);
    if (instanceId) ensure(instanceId)[comp] += row.amount;
    else unattributedEc2Other += row.amount;
  }

  return { items, instances, monthServices, unattributedEc2Other, pubIpIdle };
}
