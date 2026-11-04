import { NextResponse } from "next/server";
import { costByGroupsRaw } from "@/lib/costExplorer";
import { monthRange } from "@/lib/dates";
import { cached, DEFAULT_TTL } from "@/lib/cache";
import {
  classifyUsageType,
  isDataTransferUsageType,
  DT_CATEGORIES,
  type DTCategory,
} from "@/lib/datatransfer";

export const dynamic = "force-dynamic";

/**
 * Data-transfer cost split into public-IP vs private-IP buckets, by usage type
 * and by region. `?month=YYYY-MM` selects the billing month (default: current).
 */
export async function GET(req: Request) {
  try {
    const month = new URL(req.url).searchParams.get("month") ?? undefined;

    const payload = await cached(`datatransfer:${month ?? "current"}`, DEFAULT_TTL, async () => {
      const range = monthRange(month);

      // Group by [USAGE_TYPE, REGION]; keep only transfer-related usage types.
      const raw = await costByGroupsRaw(range, [
        { Type: "DIMENSION", Key: "USAGE_TYPE" },
        { Type: "DIMENSION", Key: "REGION" },
      ]);

      const buckets: Record<DTCategory, number> = {
        "Public IP / Internet": 0,
        "Private IP / Intra-AWS": 0,
        "Other transfer": 0,
      };
      const usageMap = new Map<string, { usageType: string; category: DTCategory; amount: number; unit: string }>();
      const regionMap = new Map<
        string,
        { region: string; public: number; private: number; other: number; total: number }
      >();

      for (const item of raw) {
        const usageType = item.keys[0] ?? "";
        const region = item.keys[1] ?? "global";
        if (!isDataTransferUsageType(usageType)) continue;

        const category = classifyUsageType(usageType);
        buckets[category] += item.amount;

        const u = usageMap.get(usageType) ?? { usageType, category, amount: 0, unit: item.unit };
        u.amount += item.amount;
        usageMap.set(usageType, u);

        const r = regionMap.get(region) ?? { region, public: 0, private: 0, other: 0, total: 0 };
        if (category === "Public IP / Internet") r.public += item.amount;
        else if (category === "Private IP / Intra-AWS") r.private += item.amount;
        else r.other += item.amount;
        r.total += item.amount;
        regionMap.set(region, r);
      }

      const total = DT_CATEGORIES.reduce((s, c) => s + buckets[c], 0);
      return {
        range,
        month: month ?? null,
        total,
        buckets: DT_CATEGORIES.map((category) => ({ category, amount: buckets[category] })),
        byUsageType: [...usageMap.values()].sort((a, b) => b.amount - a.amount),
        byRegion: [...regionMap.values()].sort((a, b) => b.total - a.total),
      };
    });

    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Data transfer request failed" },
      { status: 500 },
    );
  }
}
