import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hydrateFromDb } from "@/lib/secrets";

export const dynamic = "force-dynamic";

export async function POST() {
  const s = await getServerSession(authOptions);
  if (!s?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { loaded, skipped } = await hydrateFromDb();
  return NextResponse.json({ ok: true, loaded, skipped, at: new Date().toISOString() });
}
