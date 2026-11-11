import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { readLatest } from "@/lib/dataSnapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

interface SpringLogPayload {
  window: "1h";
  services: Array<{
    service: string;
    total: number;
    errors: number;
    warns: number;
    errorRate: number;
    hosts: string[];
    latestError: { at: string | null; message: string } | null;
  }>;
  totals: { total: number; errors: number; warns: number };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const snap = await readLatest<SpringLogPayload>("spring-logs");
  if (!snap) {
    return NextResponse.json({
      ok: true,
      fetchedAt: null,
      cached: false,
      neverRefreshed: true,
      window: "1h",
      via: null,
      services: [],
      totals: { total: 0, errors: 0, warns: 0 },
    });
  }
  return NextResponse.json({
    ok: true,
    fetchedAt: snap.meta.capturedAt,
    cached: true,
    window: snap.payload.window,
    via: snap.meta.via,
    services: snap.payload.services,
    totals: snap.payload.totals,
    snapshotMeta: snap.meta,
  });
}
