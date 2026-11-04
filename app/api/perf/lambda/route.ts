import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { readLatest } from "@/lib/dataSnapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

interface Payload {
  region: string;
  functions: Array<{
    arn: string; name: string; runtime: string; memoryMb: number;
    lastModified: string | null; invocations24h: number; errors24h: number; errorRate: number;
  }>;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const snap = await readLatest<Payload>("lambda-ohio");
  if (!snap) {
    return NextResponse.json({ ok: true, fetchedAt: null, region: "us-east-2", functions: [], cached: false, neverRefreshed: true });
  }
  return NextResponse.json({
    ok: true,
    fetchedAt: snap.meta.capturedAt,
    cached: true,
    region: snap.payload.region,
    functions: snap.payload.functions,
    snapshotMeta: snap.meta,
  });
}
