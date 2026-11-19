import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { getEc2Client } from "@/lib/aws";
import { listRegions } from "@/lib/ec2";
import { analyzeInstance } from "@/lib/recommendations";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const regions = await listRegions();
    for (const region of regions) {
      try {
        const res = await getEc2Client(region).send(
          new DescribeInstancesCommand({ InstanceIds: [params.id] }),
        );
        const inst = res.Reservations?.[0]?.Instances?.[0];
        if (!inst) continue;
        const nameTag = (inst.Tags ?? []).find((t) => t.Key === "Name");
        const analysis = await analyzeInstance({
          instanceId: inst.InstanceId ?? params.id,
          name: nameTag?.Value ?? "(no name)",
          region,
          type: inst.InstanceType ?? "-",
          state: inst.State?.Name ?? "-",
          publicIp: inst.PublicIpAddress ?? null,
          privateIp: inst.PrivateIpAddress ?? null,
        });
        return NextResponse.json({ ok: true, fetchedAt: new Date().toISOString(), analysis });
      } catch {
        /* not here */
      }
    }
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 },
    );
  }
}
