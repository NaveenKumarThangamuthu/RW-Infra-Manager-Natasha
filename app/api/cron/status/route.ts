/**
 * Read-only status for the Cron jobs screen: recent refresh runs plus the
 * latest attempt per snapshot source. /api/cron/* is excluded from the auth
 * middleware for machine callers, so this route checks the session itself.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ALL_SOURCES } from "@/lib/dataSnapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const RUN_LIMIT = 8;
const CRON_PREFIX = "cron:";
/** Sources from one run start together; attempts this close belong to the same run. */
const RUN_GAP_MS = 10 * 60 * 1000;

interface Attempt { source: string; capturedAt: Date; status: string; fetchMs: number | null; refreshedBy: string | null; errorMessage: string | null }

function groupRuns(attempts: Attempt[]) {
  const runs: Array<{ label: string; startedAt: string; ok: number; total: number; durationMs: number }> = [];
  let current: { label: string; first: Date; last: Date; ok: number; sources: Set<string>; maxFetch: number } | null = null;
  const flush = () => {
    if (current) runs.push({ label: current.label, startedAt: current.first.toISOString(), ok: current.ok, total: current.sources.size, durationMs: current.maxFetch });
  };
  for (const a of attempts) {
    const label = (a.refreshedBy ?? "").slice(CRON_PREFIX.length);
    if (!current || current.label !== label || current.first.getTime() - a.capturedAt.getTime() > RUN_GAP_MS) {
      flush();
      current = { label, first: a.capturedAt, last: a.capturedAt, ok: 0, sources: new Set(), maxFetch: 0 };
    }
    if (a.capturedAt < current.first) current.first = a.capturedAt;
    current.sources.add(a.source);
    if (a.status === "success") current.ok++;
    current.maxFetch = Math.max(current.maxFetch, a.fetchMs ?? 0);
  }
  flush();
  return runs.slice(0, RUN_LIMIT);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const select = { source: true, capturedAt: true, status: true, fetchMs: true, refreshedBy: true, errorMessage: true } as const;
  const [cronRuns, lastBilling, lastBackfill, lastCert, repoSync, repoCount, sources, cronAttempts] = await Promise.all([
    prisma.refreshRun.findMany({ where: { kind: "cron" }, orderBy: { startedAt: "desc" }, take: RUN_LIMIT }),
    prisma.refreshRun.findFirst({ where: { kind: "cron", finishedAt: { not: null } }, orderBy: { startedAt: "desc" } }),
    prisma.refreshRun.findFirst({ where: { kind: "backfill" }, orderBy: { startedAt: "desc" } }),
    prisma.certificateCheck.findFirst({ orderBy: { id: "desc" } }),
    prisma.repo.findFirst({ orderBy: { lastSyncedAt: "desc" }, select: { lastSyncedAt: true } }),
    prisma.repo.count({ where: { archived: false } }),
    Promise.all(ALL_SOURCES.map(async (source) => ({
      source,
      latest: await prisma.dataSnapshot.findFirst({ where: { source }, orderBy: { capturedAt: "desc" }, select }),
      lastGood: await prisma.dataSnapshot.findFirst({ where: { source, status: "success" }, orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }),
    }))),
    prisma.dataSnapshot.findMany({ where: { refreshedBy: { startsWith: CRON_PREFIX } }, orderBy: { capturedAt: "desc" }, take: RUN_LIMIT * ALL_SOURCES.length, select }),
  ]);

  return NextResponse.json({
    ok: true,
    sources: sources.map((s) => ({
      source: s.source,
      status: s.latest?.status ?? null,
      capturedAt: s.latest?.capturedAt.toISOString() ?? null,
      fetchMs: s.latest?.fetchMs ?? null,
      error: s.latest?.errorMessage ?? null,
      lastGoodAt: s.lastGood?.capturedAt.toISOString() ?? null,
    })),
    runs: groupRuns(cronAttempts),
    billingRuns: cronRuns.map((r) => ({ label: r.runLabel, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null, status: r.status })),
    lastBilling: lastBilling && { startedAt: lastBilling.startedAt.toISOString(), finishedAt: lastBilling.finishedAt?.toISOString() ?? null, status: lastBilling.status, label: lastBilling.runLabel },
    lastBackfill: lastBackfill && { startedAt: lastBackfill.startedAt.toISOString(), finishedAt: lastBackfill.finishedAt?.toISOString() ?? null, status: lastBackfill.status },
    lastCertificateCheck: lastCert ? lastCert.parsedAt.toISOString() : null,
    repos: { count: repoCount, lastSyncedAt: repoSync?.lastSyncedAt?.toISOString() ?? null },
  });
}
