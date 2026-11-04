import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

interface ServiceIn {
  repo: string;
  branch: string;
  sonarProject: string | null;
  measures: Record<string, string> | null;
  severityBreakdown: Record<string, number> | null;
  [k: string]: unknown;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const p = path.resolve(process.cwd(), "public/sonar-reports/latest-data.json");
  if (!fs.existsSync(p)) {
    return NextResponse.json({ ok: false, hasData: false, error: "No scan data on disk yet — run a refresh first." }, { status: 404 });
  }
  const raw = fs.readFileSync(p, "utf8");
  const payload = JSON.parse(raw);
  const services: ServiceIn[] = payload.services ?? [];

  // Fetch prior snapshots — most-recent row per (repo, branch) that's older than
  // the very latest capture. That's "yesterday" from the report's perspective.
  const scannedKeys = services.filter((s) => s.sonarProject).map((s) => ({ repo: s.repo, branch: s.branch }));
  const priorByKey = new Map<string, { bugs: number; criticals: number; blockers: number; smells: number; hotspots: number; vulns: number; capturedAt: Date }>();

  if (scannedKeys.length) {
    // Find each service's second-most-recent scan (skip the row we just wrote).
    // We pull the top 2 rows per repo+branch, then pick index 1.
    for (const { repo, branch } of scannedKeys) {
      const rows = await prisma.sonarScanSnapshot.findMany({
        where: { repo, branch },
        orderBy: { capturedAt: "desc" },
        take: 2,
      });
      if (rows.length >= 2) {
        const prior = rows[1];
        priorByKey.set(`${repo}@${branch}`, {
          bugs: prior.bugs,
          criticals: prior.criticals,
          blockers: prior.blockers,
          smells: prior.smells,
          hotspots: prior.hotspots,
          vulns: prior.vulns,
          capturedAt: prior.capturedAt,
        });
      }
    }
  }

  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  // Attach `trend` object to each scanned service.
  const enriched = services.map((s) => {
    if (!s.sonarProject) return s;
    const prior = priorByKey.get(`${s.repo}@${s.branch}`);
    if (!prior) return { ...s, trend: null };
    const m = s.measures || {};
    const sev = s.severityBreakdown || {};
    return {
      ...s,
      trend: {
        priorAt: prior.capturedAt.toISOString(),
        bugs: num(m.bugs) - prior.bugs,
        criticals: num(sev.CRITICAL) - prior.criticals,
        blockers: num(sev.BLOCKER) - prior.blockers,
        smells: num(m.code_smells) - prior.smells,
        hotspots: num(m.security_hotspots) - prior.hotspots,
        vulns: num(m.vulnerabilities) - prior.vulns,
      },
    };
  });

  return NextResponse.json({ ok: true, hasData: true, ...payload, services: enriched });
}
