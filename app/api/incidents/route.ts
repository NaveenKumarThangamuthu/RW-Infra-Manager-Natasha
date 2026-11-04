/**
 * Unified incidents aggregator — DB-cached.
 *
 * Live external sources (EC2 health, CloudWatch, Prometheus, Spring logs) are
 * read from the DataSnapshot cache. The user refreshes them via the Refresh
 * button on the page (POST /api/refresh/snapshot).
 *
 * GitHub findings and Scan failures are already DB-native, so they're read
 * directly from their tables on every request.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readLatest } from "@/lib/dataSnapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export type IncidentType = "EC2" | "GITHUB" | "SPRING" | "CLOUDWATCH" | "PROMETHEUS" | "SCAN";
export type IncidentSeverity = "CRIT" | "HIGH" | "WARN" | "INFO";

export interface Incident {
  id: string;
  type: IncidentType;
  severity: IncidentSeverity;
  title: string;
  source: string;
  detail: string | null;
  detectedAt: string;
  href: string | null;
}

const FINDING_LOOKBACK_DAYS = 7;
const SCAN_LOOKBACK_HOURS = 24;
const SPRING_ERROR_RATE_THRESHOLD = 0.005;

interface Ec2Snap { instances: Array<{ instanceId: string; name: string; az: string; state: string; overallOk: boolean; systemCheck: string; instanceCheck: string; launchTime: string | null }> }
interface CwSnap  { alarms: Array<{ name: string; region: string; state: string; reason: string; metric: string; namespace: string; updatedAt: string | null }> }
interface PromSnap{ alerts: Array<{ labels: Record<string,string>; annotations: Record<string,string>; state: string; activeAt: string }> }
interface SpringLogsSnap { services: Array<{ service: string; total: number; errors: number; latestError: { at: string | null; message: string } | null }> }

function fromEc2(snap: Ec2Snap | null): Incident[] {
  if (!snap) return [];
  return (snap.instances ?? [])
    .filter((i) => i.state === "running" && !i.overallOk)
    .map((i) => ({
      id: `ec2:${i.instanceId}`,
      type: "EC2" as const,
      severity: "HIGH" as const,
      title: `${i.name || i.instanceId} — status checks failing`,
      source: `${i.instanceId} · ${i.az}`,
      detail: `System: ${i.systemCheck}  ·  Instance: ${i.instanceCheck}`,
      detectedAt: i.launchTime ?? new Date().toISOString(),
      href: `/perf/ec2/${i.instanceId}`,
    }));
}

function fromCloudwatch(snap: CwSnap | null): Incident[] {
  if (!snap) return [];
  return (snap.alarms ?? []).map((a) => ({
    id: `cw:${a.region}:${a.name}`,
    type: "CLOUDWATCH" as const,
    severity: (a.state === "ALARM" ? "HIGH" : "WARN") as IncidentSeverity,
    title: `${a.name} (${a.state})`,
    source: `${a.region} · ${a.namespace}/${a.metric}`,
    detail: a.reason || null,
    detectedAt: a.updatedAt ?? new Date().toISOString(),
    href: null,
  }));
}

function fromPrometheus(snap: PromSnap | null): Incident[] {
  if (!snap) return [];
  return (snap.alerts ?? []).map((p, i) => {
    const sev = (p.labels.severity ?? "").toLowerCase();
    const severity: IncidentSeverity =
      sev === "critical" ? "CRIT" : sev === "warning" ? "HIGH" : sev === "info" ? "INFO" : p.state === "firing" ? "HIGH" : "WARN";
    const name = p.labels.alertname ?? `alert_${i}`;
    return {
      id: `prom:${name}:${p.labels.instance ?? p.labels.service ?? i}`,
      type: "PROMETHEUS" as const,
      severity,
      title: `${name} (${p.state})`,
      source: p.labels.service ?? p.labels.instance ?? p.labels.job ?? "—",
      detail: p.annotations.summary ?? p.annotations.description ?? null,
      detectedAt: p.activeAt,
      href: null,
    };
  });
}

function fromSpringLogs(snap: SpringLogsSnap | null): Incident[] {
  if (!snap) return [];
  const out: Incident[] = [];
  for (const s of snap.services ?? []) {
    if (s.total === 0) continue;
    const rate = s.errors / s.total;
    if (rate < SPRING_ERROR_RATE_THRESHOLD) continue;
    const severity: IncidentSeverity = rate >= 0.1 ? "CRIT" : rate >= 0.02 ? "HIGH" : "WARN";
    out.push({
      id: `spring:${s.service}`,
      type: "SPRING",
      severity,
      title: `${s.service} — ${(rate * 100).toFixed(2)}% error rate (${s.errors}/${s.total} in last 1h)`,
      source: s.service,
      detail: (s.latestError?.message ?? "").split("\n")[0].slice(0, 240) || null,
      detectedAt: s.latestError?.at ?? new Date().toISOString(),
      href: `/perf/spring?service=${encodeURIComponent(s.service)}`,
    });
  }
  return out;
}

async function githubIncidents(): Promise<Incident[]> {
  const since = new Date(Date.now() - FINDING_LOOKBACK_DAYS * 86_400_000);
  const rows = await prisma.finding.findMany({
    where: { suppressedAt: null, severity: { in: ["CRIT", "HIGH"] }, lastSeenAt: { gte: since } },
    orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }],
    take: 200,
  });
  return rows.map((f) => ({
    id: `gh:${f.id}`,
    type: "GITHUB" as const,
    severity: f.severity === "CRIT" ? "CRIT" : ("HIGH" as const),
    title: f.title.slice(0, 240),
    source: f.repoFullName,
    detail: [f.scanner, f.ruleId, f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : null].filter(Boolean).join("  ·  "),
    detectedAt: f.lastSeenAt.toISOString(),
    href: `/security/${f.repoFullName}`,
  }));
}

async function scanIncidents(): Promise<Incident[]> {
  const since = new Date(Date.now() - SCAN_LOOKBACK_HOURS * 3_600_000);
  const failed = await prisma.scanJob.findMany({
    where: { status: "failed", startedAt: { gte: since } },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  return failed.map((j) => ({
    id: `scan:${j.id}`,
    type: "SCAN" as const,
    severity: "WARN" as const,
    title: `Scan failed: ${j.repoFullName} (${j.branch})`,
    source: j.repoFullName,
    detail: j.errorMessage ?? null,
    detectedAt: j.startedAt.toISOString(),
    href: `/security/${j.repoFullName}`,
  }));
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [ec2Snap, cwSnap, promSnap, springLogsSnap, gh, scan] = await Promise.all([
    readLatest<Ec2Snap>("ec2-health"),
    readLatest<CwSnap>("cloudwatch-alarms"),
    readLatest<PromSnap>("prom-alerts"),
    readLatest<SpringLogsSnap>("spring-logs"),
    githubIncidents(),
    scanIncidents(),
  ]);

  const ec2 = fromEc2(ec2Snap?.payload ?? null);
  const cw = fromCloudwatch(cwSnap?.payload ?? null);
  const prom = fromPrometheus(promSnap?.payload ?? null);
  const spring = fromSpringLogs(springLogsSnap?.payload ?? null);

  const all = [...ec2, ...gh, ...spring, ...cw, ...prom, ...scan];
  const sevOrder: Record<IncidentSeverity, number> = { CRIT: 0, HIGH: 1, WARN: 2, INFO: 3 };
  all.sort((a, b) => {
    if (a.severity !== b.severity) return sevOrder[a.severity] - sevOrder[b.severity];
    return b.detectedAt.localeCompare(a.detectedAt);
  });

  const byType: Record<IncidentType, number> = { EC2: ec2.length, GITHUB: gh.length, SPRING: spring.length, CLOUDWATCH: cw.length, PROMETHEUS: prom.length, SCAN: scan.length };
  const bySeverity: Record<IncidentSeverity, number> = { CRIT: 0, HIGH: 0, WARN: 0, INFO: 0 };
  for (const i of all) bySeverity[i.severity]++;

  const sourceMeta = {
    "ec2-health": ec2Snap?.meta ?? null,
    "cloudwatch-alarms": cwSnap?.meta ?? null,
    "prom-alerts": promSnap?.meta ?? null,
    "spring-logs": springLogsSnap?.meta ?? null,
  };
  const oldestSnap = [ec2Snap, cwSnap, promSnap, springLogsSnap]
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => s.meta.capturedAt)
    .sort()[0] ?? null;

  return NextResponse.json({
    ok: true,
    fetchedAt: new Date().toISOString(),
    snapshotOldestAt: oldestSnap,
    total: all.length,
    byType,
    bySeverity,
    incidents: all,
    sourceMeta,
  });
}
