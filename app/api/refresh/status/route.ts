/**
 * Lightweight status used by the top bar to show "last refreshed". Returns only
 * the timestamp and label of the most recent successful run (no cost data).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const last = await prisma.refreshRun.findFirst({
      where: { status: "success" },
      orderBy: { finishedAt: "desc" },
    });
    return NextResponse.json({
      lastRefreshAt: last?.finishedAt ?? null,
      lastRunLabel: last?.runLabel ?? null,
    });
  } catch {
    return NextResponse.json({ lastRefreshAt: null, lastRunLabel: null });
  }
}
