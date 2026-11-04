/**
 * Cost Explorer query helpers — READ ONLY.
 *
 * Service name constants are the exact strings Cost Explorer uses for the
 * SERVICE dimension, so we can filter resource-level queries to one service.
 */
import {
  GetCostAndUsageCommand,
  GetCostAndUsageWithResourcesCommand,
  GetCostForecastCommand,
  GetTagsCommand,
  type GroupDefinition,
} from "@aws-sdk/client-cost-explorer";
import { getCostExplorerClient } from "./aws";

export const SERVICE = {
  EC2: "Amazon Elastic Compute Cloud - Compute",
  EC2_OTHER: "EC2 - Other",
  LAMBDA: "AWS Lambda",
  SNS: "Amazon Simple Notification Service",
} as const;

const METRIC = "UnblendedCost";

export interface CostItem {
  key: string;
  amount: number;
  unit: string;
}

function num(v?: string): number {
  const n = Number(v ?? "0");
  return Number.isFinite(n) ? n : 0;
}

/**
 * Aggregate (sum across the period) cost grouped by one or two dimensions
 * using the standard (non-resource) API. Good for service / region overviews.
 */
export async function costByGroups(
  range: { Start: string; End: string },
  groupBy: GroupDefinition[],
): Promise<CostItem[]> {
  const client = getCostExplorerClient();
  const totals = new Map<string, { amount: number; unit: string }>();
  let nextToken: string | undefined;

  do {
    const res = await client.send(
      new GetCostAndUsageCommand({
        TimePeriod: range,
        Granularity: "MONTHLY",
        Metrics: [METRIC],
        GroupBy: groupBy,
        NextPageToken: nextToken,
      }),
    );

    for (const period of res.ResultsByTime ?? []) {
      for (const g of period.Groups ?? []) {
        const key = (g.Keys ?? []).join(" / ") || "Unknown";
        const m = g.Metrics?.[METRIC];
        const prev = totals.get(key) ?? { amount: 0, unit: m?.Unit ?? "USD" };
        prev.amount += num(m?.Amount);
        prev.unit = m?.Unit ?? prev.unit;
        totals.set(key, prev);
      }
    }
    nextToken = res.NextPageToken;
  } while (nextToken);

  return [...totals.entries()]
    .map(([key, v]) => ({ key, amount: v.amount, unit: v.unit }))
    .sort((a, b) => b.amount - a.amount);
}

export interface MultiKeyItem {
  keys: string[];
  amount: number;
  unit: string;
}

/**
 * Like costByGroups but keeps each grouping dimension as a separate key element
 * (no joining), so callers can reliably parse usage-type vs region etc.
 */
export async function costByGroupsRaw(
  range: { Start: string; End: string },
  groupBy: GroupDefinition[],
): Promise<MultiKeyItem[]> {
  const client = getCostExplorerClient();
  const totals = new Map<string, { keys: string[]; amount: number; unit: string }>();
  let nextToken: string | undefined;

  do {
    const res = await client.send(
      new GetCostAndUsageCommand({
        TimePeriod: range,
        Granularity: "MONTHLY",
        Metrics: [METRIC],
        GroupBy: groupBy,
        NextPageToken: nextToken,
      }),
    );

    for (const period of res.ResultsByTime ?? []) {
      for (const g of period.Groups ?? []) {
        const keys = g.Keys ?? [];
        const mapKey = JSON.stringify(keys);
        const m = g.Metrics?.[METRIC];
        const prev = totals.get(mapKey) ?? { keys, amount: 0, unit: m?.Unit ?? "USD" };
        prev.amount += num(m?.Amount);
        prev.unit = m?.Unit ?? prev.unit;
        totals.set(mapKey, prev);
      }
    }
    nextToken = res.NextPageToken;
  } while (nextToken);

  return [...totals.values()].sort((a, b) => b.amount - a.amount);
}

export interface DailyPoint {
  date: string;
  amount: number;
}

/** Total unblended cost per day across a range (no grouping). */
export async function dailyTotals(range: { Start: string; End: string }): Promise<DailyPoint[]> {
  const client = getCostExplorerClient();
  const res = await client.send(
    new GetCostAndUsageCommand({
      TimePeriod: range,
      Granularity: "DAILY",
      Metrics: [METRIC],
    }),
  );
  return (res.ResultsByTime ?? []).map((p) => ({
    date: p.TimePeriod?.Start ?? "",
    amount: num(p.Total?.[METRIC]?.Amount),
  }));
}

