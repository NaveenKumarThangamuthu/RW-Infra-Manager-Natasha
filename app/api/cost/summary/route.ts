import { NextResponse } from "next/server";
import { costByGroups, dailyTotals } from "@/lib/costExplorer";
import { monthRange, isCurrentMonthKey, prevMonthKey } from "@/lib/dates";
import { cached, DEFAULT_TTL } from "@/lib/cache";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function isAwsAuthError(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    m.includes("expired") || m.includes("token") || m.includes("credential") ||
    m.includes("security") || m.includes("auth") || m.includes("session") ||
    m.includes("unable to locate") || m.includes("access denied") || m.includes("reauthenticate")
  );
}

interface CostItem { key: string; amount: number; unit: string }

async function prevMonthCosts(key: string): Promise<{ total: number; byService: Record<string, number>; byRegion: Record<string, number> }> {
  const rows = await prisma.monthlyCost.findMany({ where: { month: key } });
  const byService: Record<string, number> = {};
  const byRegion: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const amt = Number(r.amount);
    if (r.dimension === "SERVICE") byService[r.costKey] = amt;
    else if (r.dimension === "REGION") byRegion[r.costKey] = amt;
    total += r.dimension === "SERVICE" ? amt : 0;
  }
  return { total, byService, byRegion };
}

/** `factor` scales the previous month down to the part of it that is comparable with the month so far. */
function attachDeltas(
  items: CostItem[],
  prev: Record<string, number>,
  factor = 1,
): Array<CostItem & { prev: number; deltaPct: number | null }> {
  return items.map((i) => {
    const p = (prev[i.key] ?? 0) * factor;
    const deltaPct = p > 0 ? +(((i.amount - p) / p) * 100).toFixed(1) : i.amount > 0 ? null : 0;
    return { ...i, prev: p, deltaPct };
  });
}

/** AWS is still adding charges to today and yesterday (UTC), so those two days are not complete. */
const PARTIAL_DAYS = 2;
const RUN_RATE_DAYS = 7;

function utcDayKey(offsetDays: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays)).toISOString().slice(0, 10);
}

