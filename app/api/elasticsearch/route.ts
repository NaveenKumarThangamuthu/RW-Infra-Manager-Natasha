/**
 * Elasticsearch cluster metrics from Prometheus for /elasticsearch.
 * GET ?hours=3|6|24|72|168 (default 24)
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { cached } from "@/lib/cache";
import { ES_WINDOWS, getEsMonitor, type EsMonitor } from "@/lib/esMonitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TTL_MS = 60_000;
const inflight = new Map<string, Promise<EsMonitor>>();

function load(hours: number, key: string): Promise<EsMonitor> {
  const running = inflight.get(key);
  if (running) return running;
  const p = getEsMonitor(hours).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = Number(req.nextUrl.searchParams.get("hours") ?? 24);
  const hours = (ES_WINDOWS as readonly number[]).includes(raw) ? raw : 24;
  const key = `es:monitor:${hours}`;
  try {
    const monitor = await cached(key, TTL_MS, () => load(hours, key));
    return NextResponse.json({ ok: true, monitor });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load Elasticsearch metrics" }, { status: 502 });
  }
}
