import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** A finding counts as open only while a scan in the last 2 days still reports it. */
const CURRENT_WINDOW_MS = 2 * 86_400_000;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const repo = url.searchParams.get("repo");
  const severity = url.searchParams.get("severity");
  const includeSuppressed = url.searchParams.get("includeSuppressed") === "1";

  const where: Record<string, unknown> = {};
  if (repo) where.repoFullName = repo;
  if (severity) where.severity = severity;
  if (!includeSuppressed) where.suppressedAt = null;
  where.lastSeenAt = { gte: new Date(Date.now() - CURRENT_WINDOW_MS) };

  const [rows, totals] = await Promise.all([
    prisma.finding.findMany({
      where,
      orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }],
      take: 500,
    }),
    prisma.finding.groupBy({
      by: ["severity"],
      where,
      _count: { _all: true },
    }),
  ]);

  const bySeverity: Record<string, number> = {};
  let total = 0;
  for (const t of totals) {
    bySeverity[t.severity] = t._count._all;
    total += t._count._all;
  }

  return NextResponse.json({
    ok: true,
    fetchedAt: new Date().toISOString(),
    bySeverity,
    total,
    findings: rows,
  });
}
