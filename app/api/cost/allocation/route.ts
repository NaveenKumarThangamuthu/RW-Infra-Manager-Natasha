import { NextResponse } from "next/server";
import { costByGroups, resourceCostForService, SERVICE } from "@/lib/costExplorer";
import { getAllInstances, getVolumeInstanceMap, getEipInstanceMap, type InstanceInfo } from "@/lib/ec2";
import { lastNDaysRange, monthRange, isCurrentMonthKey } from "@/lib/dates";
import { cached, DEFAULT_TTL } from "@/lib/cache";
import { loadAllocationFromDb, ALLOC_CATEGORIES } from "@/lib/allocationDb";
import type { CostItem } from "@/lib/costExplorer";
import { prisma } from "@/lib/db";

/** AWS auth/session failures we can recover from by serving the last DB snapshot. */
function isAwsAuthError(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    m.includes("expired") || m.includes("token") || m.includes("credential") ||
    m.includes("security") || m.includes("auth") || m.includes("session") ||
    m.includes("unable to locate") || m.includes("access denied") || m.includes("reauthenticate")
  );
}

/**
 * Fallback when the live AWS call fails (e.g. expired SSO session): rebuild the
 * EC2 view from the last stored snapshot. Per-instance compute comes from
 * resource_cost_snapshot; tags/labels from server_tag; category totals from
 * tag_cost_snapshot. Live-only fields (IP, VPC, state, DT/EBS/EIP) are blank.
 */
async function ec2FromDb(mRange: { Start: string; End: string }, month: string | undefined) {
  const last = await prisma.ec2ItemizedSnapshot.findFirst({
    orderBy: { snapshotAt: "desc" },
    select: { snapshotAt: true },
  });
  if (!last) return null;

  const [itemRows, tags, monthRows] = await Promise.all([
    prisma.ec2ItemizedSnapshot.findMany({ where: { snapshotAt: last.snapshotAt } }),
    prisma.serverTag.findMany(),
    prisma.monthlyCost.findMany({ where: { month: mRange.Start.slice(0, 7), dimension: "SERVICE" } }),
  ]);

  const tagByKey = new Map(tags.map((t) => [t.matchKey, t]));
  const buckets: Record<string, { amount: number; count: number }> = {
    Unmapped: { amount: 0, count: 0 }, "Credits/Savings": { amount: 0, count: 0 },
  };
  for (const c of ALLOC_CATEGORIES) buckets[c] = { amount: 0, count: 0 };

  let tC = 0, tDt = 0, tEbs = 0, tEip = 0;
  const rows = itemRows.map((r) => {
    const tag = tagByKey.get(r.instanceId);
    const category = tag?.category && buckets[tag.category] ? tag.category : (r.instanceId.startsWith("i-") ? "Unmapped" : "Credits/Savings");
    const compute = Number(r.compute), dataTransfer = Number(r.dataTransfer), ebs = Number(r.ebs), eip = Number(r.eip);
    const total = compute + dataTransfer + ebs + eip;
    tC += compute; tDt += dataTransfer; tEbs += ebs; tEip += eip;
    buckets[category].amount += total;
    buckets[category].count += 1;
    return {
      instanceId: r.instanceId,
      name: tag?.label ?? "(stored)",
      region: tag?.region ?? "-",
      type: tag?.instanceType ?? "-",
      state: "-",
      category, matchedKey: tag ? r.instanceId : "-",
      publicIp: "-", privateIp: "-", vpcId: "-",
      compute, dataTransfer, ebs, eip, other: 0, total,
      unit: "USD",
    };
  });

  const monthTotalBill = monthRows.reduce((s, r) => s + Number(r.amount), 0);
  const monthEc2Total = monthRows
    .filter((r) => EC2_SERVICE_KEYS.includes(r.costKey))
    .reduce((s, r) => s + Number(r.amount), 0);

  return {
    stale: true,
    asOf: last.snapshotAt,
    range14: { Start: "(stored)", End: "(stored)" },
    monthRange: mRange,
    month: month ?? null,
    isCurrentMonth: isCurrentMonthKey(month),
    projectionFactor: daysInCurrentMonth() / 14,
    daysInMonth: daysInCurrentMonth(),
    totals: { compute: tC, dataTransfer: tDt, ebs: tEbs, eip: tEip, unattributedEc2Other: 0, total: tC + tDt + tEbs + tEip },
    buckets: [...ALLOC_CATEGORIES, "Unmapped", "Credits/Savings"].map((category) => ({
      category, amount: buckets[category].amount, count: buckets[category].count,
    })),
    rows: rows.sort((a, b) => b.total - a.total),
    monthEc2Total, monthTotalBill,
    taggedServers: tags.length,
  };
}

