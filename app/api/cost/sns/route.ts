import { NextResponse } from "next/server";
import { resourceCostForService, SERVICE } from "@/lib/costExplorer";
import { lastNDaysRange } from "@/lib/dates";
import { cached, DEFAULT_TTL } from "@/lib/cache";

export const dynamic = "force-dynamic";

/**
 * Per-SNS-topic cost (last <=14 days), plus a usage-type breakdown that
 * separates delivery channels (SMS / HTTP / API requests / etc).
 */
export async function GET() {
  try {
    const payload = await cached("sns", DEFAULT_TTL, async () => {
    const range = lastNDaysRange(14);

    const [byTopic, byUsage] = await Promise.all([
      resourceCostForService(SERVICE.SNS, range),
      resourceCostForService(SERVICE.SNS, range, "USAGE_TYPE"),
    ]);

    const topics = byTopic.map((c) => {
      const arn = c.key;
      const name = arn.includes(":") ? arn.split(":").pop()! : arn;
      return { arn, name, cost: c.amount, unit: c.unit };
    });

    const usage = byUsage.map((c) => {
      const parts = c.key.split(" / ");
      return { resourceAndUsage: c.key, usageType: parts[parts.length - 1] ?? "", cost: c.amount, unit: c.unit };
    });

      const total = topics.reduce((s, t) => s + t.cost, 0);
      return { range, total, topics, usage };
    });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "SNS cost request failed" },
      { status: 500 },
    );
  }
}
