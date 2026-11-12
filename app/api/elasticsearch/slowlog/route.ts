/**
 * Search slow log of the production Elasticsearch cluster for /elasticsearch.
 * GET ?hours=3|6|24|72|168 (default 24)[&refresh=1]
 * Always HTTP 200 with a SlowLogResp body once signed in.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { cached } from "@/lib/cache";
import { ensureSecretsHydrated } from "@/lib/db";
import { fetchSlowLog, SLOWLOG_WINDOWS, type SlowLogResp } from "@/lib/esSlowlog";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TTL_MS = 5 * 60_000;
// A forced refresh is honoured at most once a minute per window.
const REFRESH_COOLDOWN_MS = 60_000;

const generation: Record<number, number> = {};
const lastFetch: Record<number, number> = {};
const inflight = new Map<string, Promise<SlowLogResp>>();

/** Carries a result that must not be cached (errors, not configured) out of cached(). */
class Uncached extends Error {
  constructor(readonly resp: SlowLogResp) { super("uncached"); }
}

function load(hours: number, key: string): Promise<SlowLogResp> {
  const running = inflight.get(key);
  if (running) return running;
  const p = fetchSlowLog(hours).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureSecretsHydrated();

  const raw = Number(req.nextUrl.searchParams.get("hours") ?? 24);
  const hours = (SLOWLOG_WINDOWS as readonly number[]).includes(raw) ? raw : 24;
  if (req.nextUrl.searchParams.get("refresh") === "1" && Date.now() - (lastFetch[hours] ?? 0) > REFRESH_COOLDOWN_MS) {
    generation[hours] = (generation[hours] ?? 0) + 1;
  }
  const key = `es:slowlog:${hours}:${generation[hours] ?? 0}`;

  try {
    const value = await cached(key, TTL_MS, async () => {
      const v = await load(hours, key);
      if (v.state !== "ok") throw new Uncached(v);
      lastFetch[hours] = Date.now();
      return v;
    });
    return NextResponse.json(value);
  } catch (e) {
    const body: SlowLogResp = e instanceof Uncached ? e.resp : { state: "error", message: "The slow log could not be loaded." };
    return NextResponse.json(body);
  }
}
