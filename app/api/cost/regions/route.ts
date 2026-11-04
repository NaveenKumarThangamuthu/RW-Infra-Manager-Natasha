import { NextResponse } from "next/server";
import { costByGroups } from "@/lib/costExplorer";
import { monthRange } from "@/lib/dates";
import { cached, DEFAULT_TTL } from "@/lib/cache";

export const dynamic = "force-dynamic";

/**
 * Month-to-date cost broken down by region AND service (a region/service
 * matrix). Cost Explorer allows up to two grouping dimensions.
 */
export async function GET(req: Request) {
  try {
    const month = new URL(req.url).searchParams.get("month") ?? undefined;
    const payload = await cached(`regions:${month ?? "current"}`, DEFAULT_TTL, async () => {
      const range = monthRange(month);
      const items = await costByGroups(range, [
        { Type: "DIMENSION", Key: "REGION" },
        { Type: "DIMENSION", Key: "SERVICE" },
      ]);

      // items[].key === "<region> / <service>"
      const byRegion = new Map<string, { region: string; total: number; services: { service: string; cost: number }[] }>();
      for (const it of items) {
        const [region, service] = it.key.split(" / ");
        const entry = byRegion.get(region) ?? { region, total: 0, services: [] };
        entry.total += it.amount;
        entry.services.push({ service: service ?? "Unknown", cost: it.amount });
        byRegion.set(region, entry);
      }

      const regions = [...byRegion.values()]
        .map((r) => ({ ...r, services: r.services.sort((a, b) => b.cost - a.cost) }))
        .sort((a, b) => b.total - a.total);

      const total = regions.reduce((s, r) => s + r.total, 0);
      return { range, total, regions };
    });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Region cost request failed" },
      { status: 500 },
    );
  }
}
