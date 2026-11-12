import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getRdsQueryInsights, isQueryOrder } from "@/lib/rdsQueryInsights";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const region = req.nextUrl.searchParams.get("region");
  if (!region || !/^[a-z0-9-]{5,30}$/.test(region)) {
    return NextResponse.json({ error: "A valid ?region= is required" }, { status: 400 });
  }

  const sort = req.nextUrl.searchParams.get("sort");
  if (sort != null && !isQueryOrder(sort)) {
    return NextResponse.json({ error: "?sort= must be rows, time or latency" }, { status: 400 });
  }

  try {
    const insights = await getRdsQueryInsights(region, params.id, sort ?? "rows");
    return NextResponse.json({ ok: true, insights });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load query insights" },
      { status: 500 },
    );
  }
}
