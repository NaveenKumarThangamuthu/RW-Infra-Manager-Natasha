import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getRdsPerformance } from "@/lib/rdsPerformance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_WINDOWS = new Set([3, 6, 24, 72, 168]);

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const region = req.nextUrl.searchParams.get("region");
  if (!region || !/^[a-z0-9-]{5,30}$/.test(region)) {
    return NextResponse.json({ error: "A valid ?region= is required" }, { status: 400 });
  }
  const hoursRaw = Number(req.nextUrl.searchParams.get("hours") ?? 24);
  const hours = ALLOWED_WINDOWS.has(hoursRaw) ? hoursRaw : 24;

  try {
    const perf = await getRdsPerformance(region, params.id, hours);
    return NextResponse.json({ ok: true, perf });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load RDS performance" },
      { status: 500 },
    );
  }
}
