/**
 * Snapshot cache for live external data sources.
 * Pages read from the latest successful snapshot; manual Refresh button
 * triggers fetch + persist. See prisma `DataSnapshot`.
 */
import { prisma } from "./db";

/** Sources refreshed by the twice-daily cron. */
export type LiveSource = "spring-health" | "spring-logs" | "ec2-health" | "ec2-volumes" | "cloudwatch-alarms" | "prom-alerts" | "recommendations" | "lambda-ohio";

/** All sources we read from data_snapshot (cron-refreshed + AI brief, which is computed post-refresh). */
export type Source = LiveSource | "ai-brief";

export const ALL_SOURCES: LiveSource[] = [
  "spring-health",
  "spring-logs",
  "ec2-health",
  "ec2-volumes",
  "cloudwatch-alarms",
  "prom-alerts",
  "recommendations",
  "lambda-ohio",
];

export interface SnapshotMeta {
  source: Source;
  capturedAt: string;
  via: string | null;
  fetchMs: number | null;
  refreshedBy: string | null;
}

export async function readLatest<T = unknown>(source: Source): Promise<{ payload: T; meta: SnapshotMeta } | null> {
  const row = await prisma.dataSnapshot.findFirst({
    where: { source, status: "success" },
    orderBy: { capturedAt: "desc" },
  });
  if (!row) return null;
  let parsed: T;
  try {
    parsed = JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
  return {
    payload: parsed,
    meta: {
      source,
      capturedAt: row.capturedAt.toISOString(),
      via: row.via,
      fetchMs: row.fetchMs,
      refreshedBy: row.refreshedBy,
    },
  };
}

export async function saveSnapshot(
  source: Source,
  payload: unknown,
  opts: { via?: string | null; fetchMs?: number | null; refreshedBy?: string | null } = {},
): Promise<SnapshotMeta> {
  const row = await prisma.dataSnapshot.create({
    data: {
      source,
      payload: JSON.stringify(payload),
      via: opts.via ?? null,
      fetchMs: opts.fetchMs ?? null,
      refreshedBy: opts.refreshedBy ?? null,
      status: "success",
    },
  });
  return {
    source,
    capturedAt: row.capturedAt.toISOString(),
    via: row.via,
    fetchMs: row.fetchMs,
    refreshedBy: row.refreshedBy,
  };
}

export async function saveFailure(source: Source, err: unknown, refreshedBy: string | null = null): Promise<void> {
  await prisma.dataSnapshot.create({
    data: {
      source,
      payload: "{}",
      status: "failed",
      errorMessage: err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000),
      refreshedBy,
    },
  });
}

/// Prune old snapshots — keep only the last N per source.
export async function pruneOld(source: Source, keep = 20): Promise<number> {
  const rows = await prisma.dataSnapshot.findMany({
    where: { source },
    orderBy: { capturedAt: "desc" },
    skip: keep,
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  const res = await prisma.dataSnapshot.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  return res.count;
}
