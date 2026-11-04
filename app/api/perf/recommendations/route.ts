import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { readLatest } from "@/lib/dataSnapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const snap = await readLatest<{ analyses: unknown[] }>("recommendations");
  if (!snap) {
    return NextResponse.json({ ok: true, fetchedAt: null, analyses: [], cached: false, neverRefreshed: true });
  }
  return NextResponse.json({
    ok: true,
    fetchedAt: snap.meta.capturedAt,
    analyses: snap.payload.analyses ?? [],
    cached: true,
    snapshotMeta: snap.meta,
  });
}
