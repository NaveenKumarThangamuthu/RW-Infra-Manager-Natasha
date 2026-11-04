import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ready, labelValues } from "@/lib/loki";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [ok, jobs] = await Promise.all([ready(), labelValues("job").catch(() => [])]);
  return NextResponse.json({ ok, jobs, fetchedAt: new Date().toISOString() });
}
