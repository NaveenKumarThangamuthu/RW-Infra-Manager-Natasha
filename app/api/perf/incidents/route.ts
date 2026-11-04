import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { alerts as promAlerts } from "@/lib/prometheus";
import { listOpenAlarms } from "@/lib/cloudwatchAlarms";
import { listAllInstancesHealth } from "@/lib/ec2Health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [prometheus, cloudwatch, instances] = await Promise.all([
      promAlerts().catch(() => []),
      listOpenAlarms().catch(() => []),
      listAllInstancesHealth().catch(() => []),
    ]);
    const failingEc2 = instances.filter(
      (i) => i.state === "running" && !i.overallOk,
    );
    return NextResponse.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      prometheus,
      cloudwatch,
      failingEc2,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 },
    );
  }
}
