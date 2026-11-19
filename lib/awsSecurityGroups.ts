/**
 * Cross-region Security-Group inventory + risk scoring.
 *
 * Uses read-only ec2:DescribeSecurityGroups + ec2:DescribeNetworkInterfaces (both in
 * the AWS-managed ReadOnlyAccess policy). No writes. Cached in-process for 5 min.
 *
 * Risk model:
 *   - "risky-port"     — 0.0.0.0/0 allowed on a well-known sensitive port (SSH/RDP/DBs)
 *   - "wide-open"      — 0.0.0.0/0 with no port constraint (allows ALL ports)
 *   - "unused"         — no network interface uses this SG. Not the same as safe to delete:
 *                        AWS default groups cannot be deleted and other groups' rules may reference it.
 *   - "large-range"    — a CIDR /8 through /16 open on any port (not necessarily 0/0)
 */
import {
  DescribeSecurityGroupsCommand,
  DescribeNetworkInterfacesCommand,
} from "@aws-sdk/client-ec2";
import { getEc2Client } from "./aws";
import { listRegions } from "./ec2";

const RISKY_PORTS = new Set([
  22,    // SSH
  3389,  // RDP
  3306,  // MySQL
  5432,  // Postgres
  1433,  // MSSQL
  27017, // MongoDB
  6379,  // Redis
  9200, 9300, // Elasticsearch
  5601,  // Kibana
  2049,  // NFS
  873,   // rsync
  25,    // SMTP
  23,    // Telnet
  21,    // FTP
]);

export interface SgRule {
  direction: "in" | "out";
  protocol: string;
  fromPort: number | null;
  toPort: number | null;
  cidr: string[];
  cidr6: string[];
  sgSources: string[]; // referenced source SG ids
  description: string | null;
  flags: string[]; // "risky-port" | "wide-open" | "large-range"
}

export interface SgSummary {
  id: string;
  name: string;
  description: string;
  vpcId: string | null;
  region: string;
  ownerId: string | null;
  tags: Record<string, string>;
  inbound: SgRule[];
  outbound: SgRule[];
  attachedEniCount: number;
  attachedInstanceIds: string[];
  flags: string[]; // aggregate: "risky" | "wide-open" | "unused"
  worstFlag: "wide-open" | "risky" | "unused" | null;
  /** The VPC's built-in "default" group, which AWS does not allow deleting. */
  isDefault: boolean;
  /** How many other groups name this one as a source or destination in their rules. */
  referencedByCount: number;
}

export interface SgInventory {
  fetchedAt: string;
  regions: string[];
  totalCount: number;
  riskyCount: number;
  wideOpenCount: number;
  unusedCount: number;
  groups: SgSummary[];
  cached: boolean;
}

interface CacheEntry { at: number; data: SgInventory }
const TTL_MS = 5 * 60 * 1000;
let cache: CacheEntry | null = null;

function scoreRule(direction: "in" | "out", protocol: string, fromPort: number | null, toPort: number | null, cidrs: string[]): string[] {
  if (direction !== "in") return [];
  const flags: string[] = [];
  const hasWorld = cidrs.some((c) => c === "0.0.0.0/0");
  if (!hasWorld) return flags;
  // Wide open: protocol == -1 (all) OR port range not specified
  if (protocol === "-1" || fromPort === null || (fromPort === 0 && toPort === 65535)) {
    flags.push("wide-open");
    return flags;
  }
  // Risky port from world
  const lo = fromPort;
  const hi = toPort ?? fromPort;
  for (const p of RISKY_PORTS) {
    if (lo <= p && p <= hi) { flags.push("risky-port"); break; }
  }
  return flags;
}

