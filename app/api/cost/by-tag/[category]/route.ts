/**
 * Per-tag landing page data — total spend (this & prev month), top instances,
 * 12-month trend, and the server roster for the category.
 *
 * Reads from DB only (no live AWS) — uses ResourceDailyCost + Ec2ItemizedSnapshot
 * + ServerTag + MonthlyCost. Pages load instantly.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { currentMonthKey, prevMonthKey } from "@/lib/dates";
import { budgetFor, budgetStatus } from "@/lib/budgets";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const VALID = new Set(["2.0", "3.0", "Infra", "Dev", "Shared", "Not using", "Other"]);

export async function GET(req: Request, ctx: { params: Promise<{ category: string }> }) {
  const params = await ctx.params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const category = decodeURIComponent(params.category);
  if (!VALID.has(category)) {
    return NextResponse.json({ error: `Unknown category "${category}"` }, { status: 400 });
  }

  // Servers in this category
  const servers = await prisma.serverTag.findMany({
    where: { category },
    orderBy: [{ instanceType: "asc" }, { matchKey: "asc" }],
  });
  const instanceIds = servers.map((s) => s.matchKey).filter((k) => k.startsWith("i-"));

  // Latest itemized snapshot (Compute + DT + EBS + EIP per instance)
  const latestItem = await prisma.ec2ItemizedSnapshot.findFirst({
    orderBy: { snapshotAt: "desc" },
    select: { snapshotAt: true },
  });
  const itemRows = latestItem
    ? await prisma.ec2ItemizedSnapshot.findMany({
        where: { snapshotAt: latestItem.snapshotAt, instanceId: { in: instanceIds } },
      })
    : [];

  // Tag-bucket totals — current & prev month from tag_cost_snapshot
  const latestTagSnap = await prisma.tagCostSnapshot.findFirst({
    orderBy: { snapshotAt: "desc" },
    select: { snapshotAt: true },
  });
  const tagRows = latestTagSnap
    ? await prisma.tagCostSnapshot.findMany({ where: { snapshotAt: latestTagSnap.snapshotAt } })
    : [];

  // Build server roster joined with their latest itemized cost
  const itemById = new Map(itemRows.map((r) => [r.instanceId, r]));
  const roster = servers.map((s) => {
    const it = itemById.get(s.matchKey);
    const compute = it ? Number(it.compute) : 0;
    const dataTransfer = it ? Number(it.dataTransfer) : 0;
    const ebs = it ? Number(it.ebs) : 0;
    const eip = it ? Number(it.eip) : 0;
    return {
      matchKey: s.matchKey,
      label: s.label ?? "",
      region: s.region ?? "",
      instanceType: s.instanceType ?? "",
      services: s.services ?? "",
      cost14d: +(compute + dataTransfer + ebs + eip).toFixed(2),
      compute: +compute.toFixed(2),
      dataTransfer: +dataTransfer.toFixed(2),
      ebs: +ebs.toFixed(2),
      eip: +eip.toFixed(2),
    };
  });
  roster.sort((a, b) => b.cost14d - a.cost14d);
  const total14d = roster.reduce((s, r) => s + r.cost14d, 0);

  // Daily series (last 30 days) summed across this category's instance ids
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const dailyRows = instanceIds.length
    ? await prisma.resourceDailyCost.findMany({
        where: { service: "EC2", resourceId: { in: instanceIds }, date: { gte: since } },
        orderBy: { date: "asc" },
      })
    : [];
  const dailyByDate = new Map<string, number>();
  for (const r of dailyRows) {
    // The column holds either "2026-11-18" or "2026-11-18T00:00:00Z".
    const date = r.date.slice(0, 10);
    // A row last written during its own day is still filling in at AWS: leave that day out.
    if (r.updatedAt.toISOString().slice(0, 10) <= date) continue;
    dailyByDate.set(date, (dailyByDate.get(date) ?? 0) + Number(r.amount));
  }
  const trend = [...dailyByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amount]) => ({ date, amount: +amount.toFixed(2) }));

  // Find category total this month + prev month from tag snapshot (closest proxy)
  const thisMonthAmt = tagRows.find((r) => r.category === category) ? Number(tagRows.find((r) => r.category === category)!.amount) : 0;
  const prevMonth = prevMonthKey();
  const prevMonthRows = await prisma.tagCostSnapshot.findMany({
    where: { snapshotAt: { lt: new Date(Date.now() - 28 * 86_400_000) }, category },
    orderBy: { snapshotAt: "desc" },
    take: 1,
  });
  const prevMonthAmt = prevMonthRows[0] ? Number(prevMonthRows[0].amount) : 0;
  const deltaPct = prevMonthAmt > 0 ? +(((thisMonthAmt - prevMonthAmt) / prevMonthAmt) * 100).toFixed(1) : null;

  // Budget + projection
  const now = new Date();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const dayOfMonth = now.getUTCDate();
  const budget = budgetFor(category);
  const budgetView = budgetStatus(thisMonthAmt, budget, dayOfMonth, daysInMonth);

  return NextResponse.json({
    ok: true,
    category,
    currentMonth: currentMonthKey(),
    prevMonth,
    summary: {
      serverCount: servers.length,
      total14d: +total14d.toFixed(2),
      monthly: { current: +thisMonthAmt.toFixed(2), previous: +prevMonthAmt.toFixed(2), deltaPct },
      budget: budgetView,
      monthProgress: { dayOfMonth, daysInMonth },
    },
    roster,
    trend,
    snapshotAt: latestItem?.snapshotAt ?? null,
  });
}
