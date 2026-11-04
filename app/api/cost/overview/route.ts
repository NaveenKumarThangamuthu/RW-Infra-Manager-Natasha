import { NextResponse } from "next/server";
import { costByGroups } from "@/lib/costExplorer";
import { monthRange } from "@/lib/dates";
import { cached, DEFAULT_TTL } from "@/lib/cache";

export const dynamic = "force-dynamic";

/** Cost grouped by service, and total by region. `?month=YYYY-MM` selects the month. */
export async function GET(req: Request) {
  try {
    const month = new URL(req.url).searchParams.get("month") ?? undefined;
    const payload = await cached(`overview:${month ?? "current"}`, DEFAULT_TTL, async () => {
      const range = monthRange(month);
      const [byService, byRegion] = await Promise.all([
        costByGroups(range, [{ Type: "DIMENSION", Key: "SERVICE" }]),
        costByGroups(range, [{ Type: "DIMENSION", Key: "REGION" }]),
      ]);
      const total = byService.reduce((s, i) => s + i.amount, 0);
      return { range, total, byService, byRegion };
    });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cost Explorer request failed" },
      { status: 500 },
    );
  }
}
