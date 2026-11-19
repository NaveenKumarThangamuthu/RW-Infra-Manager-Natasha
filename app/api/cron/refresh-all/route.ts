/**
 * Cron endpoint — refreshes all DataSnapshot sources AND syncs GitHub repos
 * for every connected user. Scheduled by the host crontab twice daily
 * (00:30 UTC / 12:30 UTC = 06:00 / 18:00 IST). Authed by CRON_SECRET.
 *
 *   POST /api/cron/refresh-all
 *   Authorization: Bearer <CRON_SECRET>
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ALL_SOURCES, saveSnapshot, saveFailure, pruneOld, type LiveSource } from "@/lib/dataSnapshot";
import {
  fetchSpringHealth, fetchSpringLogs, fetchEc2Health, fetchEc2Volumes,
  fetchCloudWatchAlarms, fetchPromAlerts, fetchRecommendations, fetchLambdaOhio,
} from "@/lib/snapshotFetchers";
import { listRepos, resolveScanBranches, type GitHubRepo } from "@/lib/github";
import { readToken } from "@/lib/githubVault";
import { archiveVanishedRepos, REPO_LIST_LIMIT, type ListedRepo } from "@/lib/repoSync";
import { sendCronSummary } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

const FETCHERS: Record<LiveSource, () => Promise<{ payload: unknown; via: string | null; fetchMs: number }>> = {
  "spring-health": fetchSpringHealth,
  "spring-logs": fetchSpringLogs,
  "ec2-health": fetchEc2Health,
  "ec2-volumes": fetchEc2Volumes,
  "cloudwatch-alarms": fetchCloudWatchAlarms,
  "prom-alerts": fetchPromAlerts,
  "recommendations": fetchRecommendations,
  "lambda-ohio": fetchLambdaOhio,
};

async function refreshAllSnapshots(refreshedBy: string) {
  return Promise.all(ALL_SOURCES.map(async (src) => {
    try {
      const { payload, via, fetchMs } = await FETCHERS[src]();
      const meta = await saveSnapshot(src, payload, { via, fetchMs, refreshedBy });
      await pruneOld(src);
      return { source: src, ok: true, fetchMs, via, capturedAt: meta.capturedAt };
    } catch (err) {
      await saveFailure(src, err, refreshedBy);
      return { source: src, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }));
}

/** One person's complete GitHub listing, kept so vanished repos can be worked out afterwards. */
interface UserListing { repos: ListedRepo[]; complete: boolean }

