import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { getEc2Client } from "@/lib/aws";
import { listRegions } from "@/lib/ec2";
import { buildSystemSnapshot } from "@/lib/awsSystemSnapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const regions = await listRegions();
    for (const region of regions) {
      try {
        const res = await getEc2Client(region).send(
          new DescribeInstancesCommand({ InstanceIds: [params.id] })
        );
        const inst = res.Reservations?.[0]?.Instances?.[0];
        if (!inst) continue;
        const snap = await buildSystemSnapshot(
          inst.InstanceId ?? params.id,
          region,
          inst.PrivateIpAddress ?? null,
          inst.PublicIpAddress ?? null
        );
        return NextResponse.json({ ok: true, snapshot: snap });
      } catch {
        /* not in this region */
      }
    }
    return NextResponse.json({ error: "Instance not found in any region" }, { status: 404 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
