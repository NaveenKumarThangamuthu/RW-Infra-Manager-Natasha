/**
 * One-time historical backfill of monthly cost (up to ~3 years).
 * Protected by a Bearer CRON_SECRET. Idempotent: refuses to re-run if data
 * already exists unless `?force=1`.
 *
 *   POST /api/backfill?months=36
 *   Authorization: Bearer <CRON_SECRET>
 */
import { NextResponse } from "next/server";
import { runBackfill } from "@/lib/snapshot";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const months = Math.min(Math.max(Number(url.searchParams.get("months") ?? "36"), 1), 38);
  const force = url.searchParams.get("force") === "1";

  try {
    const existing = await prisma.monthlyCost.count();
    if (existing > 0 && !force) {
      return NextResponse.json(
        { ok: false, skipped: true, reason: `monthly_cost already has ${existing} rows; pass ?force=1 to re-run` },
        { status: 409 },
      );
    }
    const result = await runBackfill(months);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backfill failed" },
      { status: 500 },
    );
  }
}