async function syncReposForUser(email: string, listings: UserListing[]) {
  const t0 = Date.now();
  const t = await readToken(email);
  if (!t) return { user: email, ok: false, error: "no token" };
  let all: GitHubRepo[];
  try {
    all = await listRepos(t.token, REPO_LIST_LIMIT);
  } catch (err) {
    return { user: email, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  listings.push({
    repos: all.map((r) => ({ fullName: r.full_name, owner: r.owner.login })),
    complete: all.length < REPO_LIST_LIMIT,
  });
  const branches = await resolveScanBranches(
    t.token,
    all.map((r) => ({ owner: r.owner.login, name: r.name, default_branch: r.default_branch })),
  );
  const now = new Date();
  let inserted = 0, updated = 0;
  for (const r of all) {
    const data = {
      fullName: r.full_name, owner: r.owner.login, name: r.name, githubId: BigInt(r.id),
      private: r.private, fork: r.fork, archived: r.archived, description: r.description, language: r.language,
      defaultBranch: r.default_branch, scanBranch: branches.get(`${r.owner.login}/${r.name}`) ?? r.default_branch,
      htmlUrl: r.html_url, stars: r.stargazers_count, pushedAt: r.pushed_at ? new Date(r.pushed_at) : null,
      lastSyncedAt: now,
    };
    // `githubId` and `fullName` are both unique. Upserting on githubId alone
    // throws when a *different* row already holds this fullName — which happens
    // whenever a repo is deleted and recreated, or transferred between orgs, so
    // its numeric id changes while the name stays. GitHub is the source of
    // truth, so rebind the existing row to the new id instead of failing.
    const existing = await prisma.repo.findUnique({ where: { githubId: data.githubId } });
    if (existing) {
      await prisma.repo.update({ where: { githubId: data.githubId }, data });
      updated++;
    } else {
      const byName = await prisma.repo.findUnique({ where: { fullName: data.fullName } });
      if (byName) {
        await prisma.repo.update({ where: { fullName: data.fullName }, data });
        updated++;
      } else {
        await prisma.repo.create({ data });
        inserted++;
      }
    }
  }
  return { user: email, ok: true, fetched: all.length, inserted, updated, fetchMs: Date.now() - t0 };
}

async function syncAllRepos() {
  const connections = await prisma.githubConnection.findMany({
    where: { revokedAt: null },
    select: { userEmail: true },
  });
  const listings: UserListing[] = [];
  const results = await Promise.all(connections.map((c) => syncReposForUser(c.userEmail, listings).catch((err) => ({
    user: c.userEmail, ok: false, error: err instanceof Error ? err.message : String(err),
  }))));

  // Repos that GitHub no longer lists are taken out of scan scope (never deleted).
  // Only when every connection synced cleanly and in full: the combined listing is
  // then everything we can see, so a row missing from it is really gone.
  const everyoneOk = results.length > 0 && results.every((r) => r.ok) && listings.length === results.length;
  try {
    const vanished = await archiveVanishedRepos(
      listings.flatMap((l) => l.repos),
      { complete: everyoneOk && listings.every((l) => l.complete) },
    );
    if (vanished.archived > 0) {
      console.log(`[repo-sync] marked ${vanished.archived} repos no longer on GitHub as archived: ${vanished.names.join(", ")}`);
    }
  } catch (err) {
    console.error("[repo-sync] could not mark vanished repos:", err instanceof Error ? err.message : String(err));
  }
  return results;
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const label = new URL(req.url).searchParams.get("label") ?? "cron";
  const startedAt = new Date().toISOString();

  const [snapshotResults, repoResults] = await Promise.all([
    refreshAllSnapshots(`cron:${label}`),
    syncAllRepos(),
  ]);

  // Daily AI brief — computed AFTER snapshots have refreshed so the prompt
  // reads the freshest state. Failure is non-fatal for the cron run.
  let briefOk = false;
  try {
    const base = `http://localhost:${process.env.PORT ?? 3000}`;
    const resp = await fetch(`${base}/api/brief?label=${encodeURIComponent(label)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
    });
    briefOk = resp.ok;
  } catch {
    briefOk = false;
  }

  // Compute the alert payload (anomalies + new CRIT/HIGH findings since last cron run).
  let anomaliesForAlert: Array<{ service: string; resourceId: string; latestAmount: number; baselineMedian: number; spikeUsd: number; zScore: number }> = [];
  let newCrit = 0;
  let newHigh = 0;
  try {
    const base = `http://localhost:${process.env.PORT ?? 3000}`;
    // We need an authed call; reuse the cron secret via a tiny internal hop.
    // The /api/cost/anomalies route is session-guarded — call the helper inline instead.
    const { prisma } = await import("@/lib/db");
    const since = new Date(Date.now() - 15 * 86_400_000).toISOString().slice(0, 10);
    const rows = await prisma.resourceDailyCost.findMany({
      where: { date: { gte: since } },
      orderBy: [{ service: "asc" }, { resourceId: "asc" }, { date: "asc" }],
    });
    const grouped = new Map<string, { service: string; resourceId: string; series: Array<{ date: string; amount: number }> }>();
    for (const r of rows) {
      const k = `${r.service}|${r.resourceId}`;
      if (!grouped.has(k)) grouped.set(k, { service: r.service, resourceId: r.resourceId, series: [] });
      grouped.get(k)!.series.push({ date: r.date, amount: Number(r.amount) });
    }
    const median = (xs: number[]): number => {
      const s = [...xs].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length === 0 ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    for (const { service, resourceId, series } of grouped.values()) {
      if (series.length < 4) continue;
      const last = series[series.length - 1];
      const baseline = series.slice(0, -1).map((p) => p.amount);
      const med = median(baseline);
      const dev = baseline.map((x) => Math.abs(x - med));
      const mad = median(dev);
      const sigma = Math.max(mad * 1.4826, 0.05);
      const z = (last.amount - med) / sigma;
      const spike = last.amount - med;
      if (z >= 2.5 && spike >= 1) {
        anomaliesForAlert.push({
          service,
          resourceId,
          latestAmount: +last.amount.toFixed(2),
          baselineMedian: +med.toFixed(2),
          spikeUsd: +spike.toFixed(2),
          zScore: +z.toFixed(1),
        });
      }
    }
    anomaliesForAlert.sort((a, b) => b.spikeUsd - a.spikeUsd);
    void base; // silence unused warning when not used

    // New findings since 12h ago (a cron interval).
    const cutoff = new Date(Date.now() - 12 * 3600 * 1000);
    const newFindings = await prisma.finding.groupBy({
      by: ["severity"],
      where: { suppressedAt: null, firstSeenAt: { gte: cutoff } },
      _count: { _all: true },
    });
    for (const f of newFindings) {
      if (f.severity === "CRIT") newCrit = f._count._all;
      if (f.severity === "HIGH") newHigh = f._count._all;
    }
  } catch {
    // alert payload computation failed — don't fail the cron
  }

  // Best-effort Telegram alert — fully no-op if env not set.
  try {
    await sendCronSummary({
      label,
      snapshotsOk: snapshotResults.filter((r) => r.ok).length,
      snapshotsFail: snapshotResults.filter((r) => !r.ok).length,
      reposSynced: repoResults.filter((r) => r.ok).length,
      briefOk,
      anomalies: anomaliesForAlert,
      newFindings: { CRIT: newCrit, HIGH: newHigh },
    });
  } catch {
    // notify failure is non-fatal
  }

  const snapshotOk = snapshotResults.filter((r) => r.ok).length;
  const repoOk = repoResults.filter((r) => r.ok).length;
  const finishedAt = new Date().toISOString();

  return NextResponse.json({
    ok: snapshotResults.every((r) => r.ok) && repoResults.every((r) => r.ok),
    label,
    startedAt,
    finishedAt,
    snapshots: { total: snapshotResults.length, ok: snapshotOk, results: snapshotResults },
    repos: { total: repoResults.length, ok: repoOk, results: repoResults },
    brief: { ok: briefOk },
  });
}

export async function GET(req: Request) {
  // Allow GET too for simpler `curl` from crontab. Same auth.
  return POST(req);
}
