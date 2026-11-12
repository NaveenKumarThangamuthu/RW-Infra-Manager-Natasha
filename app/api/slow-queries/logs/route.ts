/**
 * Database trouble in the Spring service logs for /slow-queries.
 * GET ?range=1h|6h|24h[&refresh=1]
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { cached } from "@/lib/cache";
import { fetchLogTrouble, isRange, type LogsResp, type Range } from "@/lib/slowQueryLogs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TTL_MS: Record<Range, number> = { "1h": 5 * 60_000, "6h": 5 * 60_000, "24h": 10 * 60_000 };
// A forced refresh is honoured at most once a minute per range, so repeated
// clicks cannot hammer Elasticsearch.
const REFRESH_COOLDOWN_MS = 60_000;

const generation: Record<string, number> = {};
const lastFetch: Record<string, number> = {};
const inflight = new Map<string, Promise<LogsResp>>();

function load(range: Range, key: string): Promise<LogsResp> {
  const running = inflight.get(key);
  if (running) return running;
  const p = fetchLogTrouble(range).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const range = req.nextUrl.searchParams.get("range") ?? "6h";
  if (!isRange(range)) return NextResponse.json({ error: "?range= must be 1h, 6h or 24h" }, { status: 400 });

  if (req.nextUrl.searchParams.get("refresh") === "1" && Date.now() - (lastFetch[range] ?? 0) > REFRESH_COOLDOWN_MS) {
    generation[range] = (generation[range] ?? 0) + 1;
  }
  const key = `slowq:logs:${range}:${generation[range] ?? 0}`;

  try {
    let fresh = false;
    const value = await cached(key, TTL_MS[range], async () => {
      fresh = true;
      const v = await load(range, key);
      lastFetch[range] = Date.now();
      return v;
    });
    return NextResponse.json({ ...value, cached: !fresh });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