/** List the cost-allocation tag KEYS available in a time range. */
export async function tagKeys(range: { Start: string; End: string }): Promise<string[]> {
  const client = getCostExplorerClient();
  const keys: string[] = [];
  let nextToken: string | undefined;
  do {
    const res = await client.send(new GetTagsCommand({ TimePeriod: range, NextPageToken: nextToken }));
    keys.push(...(res.Tags ?? []));
    nextToken = res.NextPageToken;
  } while (nextToken);
  return keys.filter(Boolean);
}

/** Forecasted spend for the rest of the current month. Returns null if CE has too little history. */
export async function forecastSpend(range: { Start: string; End: string }): Promise<number | null> {
  try {
    const client = getCostExplorerClient();
    const res = await client.send(
      new GetCostForecastCommand({
        TimePeriod: range,
        Metric: "UNBLENDED_COST",
        Granularity: "MONTHLY",
      }),
    );
    return num(res.Total?.Amount);
  } catch {
    return null;
  }
}

/**
 * Per-RESOURCE cost for a single service, summed across the (<=14 day) range.
 * Requires "Resource-level data" enabled in Cost Explorer settings.
 * Optionally adds a second group dimension (e.g. USAGE_TYPE) — CE allows max 2.
 */
export async function resourceCostForService(
  service: string,
  range: { Start: string; End: string },
  secondGroup?: "USAGE_TYPE" | "REGION",
): Promise<CostItem[]> {
  const client = getCostExplorerClient();
  const totals = new Map<string, { amount: number; unit: string }>();
  let nextToken: string | undefined;

  const groupBy: GroupDefinition[] = [{ Type: "DIMENSION", Key: "RESOURCE_ID" }];
  if (secondGroup) groupBy.push({ Type: "DIMENSION", Key: secondGroup });

  do {
    const res = await client.send(
      new GetCostAndUsageWithResourcesCommand({
        TimePeriod: range,
        Granularity: "DAILY",
        Metrics: [METRIC],
        Filter: { Dimensions: { Key: "SERVICE", Values: [service] } },
        GroupBy: groupBy,
        NextPageToken: nextToken,
      }),
    );

    for (const period of res.ResultsByTime ?? []) {
      for (const g of period.Groups ?? []) {
        const key = (g.Keys ?? []).join(" / ") || "NoResourceId";
        const m = g.Metrics?.[METRIC];
        const prev = totals.get(key) ?? { amount: 0, unit: m?.Unit ?? "USD" };
        prev.amount += num(m?.Amount);
        prev.unit = m?.Unit ?? prev.unit;
        totals.set(key, prev);
      }
    }
    nextToken = res.NextPageToken;
  } while (nextToken);

  return [...totals.entries()]
    .map(([key, v]) => ({ key, amount: v.amount, unit: v.unit }))
    .sort((a, b) => b.amount - a.amount);
}

export interface ResourceDailyItem {
  resourceId: string;
  date: string;
  amount: number;
  unit: string;
}

/**
 * Per-RESOURCE, per-DAY cost for a single service over the (<=14 day) range —
 * one row per (resource, day), not summed. Used to accumulate per-instance
 * history in the DB beyond AWS's 14-day resource-level retention.
 */
export async function resourceDailyForService(
  service: string,
  range: { Start: string; End: string },
): Promise<ResourceDailyItem[]> {
  const client = getCostExplorerClient();
  const out: ResourceDailyItem[] = [];
  let nextToken: string | undefined;

  do {
    const res = await client.send(
      new GetCostAndUsageWithResourcesCommand({
        TimePeriod: range,
        Granularity: "DAILY",
        Metrics: [METRIC],
        Filter: { Dimensions: { Key: "SERVICE", Values: [service] } },
        GroupBy: [{ Type: "DIMENSION", Key: "RESOURCE_ID" }],
        NextPageToken: nextToken,
      }),
    );

    for (const period of res.ResultsByTime ?? []) {
      const date = period.TimePeriod?.Start ?? "";
      for (const g of period.Groups ?? []) {
        const resourceId = (g.Keys ?? [])[0] ?? "NoResourceId";
        const m = g.Metrics?.[METRIC];
        if (!date) continue;
        out.push({ resourceId, date, amount: num(m?.Amount), unit: m?.Unit ?? "USD" });
      }
    }
    nextToken = res.NextPageToken;
  } while (nextToken);

  return out;
}
