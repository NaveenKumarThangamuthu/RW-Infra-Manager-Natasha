/**
 * Fast cost-split-by-tag for the dashboard donut. Reads the latest
 * `tag_cost_snapshot` from the DB (populated by the twice-daily refresh), so
 * the donut loads instantly instead of scanning AWS live.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const now = new Date();
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const projectionFactor = daysInMonth / 14; // 14-day snapshot -> full month

    const latest = await prisma.tagCostSnapshot.findFirst({ orderBy: { snapshotAt: "desc" } });
    if (!latest) {
      return NextResponse.json({ snapshotAt: null, buckets: [], projectionFactor, daysInMonth });
    }
    const rows = await prisma.tagCostSnapshot.findMany({
      where: { snapshotAt: latest.snapshotAt },
    });
    return NextResponse.json({
      snapshotAt: latest.snapshotAt,
      projectionFactor,
      daysInMonth,
      buckets: rows.map((r) => ({ category: r.category, amount: Number(r.amount), unit: r.unit })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Tag split request failed" },
      { status: 500 },
    );
  }
}
