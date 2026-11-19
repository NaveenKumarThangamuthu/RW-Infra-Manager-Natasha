/**
 * Aggregated counts for the dashboard "Infra at a glance" tile row + ops strip.
 * Pulls from the DB + snapshot cache only — no live upstream calls.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { inScopeRepos } from "@/lib/findingScope";
import { readLatest, ALL_SOURCES } from "@/lib/dataSnapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

interface SpringHealth { services: Array<{ serviceName: string; up: boolean; heapPct: number | null }> }
interface SpringLogs { services: Array<{ service: string; total: number; errors: number; warns: number }>; totals: { total: number; errors: number; warns: number } }
interface LambdaPayload { functions: Array<{ name: string; invocations24h: number; errors24h: number }> }
interface RecsPayload {
  fetchedAt?: string;
  analyses?: Array<{
    instanceId: string;
    name?: string;
    recommendations?: Array<{ kind: string; severity: string; message: string; monthlyDeltaUsd?: number | null }>;
  }>;
}

/** A finding counts as open when the latest scans still saw it; Alerts and Repositories use the same window. */
const FINDING_WINDOW_DAYS = 2;
const DAY_MS = 86_400_000;

/**
 * Monitored services whose own logs show errors. This mirrors `buildLogLookup` in
 * `components/screens/spring/data.ts` (exact name, then without the "service" suffix, never a
 * partial match) so Home and the Spring page report the same number. Keep the two in step.
 */
const normName = (s: string) => s.toLowerCase().replace(/[-_]/g, "");
const stripSuffix = (s: string) => s.replace(/service$/i, "").replace(/svc$/i, "");

function countErroring(health: SpringHealth["services"], logs: SpringLogs["services"]): number {
  const exact = new Map(logs.map((l) => [normName(l.service), l.errors]));
  const stripped = new Map(logs.map((l) => [stripSuffix(normName(l.service)), l.errors]));
  return health.filter((h) => {
    const key = normName(h.serviceName ?? "");
    const short = stripSuffix(key);
    const errors = exact.get(key) ?? (short !== key ? stripped.get(short) : undefined) ?? 0;
    return errors > 0;
  }).length;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = await inScopeRepos();
  const inScope = { in: scope.names };
  const [
    repoCount, archivedCount, latestRepoSync,
    findingsBySev, scanJobsLast24h, recentScans, lastScan, openScans,
    springSnap, springLogsSnap, lambdaSnap, recsSnap,
    lastCron, lastBackfill,
    ...snapshotMetas
  ] = await Promise.all([
    Promise.resolve(scope.names.length),
    prisma.repo.count({ where: { archived: true } }),
    prisma.repo.findFirst({ orderBy: { lastSyncedAt: "desc" }, select: { lastSyncedAt: true } }),
    prisma.finding.groupBy({
      by: ["severity"],
      where: { repoFullName: inScope, suppressedAt: null, lastSeenAt: { gte: new Date(Date.now() - FINDING_WINDOW_DAYS * DAY_MS) } },
      _count: { _all: true },
    }),
    prisma.scanJob.count({ where: { repoFullName: inScope, startedAt: { gte: new Date(Date.now() - DAY_MS) } } }),
    prisma.scanJob.findMany({
      where: { repoFullName: inScope, status: { in: ["success", "failed"] }, startedAt: { gte: new Date(Date.now() - DAY_MS) } },
      orderBy: { startedAt: "desc" },
      select: { repoFullName: true, status: true },
    }),
    prisma.scanJob.findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true, repoFullName: true } }),
    prisma.scanJob.count({ where: { status: { in: ["queued", "running"] } } }),
    readLatest<SpringHealth>("spring-health"),
    readLatest<SpringLogs>("spring-logs"),
    readLatest<LambdaPayload>("lambda-ohio"),
    readLatest<RecsPayload>("recommendations"),
    prisma.refreshRun.findFirst({ where: { kind: "cron", status: "success" }, orderBy: { startedAt: "desc" } }),
    prisma.refreshRun.findFirst({ where: { kind: "backfill", status: "success" }, orderBy: { startedAt: "desc" } }),
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
  const springWithErrors = countErroring(services, springLogsSnap?.payload.services ?? []);
  const springTotalErrors = springLogsSnap?.payload.totals.errors ?? 0;

  const lambdas = lambdaSnap?.payload.functions ?? [];
  const lambdaErrors = lambdas.reduce((a, f) => a + (f.errors24h ?? 0), 0);
  const lambdaInv = lambdas.reduce((a, f) => a + (f.invocations24h ?? 0), 0);

  // Scan outcome per repository in the last 24 h: the most recent finished scan decides.
  const scanOutcome = new Map<string, string>();
  for (const j of recentScans) if (!scanOutcome.has(j.repoFullName)) scanOutcome.set(j.repoFullName, j.status);
  const reposFailed24h = [...scanOutcome.values()].filter((st) => st === "failed").length;
  const reposScanned24h = scanOutcome.size - reposFailed24h;

  // Recommendations: count every open one, as the Alerts page does. An instance often has two
  // alternative moves (for example t3a or t3), so savings take only the best option per instance.
  let recCount = 0;
  const bestByInstance = new Map<string, { instanceId: string; name?: string; message: string; monthlyDeltaUsd: number }>();
  let firstMessage: string | null = null;
  for (const inst of recsSnap?.payload.analyses ?? []) {
    for (const rec of inst.recommendations ?? []) {
      if (rec.kind === "ok") continue;
      recCount += 1;
      firstMessage ??= rec.message;
      const delta = typeof rec.monthlyDeltaUsd === "number" ? rec.monthlyDeltaUsd : 0;
      const best = bestByInstance.get(inst.instanceId);
      if (delta < 0 && (!best || delta < best.monthlyDeltaUsd)) {
        bestByInstance.set(inst.instanceId, { instanceId: inst.instanceId, name: inst.name, message: rec.message, monthlyDeltaUsd: delta });
      }
    }
  }
  const savers = [...bestByInstance.values()].sort((a, b) => a.monthlyDeltaUsd - b.monthlyDeltaUsd);
  const totalSavingsUsd = savers.reduce((a, r) => a - r.monthlyDeltaUsd, 0);
  const topRecommendations = savers.slice(0, 3);

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
      findings: { total: totalFindings, ...bySev, windowDays: FINDING_WINDOW_DAYS },
      scans: {
        last24h: scanJobsLast24h,
        reposScanned24h,
        reposFailed24h,
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
      instancesWithSavings: savers.length,
      top: topRecommendations,
      firstMessage,
      lastSnap: recsSnap?.meta.capturedAt ?? null,
    },
    ops: {
      cronLastAt: lastCron?.startedAt.toISOString() ?? null,
      backfillLastAt: lastBackfill?.startedAt.toISOString() ?? null,
      snapshots,
    },
  });
}