function daysInMonthOf(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The six largest lines, leaving out anything that rounds to $0.00. */
const topSix = (items: CostItem[]) => items.filter((i) => Math.abs(i.amount) >= 0.005).slice(0, 6);

const sum = (points: Array<{ amount: number }>) => points.reduce((s, p) => s + p.amount, 0);

/** Share of the previous month that lines up with the month so far (1 for a finished month). */
function sameDayPrev(prevTotal: number, prevKey: string, factorDays: number | null) {
  const factor = factorDays == null ? 1 : Math.min(1, factorDays / daysInMonthOf(prevKey));
  return { factor, sameDayTotal: prevTotal * factor };
}

/** Rebuild the summary from the last stored monthly snapshot when AWS is down. */
async function summaryFromDb(month: string | undefined) {
  const range = monthRange(month);
  const key = range.Start.slice(0, 7);
  const rows = await prisma.monthlyCost.findMany({ where: { month: key } });
  if (rows.length === 0) return null;

  const services = rows
    .filter((r) => r.dimension === "SERVICE")
    .map((r) => ({ key: r.costKey, amount: Number(r.amount), unit: r.unit }))
    .sort((a, b) => b.amount - a.amount);
  const regions = rows
    .filter((r) => r.dimension === "REGION")
    .map((r) => ({ key: r.costKey, amount: Number(r.amount), unit: r.unit }))
    .sort((a, b) => b.amount - a.amount);
  const mtdTotal = services.reduce((s, i) => s + i.amount, 0);
  const asOf = rows.reduce<Date | null>((acc, r) => (!acc || r.snapshotAt > acc ? r.snapshotAt : acc), null);

  const current = isCurrentMonthKey(month);
  const prevKey = prevMonthKey(month);
  const prev = await prevMonthCosts(prevKey);
  // Without a daily trend, the days before the saved snapshot's own day are the comparable part.
  const elapsed = current && asOf ? Math.max(1, asOf.getUTCDate() - 1) : null;
  const { factor, sameDayTotal } = sameDayPrev(prev.total, prevKey, elapsed);
  const deltaPct = sameDayTotal > 0 ? +(((mtdTotal - sameDayTotal) / sameDayTotal) * 100).toFixed(1) : null;

  return {
    stale: true,
    asOf,
    month: month ?? null,
    range,
    isCurrentMonth: current,
    mtdTotal,
    last7: 0,
    avgPerDay: 0,
    completeDays: 0,
    partialDays: 0,
    projectedMonth: null,
    forecastRest: null,
    topServices: attachDeltas(topSix(services), prev.byService, factor),
    topRegions: attachDeltas(topSix(regions), prev.byRegion, factor),
    trend: [],
    prev: { month: prevKey, total: prev.total, sameDayTotal, deltaPct },
  };
}

/** Personal dashboard summary for a month. `?month=YYYY-MM` (default: current). */
export async function GET(req: Request) {
  try {
    const month = new URL(req.url).searchParams.get("month") ?? undefined;

    let payload;
    try {
      payload = await cached(`summary:${month ?? "current"}`, DEFAULT_TTL, async () => {
        const range = monthRange(month);
        const current = isCurrentMonthKey(month);

        const prevKey = prevMonthKey(month);

        const [byService, byRegion, trend, prev] = await Promise.all([
          costByGroups(range, [{ Type: "DIMENSION", Key: "SERVICE" }]),
          costByGroups(range, [{ Type: "DIMENSION", Key: "REGION" }]),
          dailyTotals(range),
          prevMonthCosts(prevKey),
        ]);

        const mtdTotal = byService.reduce((s, i) => s + i.amount, 0);
        // Days AWS has finished reporting. A past month is complete throughout.
        const firstPartial = utcDayKey(1 - PARTIAL_DAYS);
        const complete = current ? trend.filter((p) => p.date < firstPartial) : trend;
        const partial = current ? trend.filter((p) => p.date >= firstPartial) : [];

        // Run rate: the last 7 complete days. Early in a month they reach back into the previous one.
        let window = complete.slice(-RUN_RATE_DAYS);
        if (current && window.length < RUN_RATE_DAYS) {
          window = await dailyTotals({ Start: utcDayKey(1 - PARTIAL_DAYS - RUN_RATE_DAYS), End: firstPartial });
        }
        const last7 = sum(window);
        const runRate = window.length ? last7 / window.length : 0;
        const avgPerDay = complete.length ? sum(complete) / complete.length : runRate;

        // Run-rate forecast: what the complete days cost, plus the run rate for every other day of the month.
        const monthDays = daysInMonthOf(range.Start.slice(0, 7));
        const projectedMonth = current && runRate > 0
          ? Math.max(mtdTotal, sum(complete) + runRate * (monthDays - complete.length))
          : null;
        const forecastRest = projectedMonth != null ? projectedMonth - mtdTotal : null;

        // Compare with the same point of the previous month: its daily average times the days
        // reported so far, where a half-reported day counts as the fraction of a normal day it has reached.
        const partialAsDays = avgPerDay > 0 ? Math.min(partial.length, sum(partial) / avgPerDay) : partial.length;
        const { factor, sameDayTotal } = sameDayPrev(prev.total, prevKey, current ? complete.length + partialAsDays : null);
        const deltaPct = sameDayTotal > 0 ? +(((mtdTotal - sameDayTotal) / sameDayTotal) * 100).toFixed(1) : null;

        return {
          month: month ?? null,
          range,
          isCurrentMonth: current,
          mtdTotal,
          last7,
          avgPerDay,
          completeDays: complete.length,
          partialDays: partial.length,
          projectedMonth,
          forecastRest,
          topServices: attachDeltas(topSix(byService), prev.byService, factor),
          topRegions: attachDeltas(topSix(byRegion), prev.byRegion, factor),
          trend,
          prev: { month: prevKey, total: prev.total, sameDayTotal, deltaPct },
        };
      });
    } catch (awsErr) {
      if (isAwsAuthError(awsErr)) {
        const fallback = await summaryFromDb(month);
        if (fallback) return NextResponse.json(fallback);
      }
      throw awsErr;
    }
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Summary request failed" },
      { status: 500 },
    );
  }
}
