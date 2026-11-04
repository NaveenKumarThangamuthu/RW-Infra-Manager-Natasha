/**
 * One-shot recovery: heal seo_report rows where the GTmetrix test itself
 * completed but the pre-fix collector timed out (before we learned the
 * /tests/<id> 303 → /reports/<id> handoff). Re-hits the same endpoint for
 * each pending testId — fetch() auto-follows the 303 — and updates the
 * row in place with the report metrics. Idempotent.
 */
import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl } from "../lib/db";

const url = resolveDatabaseUrl();
const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);

const BASE = "https://gtmetrix.com/api/2.0";

function auth(): string {
  const key = process.env.GTMETRIX_API_KEY ?? "";
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

interface JsonApiResp {
  data?: { id?: string; type?: string; attributes?: Record<string, unknown> };
}

/// GTmetrix /tests/<id> 303-redirects to /reports/<id> once the test is done.
/// fetch() auto-follows, so we get the report envelope directly.
async function fetchTestOrReport(testId: string): Promise<JsonApiResp | null> {
  const r = await fetch(`${BASE}/tests/${testId}`, {
    headers: { Accept: "application/vnd.api+json", Authorization: auth() },
  });
  if (!r.ok) return null;
  return (await r.json()) as JsonApiResp;
}

async function main() {
  const stale = await prisma.seoReport.findMany({
    where: {
      source: "gtmetrix",
      status: "failed",
      errorMessage: { contains: "poll timeout" },
    },
  });
  console.log(`Found ${stale.length} stale rows to try to recover.`);

  const testIdRe = /poll timeout after \d+ms for ([A-Za-z0-9_-]+)/;
  for (const row of stale) {
    const testId = row.testId ?? row.errorMessage?.match(testIdRe)?.[1] ?? null;
    if (!testId) {
      console.log(`  skip id=${row.id}: no testId in row or errorMessage`);
      continue;
    }
    const env = await fetchTestOrReport(testId);
    if (!env || env.data?.type !== "report" || !env.data.attributes) {
      console.log(`  skip id=${row.id} testId=${testId} type=${env?.data?.type ?? "?"}`);
      continue;
    }
    const attrs = env.data.attributes;
    const reportId = env.data.id;
    const num = (k: string): number | null => {
      const v = attrs[k];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    const round = (n: number | null): number | null => (n === null ? null : Math.round(n));

    await prisma.seoReport.update({
      where: { id: row.id },
      data: {
        status: "success",
        errorMessage: null,
        testId,
        perfScore: (() => {
          const v = num("performance_score");
          return v === null ? null : Math.round(v * (v <= 1 ? 100 : 1));
        })(),
        lcpMs: round(num("largest_contentful_paint")),
        fcpMs: round(num("first_contentful_paint")),
        ttfbMs: round(num("time_to_first_byte")),
        tbtMs: round(num("total_blocking_time")),
        cls: num("cumulative_layout_shift"),
        speedIndexMs: round(num("speed_index")),
        totalBytes: (() => {
          const v = num("page_bytes");
          return v === null ? null : BigInt(Math.round(v));
        })(),
        requests: (() => {
          const v = num("page_requests");
          return v === null ? null : Math.round(v);
        })(),
        gtmetrixGrade: (attrs["gtmetrix_grade"] as string | undefined) ?? null,
        structureScore: (() => {
          const v = num("structure_score");
          return v === null ? null : Math.round(v * (v <= 1 ? 100 : 1));
        })(),
        raw: JSON.stringify(env),
      },
    });
    console.log(
      `  ✓ id=${row.id} testId=${testId} report=${reportId} perf=${num("performance_score")} lcp=${num("largest_contentful_paint")}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
