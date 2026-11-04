/**
 * Monthly data-transfer cost split into Public-IP/Internet vs Private/Intra-AWS
 * for the last 12 months. Uses GetCostAndUsage (monthly, non-resource) so full
 * history is available. Powers the dashboard two-line data-transfer chart.
 */
import { NextResponse } from "next/server";
import { GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { getCostExplorerClient } from "@/lib/aws";
import { trailingMonthsRange } from "@/lib/dates";
import { isDataTransferUsageType, classifyUsageType } from "@/lib/datatransfer";
import { cached, DEFAULT_TTL } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await cached("dt-trend", DEFAULT_TTL, async () => {
      const range = trailingMonthsRange(12);
      const client = getCostExplorerClient();
      const months = new Map<string, { public: number; private: number }>();
      let nextToken: string | undefined;

      do {
        const res = await client.send(
          new GetCostAndUsageCommand({
            TimePeriod: range,
            Granularity: "MONTHLY",
            Metrics: ["UnblendedCost"],
            GroupBy: [{ Type: "DIMENSION", Key: "USAGE_TYPE" }],
            NextPageToken: nextToken,
          }),
        );
        for (const period of res.ResultsByTime ?? []) {
          const month = (period.TimePeriod?.Start ?? "").slice(0, 7);
          if (!month) continue;
          const bucket = months.get(month) ?? { public: 0, private: 0 };
          for (const g of period.Groups ?? []) {
            const usageType = (g.Keys ?? [])[0] ?? "";
            if (!isDataTransferUsageType(usageType)) continue;
            const amt = Number(g.Metrics?.UnblendedCost?.Amount ?? "0");
            const cat = classifyUsageType(usageType);
            if (cat === "Public IP / Internet") bucket.public += amt;
            else if (cat === "Private IP / Intra-AWS") bucket.private += amt;
          }
          months.set(month, bucket);
        }
        nextToken = res.NextPageToken;
      } while (nextToken);

      const series = [...months.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-12)
        .map(([month, v]) => ({ month, public: v.public, private: v.private }));

      return { series };
    });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Data-transfer trend request failed" },
      { status: 500 },
    );
  }
}
