import { NextResponse } from "next/server";
import { costByGroups } from "@/lib/costExplorer";
import { monthRange } from "@/lib/dates";
import { cached, DEFAULT_TTL } from "@/lib/cache";

export const dynamic = "force-dynamic";

/**
 * The complete bill: EVERY service line for the month (no truncation), plus a
 * record-type breakdown (Usage / Tax / Credit / Refund / Support / Savings
 * Plans / Fees) so the total reconciles with the AWS Billing console.
 */
export async function GET(req: Request) {
  try {
    const month = new URL(req.url).searchParams.get("month") ?? undefined;
    const payload = await cached(`bill:${month ?? "current"}`, DEFAULT_TTL, async () => {
      const range = monthRange(month);
      const [services, byRecordType] = await Promise.all([
        costByGroups(range, [{ Type: "DIMENSION", Key: "SERVICE" }]),
        costByGroups(range, [{ Type: "DIMENSION", Key: "RECORD_TYPE" }]),
      ]);
      const total = services.reduce((s, i) => s + i.amount, 0);
      const recordTotal = byRecordType.reduce((s, i) => s + i.amount, 0);
      return { range, total, recordTotal, services, byRecordType };
    });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Bill request failed" },
      { status: 500 },
    );
  }
}
