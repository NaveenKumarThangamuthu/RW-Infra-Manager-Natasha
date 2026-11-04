/**
 * Aggregated counts for the dashboard "Infra at a glance" tile row + ops strip.
 * Pulls from the DB + snapshot cache only — no live upstream calls.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readLatest, ALL_SOURCES } from "@/lib/dataSnapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

interface SpringHealth { services: Array<{ up: boolean; heapPct: number | null }> }
interface SpringLogs { services: Array<{ service: string; total: number; errors: number; warns: number }>; totals: { total: number; errors: number; warns: number } }
interface LambdaPayload { functions: Array<{ name: string; invocations24h: number; errors24h: number }> }
interface RecsPayload {
  generatedAt?: string;
  instances?: Array<{
    instanceId: string;
    name?: string;
    recommendations?: Array<{ severity: string; message: string; monthlyDeltaUsd?: number }>;
  }>;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [
    repoCount, archivedCount, latestRepoSync,
    findingsBySev, scanJobsLast24h, lastScan, openScans,
    springSnap, springLogsSnap, lambdaSnap, recsSnap,
    lastCron, lastBackfill,
    seoTargetCount, seoWorstMobilePerf, seoLastLive, seoRuns24h,
    ...snapshotMetas
  ] = await Promise.all([
    prisma.repo.count({ where: { archived: false } }),
    prisma.repo.count({ where: { archived: true } }),
    prisma.repo.findFirst({ orderBy: { lastSyncedAt: "desc" }, select: { lastSyncedAt: true } }),
    prisma.finding.groupBy({
      by: ["severity"],
      where: { suppressedAt: null },
      _count: { _all: true },
    }),
    prisma.scanJob.count({ where: { startedAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    prisma.scanJob.findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true, repoFullName: true } }),
    prisma.scanJob.count({ where: { status: { in: ["queued", "running"] } } }),
    readLatest<SpringHealth>("spring-health"),
    readLatest<SpringLogs>("spring-logs"),
    readLatest<LambdaPayload>("lambda-ohio"),
    readLatest<RecsPayload>("recommendations"),
    prisma.refreshRun.findFirst({ where: { kind: "cron", status: "success" }, orderBy: { startedAt: "desc" } }),
    prisma.refreshRun.findFirst({ where: { kind: "backfill", status: "success" }, orderBy: { startedAt: "desc" } }),
    prisma.seoTarget.count({ where: { active: true } }),
    prisma.$queryRaw<Array<{ perfScore: number | null; label: string | null; url: string; targetId: number }>>`
      SELECT r.perfScore, t.label, t.url, r.targetId
      FROM seo_report r
      INNER JOIN seo_target t ON t.id = r.targetId
      INNER JOIN (
        SELECT targetId, MAX(runAt) AS mx
        FROM seo_report
        WHERE source='psi' AND device='mobile' AND status='success' AND perfScore IS NOT NULL
        GROUP BY targetId
      ) latest ON latest.targetId = r.targetId AND latest.mx = r.runAt
      WHERE r.source='psi' AND r.device='mobile' AND r.status='success'
      ORDER BY r.perfScore ASC
      LIMIT 1
    `,
    prisma.seoReport.findFirst({
      where: { status: "success", source: { in: ["psi", "gtmetrix"] } },
      orderBy: { runAt: "desc" },
      select: { runAt: true },
    }),
    prisma.seoReport.count({
      where: {
        status: "success",
        source: { in: ["psi", "gtmetrix"] },
        runAt: { gte: new Date(Date.now() - 86_400_000) },
      },
    }),
    ...ALL_SOURCES.map((src) => readLatest(src)),
  ]);

  const bySev: Record<string, number> = { CRIT: 0, HIGH: 0, MED: 0, LOW: 0, INFO: 0 };
  let totalFindings = 0;
  for (const row of findingsBySev) {
    bySev[row.severity] = row._count._all;
    totalFindings += row._count._all;
  }

  const services = springSnap?.payload.services ?? [];
  const springDown = services.filter((s) => !s.up).length;
  const springHighHeap = services.filter((s) => s.heapPct !== null && s.heapPct > 85).length;
  const springWithErrors = (springLogsSnap?.payload.services ?? []).filter((s) => s.errors > 0).length;
  const springTotalErrors = springLogsSnap?.payload.totals.errors ?? 0;

  const lambdas = lambdaSnap?.payload.functions ?? [];
  const lambdaErrors = lambdas.reduce((a, f) => a + (f.errors24h ?? 0), 0);
  const lambdaInv = lambdas.reduce((a, f) => a + (f.invocations24h ?? 0), 0);

  // Compress recommendations into a top-3 wins list with savings.
  let topRecommendations: Array<{ instanceId: string; name?: string; message: string; monthlyDeltaUsd: number }> = [];
  let totalSavingsUsd = 0;
  let recCount = 0;
  if (recsSnap?.payload.instances) {
    for (const inst of recsSnap.payload.instances) {
      for (const rec of inst.recommendations ?? []) {
        if (typeof rec.monthlyDeltaUsd === "number" && rec.monthlyDeltaUsd < 0) {
          recCount += 1;
          totalSavingsUsd += -rec.monthlyDeltaUsd;
          topRecommendations.push({
            instanceId: inst.instanceId,
            name: inst.name,
            message: rec.message,
            monthlyDeltaUsd: rec.monthlyDeltaUsd,
          });
        }
      }
    }
    topRecommendations.sort((a, b) => a.monthlyDeltaUsd - b.monthlyDeltaUsd);
    topRecommendations = topRecommendations.slice(0, 3);
  }

  // Map snapshot freshness for each source.
  const snapshots: Record<string, { capturedAt: string | null; via: string | null; status: string | null }> = {};
  ALL_SOURCES.forEach((src, i) => {
    const meta = (snapshotMetas[i] as { meta: { capturedAt: string; via: string | null } } | null)?.meta ?? null;
    snapshots[src] = { capturedAt: meta?.capturedAt ?? null, via: meta?.via ?? null, status: meta ? "success" : null };
  });

  return NextResponse.json({
    ok: true,
    fetchedAt: new Date().toISOString(),
    github: {
      activeRepos: repoCount,
      archivedRepos: archivedCount,
      lastSyncAt: latestRepoSync?.lastSyncedAt?.toISOString() ?? null,
      findings: { total: totalFindings, ...bySev },
      scans: {
        last24h: scanJobsLast24h,
        open: openScans,
        lastAt: lastScan?.startedAt.toISOString() ?? null,
        lastRepo: lastScan?.repoFullName ?? null,
        lastStatus: lastScan?.status ?? null,
      },
    },
    spring: {
      total: services.length,
      down: springDown,
      highHeap: springHighHeap,
      servicesWithErrors: springWithErrors,
      totalErrors1h: springTotalErrors,
      lastHealthSnap: springSnap?.meta.capturedAt ?? null,
      lastLogsSnap: springLogsSnap?.meta.capturedAt ?? null,
    },
    lambda: {
      total: lambdas.length,
      invocations24h: lambdaInv,
      errors24h: lambdaErrors,
      lastSnap: lambdaSnap?.meta.capturedAt ?? null,
    },
    recommendations: {
      total: recCount,
      monthlySavingsUsd: +totalSavingsUsd.toFixed(2),
      top: topRecommendations,
      lastSnap: recsSnap?.meta.capturedAt ?? null,
    },
    seo: {
      targets: seoTargetCount,
      worstMobilePerf: seoWorstMobilePerf[0]
        ? {
            perfScore: seoWorstMobilePerf[0].perfScore === null ? null : Number(seoWorstMobilePerf[0].perfScore),
            label: seoWorstMobilePerf[0].label ?? seoWorstMobilePerf[0].url,
          }
        : null,
      lastLiveAt: seoLastLive?.runAt.toISOString() ?? null,
      runs24h: seoRuns24h,
    },
    ops: {
      cronLastAt: lastCron?.startedAt.toISOString() ?? null,
      backfillLastAt: lastBackfill?.startedAt.toISOString() ?? null,
      snapshots,
    },
  });
}
