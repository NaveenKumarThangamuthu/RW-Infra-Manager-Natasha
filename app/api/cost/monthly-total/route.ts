/**
 * Total cost per month for the last 12 months, from the DB (monthly_cost,
 * SERVICE dimension summed per month). Powers the dashboard 12-month line.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await prisma.monthlyCost.findMany({
      where: { dimension: "SERVICE" },
      select: { month: true, amount: true },
    });
    const byMonth = new Map<string, number>();
    for (const r of rows) byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + Number(r.amount));

    const series = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([month, amount]) => ({ month, amount }));

    return NextResponse.json({ series });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Monthly total request failed" },
      { status: 500 },
    );
  }
}
