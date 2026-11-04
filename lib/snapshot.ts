/**
 * Snapshot engine — the single routine run by the twice-daily cron and the
 * one-time backfill. READ-ONLY against AWS (Get/Describe/List only); writes
 * only to the local MySQL DB.
 *
 * Each run captures:
 *   1. Current-month monthly cost by SERVICE and by REGION  -> monthly_cost (upsert)
 *   2. Per-resource cost (last 14 days) for EC2/Lambda/SNS  -> resource_cost_snapshot
 *   3. EC2 cost allocated to 2.0/3.0/Infra/... categories   -> tag_cost_snapshot
 */
import { costByGroups, resourceCostForService, resourceDailyForService, SERVICE } from "./costExplorer";
import { ec2ItemizedByInstance } from "./ec2Itemized";
import { getAllInstances } from "./ec2";
import { loadAllocationFromDb, ALLOC_CATEGORIES } from "./allocationDb";
import { currentMonthRange, lastNDaysRange, trailingMonthsRange } from "./dates";
import { prisma } from "./db";

function monthKeyFromRange(start: string): string {
  return start.slice(0, 7); // YYYY-MM
}

/** Upsert current-month monthly aggregates for SERVICE and REGION dimensions. */
async function snapshotMonthly(): Promise<number> {
  const range = currentMonthRange();
  const month = monthKeyFromRange(range.Start);

  const [byService, byRegion] = await Promise.all([
    costByGroups(range, [{ Type: "DIMENSION", Key: "SERVICE" }]),
    costByGroups(range, [{ Type: "DIMENSION", Key: "REGION" }]),
  ]);

  let n = 0;
  for (const [dimension, items] of [
    ["SERVICE", byService] as const,
    ["REGION", byRegion] as const,
  ]) {
    for (const item of items) {
      await prisma.monthlyCost.upsert({
        where: { month_dimension_key: { month, dimension, costKey: item.key } },
        update: { amount: item.amount, unit: item.unit, snapshotAt: new Date() },
        create: { month, dimension, costKey: item.key, amount: item.amount, unit: item.unit },
      });
      n++;
    }
  }
  return n;
}

/** Insert per-resource cost rows (14-day window) for EC2/Lambda/SNS. */
async function snapshotResources(runLabel: string): Promise<number> {
  const range = lastNDaysRange(14);

  const [ec2, lambda, sns] = await Promise.all([
    resourceCostForService(SERVICE.EC2, range),
    resourceCostForService(SERVICE.LAMBDA, range, "USAGE_TYPE"),
    resourceCostForService(SERVICE.SNS, range, "USAGE_TYPE"),
  ]);

  const rows: {
    runLabel: string;
    service: string;
    resourceId: string;
    usageType: string | null;
    amount: number;
    unit: string;
    rangeStart: string;
    rangeEnd: string;
  }[] = [];

  const push = (service: string, items: { key: string; amount: number; unit: string }[]) => {
    for (const it of items) {
      const parts = it.key.split(" / ");
      rows.push({
        runLabel,
        service,
        resourceId: parts[0] ?? it.key,
        usageType: parts[1] ?? null,
        amount: it.amount,
        unit: it.unit,
        rangeStart: range.Start,
        rangeEnd: range.End,
      });
    }
  };
  push("EC2", ec2);
  push("LAMBDA", lambda);
  push("SNS", sns);

  if (rows.length > 0) {
    await prisma.resourceCostSnapshot.createMany({ data: rows });
  }
  return rows.length;
}

/**
 * Accumulate per-instance/function/topic daily cost into resource_daily_cost.
 * Runs for EC2, LAMBDA, and SNS. Upserted by (service, resourceId, date) so
 * overlapping 14-day windows never double-count — this is what lets
 * per-resource history exceed AWS's 14-day resource-level retention.
 */
