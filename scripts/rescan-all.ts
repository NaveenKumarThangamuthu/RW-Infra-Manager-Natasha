/**
 * Bulk re-scan every in-scope repository on its configured scan branch.
 *
 * Scope matches the dashboard's /api/security/repos definition:
 *   non-archived repos ∩ Google-Sheet allowlist (falls back to all
 *   non-archived if the sheet can't be reached — the allowlist is a
 *   filter, not a gate).
 *
 * Runs scanners with bounded concurrency so Trivy can't exhaust RAM.
 * Progress is appended to logs/rescan-all.log and mirrored into
 * logs/rescan-all-state.json so a long run can be polled from outside.
 *
 * Usage: npx tsx scripts/rescan-all.ts [--concurrency N] [--limit N] [--all]
 */
import { writeFileSync, appendFileSync, mkdirSync } from "fs";
import path from "path";
import { prisma } from "../lib/db";
import { scanRepo } from "../lib/scanRepo";
import { getRepoAllowlist, isRepoAllowed } from "../lib/sheetAllowlist";

const REPO_ROOT = path.join(__dirname, "..");
const LOG = path.join(REPO_ROOT, "logs/rescan-all.log");
const STATE = path.join(REPO_ROOT, "logs/rescan-all-state.json");
const TRIGGERED_BY = process.env.NATASHA_SCAN_USER || "naveen@rw.team";

const args = process.argv.slice(2);
const argVal = (flag: string, dflt: number) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : dflt;
};
const CONCURRENCY = argVal("--concurrency", 4);
const LIMIT = argVal("--limit", 0);
const BYPASS_ALLOWLIST = args.includes("--all");

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG, line + "\n");
}

async function main() {
  mkdirSync(path.join(REPO_ROOT, "logs"), { recursive: true });

  const all = await prisma.repo.findMany({ orderBy: { pushedAt: "desc" } });
  const nonArchived = all.filter((r) => !r.archived);

  let targets = nonArchived;
  let allowlistNote = "bypassed (--all)";
  if (!BYPASS_ALLOWLIST) {
    const allowlist = await getRepoAllowlist().catch(() => null);
    if (allowlist?.repos) {
      targets = nonArchived.filter((r) => isRepoAllowed(allowlist.repos, r.fullName));
      allowlistNote = `sheet: ${allowlist.count} entries, source=${allowlist.source}${allowlist.error ? `, error=${allowlist.error}` : ""}`;
    } else {
      allowlistNote = "UNAVAILABLE — falling back to all non-archived";
    }
  }
  if (LIMIT > 0) targets = targets.slice(0, LIMIT);

  log(`=== rescan start · repos_total=${all.length} non_archived=${nonArchived.length} targets=${targets.length} concurrency=${CONCURRENCY}`);
  log(`=== allowlist: ${allowlistNote}`);

  const started = Date.now();
  const results: Array<{
    repo: string; branch: string; status: string; findings: number;
    crit: number; high: number; durationMs: number; error?: string;
  }> = [];

  let cursor = 0;
  let done = 0;

  const writeState = () => {
    writeFileSync(
      STATE,
      JSON.stringify(
        {
          startedAt: new Date(started).toISOString(),
          updatedAt: new Date().toISOString(),
          total: targets.length,
          done,
          running: Math.min(CONCURRENCY, targets.length - done),
          elapsedSec: Math.round((Date.now() - started) / 1000),
          ok: results.filter((r) => r.status === "success").length,
          failed: results.filter((r) => r.status !== "success").length,
          findings: results.reduce((a, r) => a + r.findings, 0),
          results,
        },
        null,
        2,
      ),
    );
  };

  async function worker(id: number) {
    for (;;) {
      const i = cursor++;
      if (i >= targets.length) return;
      const r = targets[i];
      const t0 = Date.now();
      try {
        const out = await scanRepo({
          triggeredBy: TRIGGERED_BY,
          owner: r.owner,
          name: r.name,
          branch: r.scanBranch,
          trigger: "scheduled",
        });
        results.push({
          repo: r.fullName, branch: r.scanBranch, status: out.status,
          findings: out.findingsTotal,
          crit: out.bySeverity?.CRIT ?? 0, high: out.bySeverity?.HIGH ?? 0,
          durationMs: out.durationMs,
          error: out.errorMessage,
        });
        done++;
        log(`[${done}/${targets.length}] w${id} ${out.status.padEnd(7)} ${r.fullName}@${r.scanBranch} findings=${out.findingsTotal} crit=${out.bySeverity?.CRIT ?? 0} ${Math.round(out.durationMs / 1000)}s${out.errorMessage ? " err=" + out.errorMessage.slice(0, 120) : ""}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          repo: r.fullName, branch: r.scanBranch, status: "failed",
          findings: 0, crit: 0, high: 0, durationMs: Date.now() - t0, error: msg,
        });
        done++;
        log(`[${done}/${targets.length}] w${id} FAILED  ${r.fullName}@${r.scanBranch} — ${msg.slice(0, 180)}`);
      }
      if (done % 5 === 0 || done === targets.length) writeState();
    }
  }

  writeState();
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, (_, i) => worker(i + 1)));
  writeState();

  const ok = results.filter((r) => r.status === "success").length;
  const failed = results.length - ok;
  const totalFindings = results.reduce((a, r) => a + r.findings, 0);
  log(`=== rescan done in ${Math.round((Date.now() - started) / 1000)}s · ok=${ok} failed=${failed} findings=${totalFindings}`);

  if (failed) {
    log("=== failures:");
    for (const r of results.filter((x) => x.status !== "success")) {
      log(`    ${r.repo}@${r.branch} — ${(r.error || "unknown").slice(0, 200)}`);
    }
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  log("FATAL " + (e instanceof Error ? e.stack : String(e)));
  await prisma.$disconnect();
  process.exit(1);
});
