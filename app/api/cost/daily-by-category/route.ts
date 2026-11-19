/**
 * Per-category daily spend feed for the dashboard's "2.0 vs 3.0" chart.
 *
 * Joins `ResourceDailyCost` (EC2 per-instance daily cost) with `server_tag`
 * (category assignment) and returns a series of `{ date, "2.0": $, "3.0": $, "Infra": $, ... }`.
 *
 * Query params:
 *   days=7|14|30|60|90 (default 30)
 *
 * Only reads from the DB — accumulates across AWS's 14-day retention because
 * we've been snapshotting into ResourceDailyCost since the app was deployed.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const VALID_DAYS = new Set([7, 14, 30, 60, 90]);

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const daysRaw = Number(new URL(req.url).searchParams.get("days") ?? 30);
  const days = VALID_DAYS.has(daysRaw) ? daysRaw : 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const [tags, dailyRows] = await Promise.all([
    prisma.serverTag.findMany({ select: { matchKey: true, category: true } }),
    prisma.resourceDailyCost.findMany({
      where: { service: "EC2", date: { gte: since } },
      orderBy: { date: "asc" },
    }),
  ]);

  const tagByKey = new Map(tags.map((t) => [t.matchKey, t.category]));
  const CATEGORIES = ["2.0", "3.0", "Infra", "Dev", "Shared", "Not using", "Other"];

  // Bucket: date -> category -> amount
  const bucket = new Map<string, Record<string, number>>();
  const dates = new Set<string>();
  const firstPartialDay = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  for (const r of dailyRows) {
    // Servers only: the credit line ("NoResourceId") and NAT gateways are not instances and have no category.
    if (!r.resourceId.startsWith("i-")) continue;
    // The column holds either "2026-11-18" or "2026-11-18T00:00:00Z".
    const date = r.date.slice(0, 10);
    // AWS keeps adding charges to today and yesterday (UTC), so those days are not complete yet.
    if (date >= firstPartialDay) continue;
    dates.add(date);
    const cat = tagByKey.get(r.resourceId) ?? "Other";
    if (!bucket.has(date)) bucket.set(date, {});
    const perDate = bucket.get(date)!;
    perDate[cat] = (perDate[cat] ?? 0) + Number(r.amount);
  }

  const sortedDates = [...dates].sort();
  const series = sortedDates.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const cat of CATEGORIES) {
      row[cat] = +((bucket.get(date)?.[cat] ?? 0)).toFixed(2);
    }
    return row;
  });

  const totals: Record<string, number> = {};
  for (const cat of CATEGORIES) {
    totals[cat] = +series.reduce((s, r) => s + Number(r[cat] ?? 0), 0).toFixed(2);
  }
  const grand = +Object.values(totals).reduce((s, v) => s + v, 0).toFixed(2);

  return NextResponse.json({
    ok: true,
    days,
    categories: CATEGORIES,
    series,
    totals,
    grandTotal: grand,
    since: sortedDates[0] ?? since,
  });
}