async function snapshotDailyResources(): Promise<number> {
  const range = lastNDaysRange(14);
  const services: Array<{ svc: string; key: string }> = [
    { svc: "EC2", key: SERVICE.EC2 },
    { svc: "LAMBDA", key: SERVICE.LAMBDA },
    { svc: "SNS", key: SERVICE.SNS },
  ];
  let n = 0;
  for (const { svc, key } of services) {
    let daily: Array<{ resourceId: string; date: string; amount: number; unit: string }>;
    try {
      daily = await resourceDailyForService(key, range);
    } catch {
      // Some accounts have Lambda/SNS with zero resource-level rows; skip failures gracefully.
      continue;
    }
    for (const d of daily) {
      const resourceId = d.resourceId.slice(0, 255);
      await prisma.resourceDailyCost.upsert({
        where: { service_resource_date: { service: svc, resourceId, date: d.date } },
        update: { amount: d.amount, unit: d.unit },
        create: { service: svc, resourceId, date: d.date, amount: d.amount, unit: d.unit },
      });
      n++;
    }
  }
  return n;
}

/**
 * Store per-instance itemized EC2 cost (compute/DT/EBS/EIP) for the current
 * month. AWS Cost Explorer only exposes resource-level data for the last
 * 14 days, so early in the month this is a true month-to-date breakdown;
 * mid-month it's the last 14 days (which is what CE will return anyway).
 * The daily accumulation table (resource_daily_cost) covers the earlier gap.
 */
async function snapshotEc2Itemized(runLabel: string): Promise<number> {
  const monthR = currentMonthRange();
  // Clamp the itemized range to <=14 days ago (CE limit) but as close to
  // start-of-month as possible.
  const range14 = lastNDaysRange(14);
  const itemizedRange = monthR.Start >= range14.Start ? monthR : range14;
  const { items } = await ec2ItemizedByInstance(itemizedRange, monthR);
  const data = [...items.entries()].map(([instanceId, v]) => ({
    runLabel,
    instanceId: instanceId.slice(0, 255),
    compute: v.compute,
    dataTransfer: v.dataTransfer,
    ebs: v.ebs,
    eip: v.eip,
  }));
  if (data.length > 0) await prisma.ec2ItemizedSnapshot.createMany({ data });
  return data.length;
}

/** Allocate EC2 resource cost to tag categories and snapshot per-category totals. */
async function snapshotTagCosts(runLabel: string): Promise<number> {
  const range = lastNDaysRange(14);
  const [costs, instances, alloc] = await Promise.all([
    resourceCostForService(SERVICE.EC2, range),
    getAllInstances(),
    loadAllocationFromDb(),
  ]);

  const buckets: Record<string, number> = { Unmapped: 0, "Credits/Savings": 0 };
  for (const c of ALLOC_CATEGORIES) buckets[c] = 0;

  for (const c of costs) {
    const id = c.key.split("/").pop()!.trim();
    const info = instances.get(id);
    const candidateIps = [info?.publicIp, info?.privateIp].filter(
      (x): x is string => Boolean(x) && x !== "-",
    );
    // Match by instance id first, then by any IP.
    const candidates = [id, ...candidateIps];
    let category = id.startsWith("i-") ? "Unmapped" : "Credits/Savings";
    for (const k of candidates) {
      const cat = alloc.ipToCategory.get(k);
      if (cat) {
        category = cat;
        break;
      }
    }
    if (buckets[category] === undefined) category = "Other";
    buckets[category] += c.amount;
  }

  const data = Object.entries(buckets).map(([category, amount]) => ({
    runLabel,
    category,
    amount,
    unit: "USD",
  }));
  await prisma.tagCostSnapshot.createMany({ data });
  return data.length;
}

