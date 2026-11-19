import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getInstanceConsoleOutput } from "@/lib/cloudwatchMetrics";
import { listRegions } from "@/lib/ec2";
import { DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { getEc2Client } from "@/lib/aws";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Find instance region
    const regions = await listRegions();
    let region: string | null = null;
    for (const r of regions) {
      try {
        const res = await getEc2Client(r).send(
          new DescribeInstancesCommand({ InstanceIds: [params.id] }),
        );
        if (res.Reservations?.[0]?.Instances?.[0]) {
          region = r;
          break;
        }
      } catch {
        /* not here */
      }
    }
    if (!region) return NextResponse.json({ error: "Instance not found" }, { status: 404 });

    const out = await getInstanceConsoleOutput(region, params.id);
    return NextResponse.json({ ok: true, fetchedAt: new Date().toISOString(), ...out });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 },
    );
  }
}