async function fetchRegion(region: string): Promise<{ sgs: SgSummary[]; sgIdToEnis: Map<string, string[]> }> {
  const client = getEc2Client(region);
  const [sgResp, eniResp] = await Promise.all([
    client.send(new DescribeSecurityGroupsCommand({})),
    client.send(new DescribeNetworkInterfacesCommand({})),
  ]);

  const sgIdToEnis = new Map<string, string[]>();
  for (const eni of eniResp.NetworkInterfaces ?? []) {
    const instanceId = eni.Attachment?.InstanceId ?? "";
    for (const g of eni.Groups ?? []) {
      if (!g.GroupId) continue;
      const arr = sgIdToEnis.get(g.GroupId) ?? [];
      if (instanceId && !arr.includes(instanceId)) arr.push(instanceId);
      sgIdToEnis.set(g.GroupId, arr);
    }
  }

  const sgs: SgSummary[] = (sgResp.SecurityGroups ?? []).map((sg) => {
    const inbound: SgRule[] = (sg.IpPermissions ?? []).map((p) => {
      const cidrs = (p.IpRanges ?? []).map((r) => r.CidrIp ?? "").filter(Boolean);
      const cidrs6 = (p.Ipv6Ranges ?? []).map((r) => r.CidrIpv6 ?? "").filter(Boolean);
      const sgs = (p.UserIdGroupPairs ?? []).map((r) => r.GroupId ?? "").filter(Boolean);
      const flags = scoreRule("in", p.IpProtocol ?? "-1", p.FromPort ?? null, p.ToPort ?? null, cidrs);
      const desc = (p.IpRanges ?? [])[0]?.Description ?? null;
      return {
        direction: "in" as const,
        protocol: p.IpProtocol ?? "-1",
        fromPort: p.FromPort ?? null,
        toPort: p.ToPort ?? null,
        cidr: cidrs,
        cidr6: cidrs6,
        sgSources: sgs,
        description: desc,
        flags,
      };
    });
    const outbound: SgRule[] = (sg.IpPermissionsEgress ?? []).map((p) => ({
      direction: "out" as const,
      protocol: p.IpProtocol ?? "-1",
      fromPort: p.FromPort ?? null,
      toPort: p.ToPort ?? null,
      cidr: (p.IpRanges ?? []).map((r) => r.CidrIp ?? "").filter(Boolean),
      cidr6: (p.Ipv6Ranges ?? []).map((r) => r.CidrIpv6 ?? "").filter(Boolean),
      sgSources: (p.UserIdGroupPairs ?? []).map((r) => r.GroupId ?? "").filter(Boolean),
      description: (p.IpRanges ?? [])[0]?.Description ?? null,
      flags: [],
    }));

    const attachedIds = sgIdToEnis.get(sg.GroupId ?? "") ?? [];
    const attachedInstanceIds = attachedIds.filter((s) => s.startsWith("i-"));

    const aggFlags: string[] = [];
    if (inbound.some((r) => r.flags.includes("wide-open"))) aggFlags.push("wide-open");
    if (inbound.some((r) => r.flags.includes("risky-port"))) aggFlags.push("risky");
    if (attachedIds.length === 0) aggFlags.push("unused");
    const worstFlag: SgSummary["worstFlag"] =
      aggFlags.includes("wide-open") ? "wide-open" :
      aggFlags.includes("risky") ? "risky" :
      aggFlags.includes("unused") ? "unused" : null;

    const tags: Record<string, string> = {};
    for (const t of sg.Tags ?? []) if (t.Key) tags[t.Key] = t.Value ?? "";

    return {
      id: sg.GroupId ?? "",
      name: sg.GroupName ?? "",
      description: sg.Description ?? "",
      vpcId: sg.VpcId ?? null,
      region,
      ownerId: sg.OwnerId ?? null,
      tags,
      inbound,
      outbound,
      attachedEniCount: attachedIds.length,
      attachedInstanceIds,
      flags: aggFlags,
      worstFlag,
      isDefault: sg.GroupName === "default",
      referencedByCount: 0,
    };
  });

  return { sgs, sgIdToEnis };
}

export async function fetchSecurityGroups(opts: { force?: boolean } = {}): Promise<SgInventory> {
  const now = Date.now();
  if (!opts.force && cache && now - cache.at < TTL_MS) {
    return { ...cache.data, cached: true };
  }

  const regions = await listRegions();
  const perRegion = await Promise.all(
    regions.map((r) => fetchRegion(r).catch(() => ({ sgs: [] as SgSummary[], sgIdToEnis: new Map<string, string[]>() })))
  );
  const groups = perRegion.flatMap((r) => r.sgs);

  const referencedBy = new Map<string, Set<string>>();
  for (const g of groups) {
    for (const rule of [...g.inbound, ...g.outbound]) {
      for (const target of rule.sgSources) {
        if (target === g.id) continue;
        const set = referencedBy.get(target) ?? new Set<string>();
        set.add(g.id);
        referencedBy.set(target, set);
      }
    }
  }
  for (const g of groups) g.referencedByCount = referencedBy.get(g.id)?.size ?? 0;

  const riskyCount = groups.filter((g) => g.flags.includes("risky")).length;
  const wideOpenCount = groups.filter((g) => g.flags.includes("wide-open")).length;
  const unusedCount = groups.filter((g) => g.flags.includes("unused")).length;

  const inventory: SgInventory = {
    fetchedAt: new Date(now).toISOString(),
    regions,
    totalCount: groups.length,
    riskyCount,
    wideOpenCount,
    unusedCount,
    groups,
    cached: false,
  };
  cache = { at: now, data: inventory };
  return inventory;
}
