#!/usr/bin/env node
// Read public/sonar-reports/latest-data.json + upsert one row per service into
// sonar_scan_snapshot. Called by refresh-sonar-report.sh at the end of every
// cron / manual scan so we accumulate day-over-day trend data.

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const jsonPath = path.resolve(process.cwd(), "public/sonar-reports/latest-data.json");
if (!fs.existsSync(jsonPath)) {
  console.error("persist-sonar-snapshot: latest-data.json missing at", jsonPath);
  process.exit(0); // don't fail the wrapper — just skip
}

const payload = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const services = payload.services ?? [];
if (!Array.isArray(services) || services.length === 0) {
  console.error("persist-sonar-snapshot: no services in payload");
  process.exit(0);
}

// Only persist scanned services (has a sonarProject). Not-scanned services
// have no numbers and would just add noise to trend history.
const rows = services
  .filter((s) => s.sonarProject)
  .map((s) => {
    const m = s.measures || {};
    const sev = s.severityBreakdown || {};
    return {
      repo: String(s.repo),
      branch: String(s.branch || "unspecified"),
      sonarProject: s.sonarProject,
      bugs: numOr(m.bugs, 0),
      vulns: numOr(m.vulnerabilities, 0),
      hotspots: numOr(m.security_hotspots, 0),
      smells: numOr(m.code_smells, 0),
      blockers: numOr(sev.BLOCKER, 0),
      criticals: numOr(sev.CRITICAL, 0),
      ncloc: numOr(m.ncloc, 0),
      coverage: m.coverage != null ? Number(m.coverage) : null,
      gate: s.gate ?? null,
      healthKey: s.health?.key ?? null,
    };
  });

function numOr(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : d;
}

const prisma = new PrismaClient();
try {
  await prisma.sonarScanSnapshot.createMany({ data: rows });
  console.log("persist-sonar-snapshot: wrote", rows.length, "rows");
} catch (e) {
  console.error("persist-sonar-snapshot: failed —", e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