export const dynamic = "force-dynamic";

const EC2_SERVICE_KEYS = ["Amazon Elastic Compute Cloud - Compute", "EC2 - Other"];

type Component = "dataTransfer" | "ebs" | "eip" | "other";

function classify(usageType: string): Component {
  const u = usageType.toLowerCase();
  if (u.includes("bytes") || u.includes("datatransfer") || u.includes("dataxfer")) return "dataTransfer";
  if (u.includes("ebs") || u.includes("volume")) return "ebs";
  if (u.includes("ipv4") || u.includes("ip4") || u.includes("elasticip") || u.includes("address")) return "eip";
  return "other";
}

/** Display name for a cost row that has no live instance behind it. */
function fallbackName(id: string, amount: number): string {
  if (id.startsWith("i-")) return "(unknown / terminated)";
  if (id.startsWith("nat-")) return "NAT gateway";
  return amount < 0 ? "Credits and discounts (not linked to an instance)" : "Charges not linked to an instance";
}

/** Days in the current calendar month (UTC). */
function daysInCurrentMonth(): number {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Per-instance EC2 cost over the last 14 days, itemized into Compute,
 * Data Transfer, EBS storage and Elastic IP — plus a projectionFactor so the
 * client can show the expected full-current-month figure (run-rate × month).
 *
 * Compute is the instance-hours charge. EC2-Other lines (transfer/EBS/EIP) are
 * attributed back to the instance via volume- and EIP-to-instance maps.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const month = url.searchParams.get("month") ?? undefined;
    // "month" mode (default) — itemized range = month-to-date, clamped to
    // AWS's 14-day resource-level limit (`GetCostAndUsageWithResources`).
    // "14d" mode — itemized range = fixed last 14 days.
    const mode = (url.searchParams.get("mode") ?? "month").toLowerCase();
    const mRange = monthRange(month);
    const fourteen = lastNDaysRange(14);
    // If the requested month starts more than 14 days ago, CE resource-level
    // will only return the last 14 days anyway. Choose the widest range CE
    // will actually honor for per-instance data.
    const range14 = mode === "month" && mRange.Start >= fourteen.Start ? mRange : fourteen;

    let aws;
    try {
      // The itemized range is part of the key: "month" and "14d" modes can ask for different ranges.
      aws = await cached(`alloc-itemized:${month ?? "current"}:${range14.Start}:${range14.End}`, DEFAULT_TTL, async () => {
      const [compute, instances, monthServices, ec2Other, volMap, eipMap, allUsage] = await Promise.all([
        resourceCostForService(SERVICE.EC2, range14),
        getAllInstances(),
        costByGroups(mRange, [{ Type: "DIMENSION", Key: "SERVICE" }]),
        resourceCostForService(SERVICE.EC2_OTHER, range14, "USAGE_TYPE"),
        getVolumeInstanceMap(),
        getEipInstanceMap(),
        // Public-IPv4 / Elastic-IP charges are billed under the VPC service (not
        // EC2-Other), so pull them by usage type across all services.
        costByGroups(range14, [{ Type: "DIMENSION", Key: "USAGE_TYPE" }]),
      ]);
      return { compute, instances, monthServices, ec2Other, volMap, eipMap, allUsage };
      });
    } catch (awsErr) {
      if (isAwsAuthError(awsErr)) {
        const fallback = await ec2FromDb(mRange, month);
        if (fallback) return NextResponse.json(fallback);
      }
      throw awsErr;
    }
    const { compute, instances, monthServices, ec2Other, volMap, eipMap, allUsage } = aws as {
      compute: CostItem[];
      instances: Map<string, InstanceInfo>;
      monthServices: CostItem[];
      ec2Other: CostItem[];
      volMap: Map<string, string>;
      eipMap: Map<string, string>;
      allUsage: CostItem[];
    };

    // Total Public-IPv4 / Elastic-IP cost over the window, split in-use vs idle.
    let pubIpInUse = 0, pubIpIdle = 0;
    for (const it of allUsage) {
      const u = it.key.toLowerCase();
      if (u.includes("publicipv4") || u.includes("elasticip")) {
        if (u.includes("idle")) pubIpIdle += it.amount;
        else pubIpInUse += it.amount;
      }
    }
    // Instances currently holding a public IP share the in-use address cost.
    const hasPubIp = (id: string) => {
      const ip = instances.get(id)?.publicIp;
      return Boolean(ip && ip !== "-");
    };
    const pubIpInstanceCount = compute.filter((c) => hasPubIp(c.key.split("/").pop()!.trim())).length;
    const perInstanceEip = pubIpInstanceCount > 0 ? pubIpInUse / pubIpInstanceCount : 0;

    // Attribute every EC2-Other line to an instance + component.
    const extra = new Map<string, { dataTransfer: number; ebs: number; eip: number; other: number }>();
    const bump = (id: string, comp: Component, amt: number) => {
      const cur = extra.get(id) ?? { dataTransfer: 0, ebs: 0, eip: 0, other: 0 };
      cur[comp] += amt;
      extra.set(id, cur);
    };
    let unattributed = 0;
    for (const row of ec2Other) {
      const [resourceId, usageType = ""] = row.key.split(" / ");
      const comp = classify(usageType);
      let instanceId: string | undefined;
      if (resourceId?.startsWith("i-")) instanceId = resourceId;
      else if (resourceId?.startsWith("vol-")) instanceId = volMap.get(resourceId);
      else if (resourceId?.startsWith("eipalloc-")) instanceId = eipMap.get(resourceId);
      else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(resourceId ?? "")) instanceId = eipMap.get(resourceId);
      if (instanceId) bump(instanceId, comp, row.amount);
      else unattributed += row.amount;
    }

    const alloc = await loadAllocationFromDb();

    const buckets: Record<string, { amount: number; count: number }> = {
      Unmapped: { amount: 0, count: 0 },
      "Credits/Savings": { amount: 0, count: 0 },
    };
    for (const c of ALLOC_CATEGORIES) buckets[c] = { amount: 0, count: 0 };

    let totalCompute = 0, totalDataTransfer = 0, totalEbs = 0, totalEip = 0;
    const rows = compute.map((c) => {
      const id = c.key.split("/").pop()!.trim();
      const info = instances.get(id);
      const ips = [info?.publicIp, info?.privateIp].filter((x): x is string => Boolean(x) && x !== "-");
      const candidates = [id, ...ips];
      let category = id.startsWith("i-") ? "Unmapped" : "Credits/Savings";
      let matchedKey = "-";
      for (const k of candidates) {
        const cat = alloc.ipToCategory.get(k);
        if (cat) { category = cat; matchedKey = k; break; }
      }
      if (!buckets[category]) category = "Other";

      const e = extra.get(id) ?? { dataTransfer: 0, ebs: 0, eip: 0, other: 0 };
      // Elastic-IP / Public-IPv4: attributed share for instances with a public IP.
      const eip = e.eip + (hasPubIp(id) ? perInstanceEip : 0);
      const total = c.amount + e.dataTransfer + e.ebs + eip + e.other;
      buckets[category].amount += total;
      buckets[category].count += 1;
      totalCompute += c.amount;
      totalDataTransfer += e.dataTransfer;
      totalEbs += e.ebs;
      totalEip += eip;

      return {
        instanceId: id,
        name: info?.name ?? fallbackName(id, c.amount),
        region: info?.region ?? "-",
        type: info?.type ?? "-",
        state: info?.state ?? "-",
        category,
        matchedKey,
        publicIp: info?.publicIp ?? "-",
        privateIp: info?.privateIp ?? "-",
        vpcId: info?.vpcId ?? "-",
        compute: c.amount,
        dataTransfer: e.dataTransfer,
        ebs: e.ebs,
        eip,
        other: e.other,
        total,
        unit: c.unit,
      };
    });

    const monthEc2Total = monthServices
      .filter((s) => EC2_SERVICE_KEYS.includes(s.key))
      .reduce((s, i) => s + i.amount, 0);
    const monthTotalBill = monthServices.reduce((s, i) => s + i.amount, 0);

    return NextResponse.json({
      mode,
      range14,
      monthRange: mRange,
      month: month ?? null,
      isCurrentMonth: isCurrentMonthKey(month),
      projectionFactor: daysInCurrentMonth() / 14,
      daysInMonth: daysInCurrentMonth(),
      totals: {
        compute: totalCompute,
        dataTransfer: totalDataTransfer,
        ebs: totalEbs,
        eip: totalEip,
        unattributedEc2Other: unattributed + pubIpIdle,
        total: totalCompute + totalDataTransfer + totalEbs + totalEip,
      },
      buckets: [...ALLOC_CATEGORIES, "Unmapped", "Credits/Savings"].map((category) => ({
        category,
        amount: buckets[category].amount,
        count: buckets[category].count,
      })),
      rows: rows.sort((a, b) => b.total - a.total),
      monthEc2Total,
      monthTotalBill,
      taggedServers: alloc.serverCount,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Allocation request failed" },
      { status: 500 },
    );
  }
}
