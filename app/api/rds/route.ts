import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchRdsInventory } from "@/lib/rds";

export const dynamic = "force-dynamic";
// Cross-region describe plus three CloudWatch metrics per instance; allow headroom.
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const force = req.nextUrl.searchParams.get("refresh") === "1";
  try {
    const inventory = await fetchRdsInventory({ force });
    return NextResponse.json({ ok: true, inventory });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load RDS inventory" },
      { status: 500 },
    );
  }
}
