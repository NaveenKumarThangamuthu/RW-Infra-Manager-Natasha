/**
 * Per-entity issue summary — used by table indicators on EC2 / Volumes /
 * Repos / Spring service tables. Returns a small map per entity type with
 * the highest severity, incident count, and recommendation count.
 *
 * Reads from the same DataSnapshot cache as the rest of the app; no upstream
 * calls. Refreshed by the user via the per-page Refresh button.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readLatest } from "@/lib/dataSnapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

type Sev = "CRIT" | "HIGH" | "WARN" | "INFO";

interface Bucket { sev: Sev; incidents: number; recommendations: number; href: string | null }

const SEV_RANK: Record<Sev, number> = { CRIT: 4, HIGH: 3, WARN: 2, INFO: 1 };

function bump(map: Map<string, Bucket>, key: string, sev: Sev, kind: "incident" | "recommendation", href: string | null) {
  const prev = map.get(key);
  if (!prev) {
    map.set(key, { sev, incidents: kind === "incident" ? 1 : 0, recommendations: kind === "recommendation" ? 1 : 0, href });
    return;
  }
  if (SEV_RANK[sev] > SEV_RANK[prev.sev]) prev.sev = sev;
  if (kind === "incident") prev.incidents++;
  else prev.recommendations++;
  if (!prev.href && href) prev.href = href;
}

interface Ec2InstanceHealth { instanceId: string; state: string; overallOk: boolean; systemCheck: string; instanceCheck: string }
interface Recommendation { severity: Sev; message: string }
interface InstanceAnalysis { instanceId: string; recommendations: Recommendation[] }
interface CwAlarm { name: string; region: string; state: string; dimensions?: Array<{ name: string; value: string }> }
interface PromAlert { labels: Record<string, string>; state: string }
interface SpringLogStat { service: string; total: number; errors: number }

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [ec2Snap, recSnap, cwSnap, promSnap, springLogsSnap, scanFails, findings] = await Promise.all([
    readLatest<{ instances: Ec2InstanceHealth[] }>("ec2-health"),
    readLatest<{ analyses: InstanceAnalysis[] }>("recommendations"),
    readLatest<{ alarms: CwAlarm[] }>("cloudwatch-alarms"),
    readLatest<{ alerts: PromAlert[] }>("prom-alerts"),
    readLatest<{ services: SpringLogStat[] }>("spring-logs"),
    prisma.scanJob.findMany({
      where: { status: "failed", startedAt: { gte: new Date(Date.now() - 24 * 3_600_000) } },
      select: { repoFullName: true },
    }),
    prisma.finding.groupBy({
      by: ["repoFullName", "severity"],
      where: { suppressedAt: null, severity: { in: ["CRIT", "HIGH"] }, lastSeenAt: { gte: new Date(Date.now() - 2 * 86_400_000) } },
      _count: { _all: true },
    }),
  ]);

  const ec2: Map<string, Bucket> = new Map();
  const services: Map<string, Bucket> = new Map();
  const repos: Map<string, Bucket> = new Map();

  for (const i of ec2Snap?.payload.instances ?? []) {
    if (i.state === "running" && !i.overallOk) {
      bump(ec2, i.instanceId, "HIGH", "incident", `/perf/ec2/${i.instanceId}`);
    }
  }
  for (const a of recSnap?.payload.analyses ?? []) {
    for (const r of a.recommendations ?? []) {
      // Only surface WARN/CRIT/HIGH inline — INFO suggestions stay on /perf/recommendations.
      if (r.severity === "INFO") continue;
      bump(ec2, a.instanceId, r.severity, "recommendation", `/perf/ec2/${a.instanceId}`);
    }
  }
  for (const a of cwSnap?.payload.alarms ?? []) {
    const inst = (a.dimensions ?? []).find((d) => d.name === "InstanceId")?.value;
    if (inst) bump(ec2, inst, a.state === "ALARM" ? "HIGH" : "WARN", "incident", null);
  }
  for (const p of promSnap?.payload.alerts ?? []) {
    const inst = p.labels.instance ?? "";
    const id = inst.match(/i-[0-9a-f]+/)?.[0];
    if (id) {
      const sev: Sev = p.labels.severity === "critical" ? "CRIT" : p.labels.severity === "warning" ? "HIGH" : p.state === "firing" ? "HIGH" : "WARN";
      bump(ec2, id, sev, "incident", null);
    }
  }

  const SPRING_THRESHOLD = 0.005;
  for (const s of springLogsSnap?.payload.services ?? []) {
    if (s.total === 0) continue;
    const rate = s.errors / s.total;
    if (rate < SPRING_THRESHOLD) continue;
    const sev: Sev = rate >= 0.1 ? "CRIT" : rate >= 0.02 ? "HIGH" : "WARN";
    bump(services, s.service, sev, "incident", `/perf/spring?service=${encodeURIComponent(s.service)}`);
  }

  for (const f of findings) {
    bump(repos, f.repoFullName, f.severity === "CRIT" ? "CRIT" : "HIGH", "incident", `/security/${f.repoFullName}`);
    // count once per severity-group bucket
    const b = repos.get(f.repoFullName);
    if (b) b.incidents += f._count._all - 1;
  }
  for (const s of scanFails) {
    bump(repos, s.repoFullName, "WARN", "incident", `/security/${s.repoFullName}`);
  }

  function toObj(m: Map<string, Bucket>): Record<string, Bucket> {
    const o: Record<string, Bucket> = {};
    for (const [k, v] of m) o[k] = v;
    return o;
  }

  return NextResponse.json({
    ok: true,
    fetchedAt: new Date().toISOString(),
    ec2: toObj(ec2),
    services: toObj(services),
    repos: toObj(repos),
  });
}
