/**
 * Redacted sample log lines for one kind of database trouble, for the side sheet on /slow-queries.
 * GET ?kind=…&range=1h|6h|24h[&service=…]
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { cached } from "@/lib/cache";
import { fetchSamples, isKind, isRange } from "@/lib/slowQueryLogs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TTL_MS = 2 * 60_000;
const SERVICE = /^[a-z0-9-]{1,64}$/;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind");
  const range = sp.get("range") ?? "6h";
  const service = sp.get("service");
  if (!isKind(kind)) return NextResponse.json({ error: "Unknown ?kind=" }, { status: 400 });
  if (!isRange(range)) return NextResponse.json({ error: "?range= must be 1h, 6h or 24h" }, { status: 400 });
  if (service != null && !SERVICE.test(service)) return NextResponse.json({ error: "Invalid ?service=" }, { status: 400 });

  try {
    const value = await cached(`slowq:samples:${kind}:${range}:${service ?? ""}`, TTL_MS, () => fetchSamples(kind, range, service));
    return NextResponse.json(value);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
