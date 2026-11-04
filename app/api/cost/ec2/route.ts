import { NextResponse } from "next/server";
import { resourceCostForService, SERVICE } from "@/lib/costExplorer";
import { getAllInstances } from "@/lib/ec2";
import { lastNDaysRange } from "@/lib/dates";
import { cached, DEFAULT_TTL } from "@/lib/cache";

export const dynamic = "force-dynamic";

/**
 * Per-EC2-instance cost (last <=14 days) joined with instance metadata so each
 * server is shown with its IPs, region, type and state. AWS bills per instance,
 * not per IP — the IP columns come from DescribeInstances.
 */
export async function GET() {
  try {
    const payload = await cached("ec2", DEFAULT_TTL, async () => {
      const range = lastNDaysRange(14);
      const [costs, instances] = await Promise.all([
        resourceCostForService(SERVICE.EC2, range),
        getAllInstances(),
      ]);

      const rows = costs.map((c) => {
        // RESOURCE_ID for EC2 compute is the instance id (i-xxxx) or an ARN.
        const id = c.key.split("/").pop()!.trim();
        const info = instances.get(id);
        return {
          instanceId: id,
          cost: c.amount,
          unit: c.unit,
          region: info?.region ?? "-",
          name: info?.name ?? "(unknown / terminated)",
          type: info?.type ?? "-",
          state: info?.state ?? "-",
          privateIp: info?.privateIp ?? "-",
          publicIp: info?.publicIp ?? "-",
        };
      });

      const total = rows.reduce((s, r) => s + r.cost, 0);
      return { range, total, rows };
    });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "EC2 cost request failed" },
      { status: 500 },
    );
  }
}
