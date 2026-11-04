import { NextResponse } from "next/server";
import { costByGroups, dailyTotals, forecastSpend } from "@/lib/costExplorer";
import { monthRange, isCurrentMonthKey, restOfMonthRange, prevMonthKey } from "@/lib/dates";
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

function attachDeltas(
  items: CostItem[],
  prev: Record<string, number>,
): Array<CostItem & { prev: number; deltaPct: number | null }> {
  return items.map((i) => {
    const p = prev[i.key] ?? 0;
    const deltaPct = p > 0 ? +(((i.amount - p) / p) * 100).toFixed(1) : i.amount > 0 ? null : 0;
    return { ...i, prev: p, deltaPct };
  });
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

  const prev = await prevMonthCosts(prevMonthKey(month));
  const deltaPct = prev.total > 0 ? +(((mtdTotal - prev.total) / prev.total) * 100).toFixed(1) : null;

  return {
    stale: true,
    asOf,
    month: month ?? null,
    range,
    isCurrentMonth: isCurrentMonthKey(month),
    mtdTotal,
    last7: 0,
    avgPerDay: 0,
    projectedMonth: null,
    forecastRest: null,
    topServices: attachDeltas(services.slice(0, 6), prev.byService),
    topRegions: attachDeltas(regions.slice(0, 6), prev.byRegion),
    trend: [],
    prev: { month: prevMonthKey(month), total: prev.total, deltaPct },
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

        const [byService, byRegion, trend, forecastRest, prev] = await Promise.all([
          costByGroups(range, [{ Type: "DIMENSION", Key: "SERVICE" }]),
          costByGroups(range, [{ Type: "DIMENSION", Key: "REGION" }]),
          dailyTotals(range),
          current ? forecastSpend(restOfMonthRange()) : Promise.resolve(null),
          prevMonthCosts(prevMonthKey(month)),
        ]);

        const mtdTotal = byService.reduce((s, i) => s + i.amount, 0);
        const last7 = trend.slice(-7).reduce((s, p) => s + p.amount, 0);
        const avgPerDay = trend.length ? trend.reduce((s, p) => s + p.amount, 0) / trend.length : 0;
        const projectedMonth = current && forecastRest != null ? mtdTotal + forecastRest : null;
        const deltaPct = prev.total > 0 ? +(((mtdTotal - prev.total) / prev.total) * 100).toFixed(1) : null;

        return {
          month: month ?? null,
          range,
          isCurrentMonth: current,
          mtdTotal,
          last7,
          avgPerDay,
          projectedMonth,
          forecastRest,
          topServices: attachDeltas(byService.slice(0, 6), prev.byService),
          topRegions: attachDeltas(byRegion.slice(0, 6), prev.byRegion),
          trend,
          prev: { month: prevMonthKey(month), total: prev.total, deltaPct },
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
