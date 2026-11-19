/**
 * Per-service recent ERROR log entries from the DEV ELK cluster.
 * Used by the expandable rows on /perf/spring.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { esSearch, SPRING_LOG_INDEX } from "@/lib/elk";
import { redactLog } from "@/lib/logRedact";
import { LOG_LEVEL_RUNTIME, levelFilters } from "@/lib/springLogLevel";

export const dynamic = "force-dynamic";
// LAN attempt (4s) + Public fallback (15s) need ~20s headroom; bump from 15s
// to keep Next.js from returning an HTML 504 mid-fallback.
export const maxDuration = 25;

interface HitSource {
  "@timestamp"?: string;
  message?: string;
  host?: { name?: string };
  log?: { file?: { path?: string } };
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const service = url.searchParams.get("service");
  const rawWindow = url.searchParams.get("window") ?? "1h";
  const windowMap: Record<string, string> = { "15m": "now-15m", "1h": "now-1h", "6h": "now-6h", "24h": "now-24h" };
  const window = windowMap[rawWindow] ?? "now-1h";
  const size = Math.min(parseInt(url.searchParams.get("size") ?? "50", 10) || 50, 200);
  if (!service) return NextResponse.json({ error: "Missing service" }, { status: 400 });

  const body = {
    size,
    sort: [{ "@timestamp": "desc" }],
    runtime_mappings: LOG_LEVEL_RUNTIME,
    _source: ["@timestamp", "message", "host.name", "log.file.path"],
    query: {
      bool: {
        filter: [
          { term: { "dissect.service": service } },
          { range: { "@timestamp": { gte: window } } },
          // Lines logged at ERROR level, not lines that merely contain the word.
          ...levelFilters("ERROR"),
        ],
      },
    },
  };

  try {
    const { data, via } = await esSearch<{
      hits: { hits: Array<{ _source: HitSource }>; total: { value: number; relation: string } };
    }>(SPRING_LOG_INDEX + "*", body, { timeoutMs: 15_000 });

    const entries = data.hits.hits.map((h) => ({
      at: h._source["@timestamp"] ?? null,
      host: h._source.host?.name ?? null,
      file: h._source.log?.file?.path ?? null,
      // Redacted here so raw log text (URLs, ids, DTO dumps) never reaches the browser.
      message: redactLog((h._source.message ?? "").slice(0, 4000)),
    }));

    return NextResponse.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      service,
      window: window.replace("now-", ""),
      via,
      total: data.hits.total.value,
      truncated: data.hits.total.relation !== "eq",
      entries,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