/** Run a full cron snapshot. `runLabel` is e.g. "09:00" / "15:00". */
export async function runSnapshot(runLabel: string): Promise<{ runId: number; counts: Record<string, number> }> {
  const run = await prisma.refreshRun.create({
    data: { kind: "cron", runLabel, status: "running" },
  });
  try {
    const monthly = await snapshotMonthly();
    const resources = await snapshotResources(runLabel);
    const tags = await snapshotTagCosts(runLabel);
    const daily = await snapshotDailyResources();
    const itemized = await snapshotEc2Itemized(runLabel);
    await prisma.refreshRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        message: `monthly=${monthly} resources=${resources} tagBuckets=${tags} daily=${daily} itemized=${itemized}`,
      },
    });
    return { runId: run.id, counts: { monthly, resources, tags, daily, itemized } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.refreshRun.update({
      where: { id: run.id },
      data: { status: "error", finishedAt: new Date(), message },
    });
    throw err;
  }
}

/**
 * One-time historical backfill of monthly SERVICE + REGION aggregates.
 * `months` defaults to 36 (3 years). AWS Cost Explorer serves up to 38 months;
 * months with no data are simply skipped.
 */
export async function runBackfill(months = 36): Promise<{ runId: number; rows: number }> {
  const run = await prisma.refreshRun.create({
    data: { kind: "backfill", status: "running", message: `months=${months}` },
  });
  try {
    const range = trailingMonthsRange(months);
    const [byService, byRegion] = await Promise.all([
      // MONTHLY granularity returns one figure per month per group.
      monthlyByDimension(range, "SERVICE"),
      monthlyByDimension(range, "REGION"),
    ]);

    let rows = 0;
    for (const rec of [...byService, ...byRegion]) {
      await prisma.monthlyCost.upsert({
        where: {
          month_dimension_key: { month: rec.month, dimension: rec.dimension, costKey: rec.key },
        },
        update: { amount: rec.amount, unit: rec.unit, snapshotAt: new Date() },
        create: {
          month: rec.month,
          dimension: rec.dimension,
          costKey: rec.key,
          amount: rec.amount,
          unit: rec.unit,
        },
      });
      rows++;
    }

    await prisma.refreshRun.update({
      where: { id: run.id },
      data: { status: "success", finishedAt: new Date(), message: `rows=${rows}` },
    });
    return { runId: run.id, rows };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.refreshRun.update({
      where: { id: run.id },
      data: { status: "error", finishedAt: new Date(), message },
    });
    throw err;
  }
}

interface MonthlyRecord {
  month: string;
  dimension: string;
  key: string;
  amount: number;
  unit: string;
}

/**
 * Monthly cost per group, one row per (month, group) — needed for backfill so
 * each month is stored separately rather than summed across the range.
 */
async function monthlyByDimension(
  range: { Start: string; End: string },
  dimension: "SERVICE" | "REGION",
): Promise<MonthlyRecord[]> {
  const { GetCostAndUsageCommand } = await import("@aws-sdk/client-cost-explorer");
  const { getCostExplorerClient } = await import("./aws");
  const client = getCostExplorerClient();
  const out: MonthlyRecord[] = [];
  let nextToken: string | undefined;

  do {
    const res = await client.send(
      new GetCostAndUsageCommand({
        TimePeriod: range,
        Granularity: "MONTHLY",
        Metrics: ["UnblendedCost"],
        GroupBy: [{ Type: "DIMENSION", Key: dimension }],
        NextPageToken: nextToken,
      }),
    );
    for (const period of res.ResultsByTime ?? []) {
      const month = (period.TimePeriod?.Start ?? "").slice(0, 7);
      for (const g of period.Groups ?? []) {
        const key = (g.Keys ?? []).join(" / ") || "Unknown";
        const m = g.Metrics?.UnblendedCost;
        const amount = Number(m?.Amount ?? "0");
        if (!month) continue;
        out.push({ month, dimension, key, amount: Number.isFinite(amount) ? amount : 0, unit: m?.Unit ?? "USD" });
      }
    }
    nextToken = res.NextPageToken;
  } while (nextToken);

  return out;
}
