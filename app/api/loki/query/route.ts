import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { queryRange, flattenEntries, guessSeverity } from "@/lib/loki";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("query");
  if (!q) return NextResponse.json({ error: "missing query" }, { status: 400 });
  const limit = Math.min(2000, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 500)));
  const minutes = Math.min(1440, Math.max(1, Number(req.nextUrl.searchParams.get("minutes") ?? 60)));
  const endSec = Math.floor(Date.now() / 1000);
  const startSec = endSec - minutes * 60;

  try {
    const raw = await queryRange({ query: q, limit, startSec, endSec, direction: "backward" });
    const entries = flattenEntries(raw).map((e) => ({
      timeMs: e.timeMs,
      message: e.message,
      severity: guessSeverity(e.message),
      labels: e.labels,
    }));
    return NextResponse.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      query: q,
      windowMinutes: minutes,
      count: entries.length,
      entries,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Loki query failed" }, { status: 500 });
  }
}
