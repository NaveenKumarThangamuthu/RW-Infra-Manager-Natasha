/**
 * Bulk re-scan every in-scope repository on its configured scan branch.
 *
 * Scope matches the dashboard's /api/security/repos definition:
 *   non-archived repos ∩ Google-Sheet allowlist. If the sheet can't be
 *   read it falls back to all non-archived repos, unless --require-allowlist
 *   is passed (the published report does), in which case the run aborts with
 *   exit code 3 rather than scan and publish the wrong scope.
 *
 * A clone that fails for a passing reason (HTTP 5xx, timeout, dropped
 * connection) is retried twice with a pause. A repository with no commits is
 * recorded as "skipped", not "failed".
 *
 * Runs scanners with bounded concurrency so Trivy can't exhaust RAM.
 * Progress is appended to logs/rescan-all.log and mirrored into
 * logs/rescan-all-state.json so a long run can be polled from outside.
 *
 * Usage: npx tsx scripts/rescan-all.ts [--concurrency N] [--limit N] [--all] [--require-allowlist]
 */
import { writeFileSync, appendFileSync, mkdirSync } from "fs";
import path from "path";
import { prisma, ensureSecretsHydrated } from "../lib/db";
import { readToken } from "../lib/githubVault";
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
const REQUIRE_ALLOWLIST = args.includes("--require-allowlist");
const EXIT_NO_ALLOWLIST = 3;
const RETRY_DELAYS_MS = [15_000, 45_000];

type RunStatus = "success" | "failed" | "skipped";
interface RunResult {
  repo: string; branch: string; status: RunStatus; findings: number;
  crit: number; high: number; durationMs: number; error?: string; attempts: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** GitHub-side or network trouble that is worth another try, as opposed to a missing repo or branch. */
function isTransient(error: string): boolean {
  if (/Repository not found|Remote branch .+ not found|Authentication failed|not connected/i.test(error)) return false;
  if (/HTTP 5\d\d|returned error: 5\d\d|RPC failed|early EOF|timed? ?out|Connection (reset|refused)|Could not resolve host|unexpected disconnect|remote end hung up/i.test(error)) return true;
  // A clone killed at the timeout leaves only git's "Cloning into ..." line, with no fatal/error text.
  return /^clone failed:/.test(error) && !/fatal:|error:/i.test(error);
}

/** True when GitHub reports the repository has no commits at all (HTTP 409 "Git Repository is empty"). */
async function isEmptyRepo(owner: string, name: string): Promise<boolean> {
  try {
    const tok = await readToken(TRIGGERED_BY);
    if (!tok) return false;
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${tok.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "natasha-dashboard/1.0",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    return res.status === 409;
  } catch {
    return false;
  }
}

/** One scan attempt, with a thrown error folded into the same shape as a failed scan. */
async function attempt(r: { owner: string; name: string; fullName: string; scanBranch: string }): Promise<Omit<RunResult, "attempts">> {
  const t0 = Date.now();
  try {
    const out = await scanRepo({
      triggeredBy: TRIGGERED_BY, owner: r.owner, name: r.name, branch: r.scanBranch, trigger: "scheduled",
    });
    return {
      repo: r.fullName, branch: r.scanBranch, status: out.status, findings: out.findingsTotal,
      crit: out.bySeverity?.CRIT ?? 0, high: out.bySeverity?.HIGH ?? 0,
      durationMs: out.durationMs, error: out.errorMessage,
    };
  } catch (err) {
    return {
      repo: r.fullName, branch: r.scanBranch, status: "failed", findings: 0, crit: 0, high: 0,
      durationMs: Date.now() - t0, error: err instanceof Error ? err.message : String(err),
    };
  }
}

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
  // notInDb: on the sheet but no row in our repo table (removed or renamed on GitHub).
  // archivedInDb: on the sheet but archived, so not scanned either.
  let allowlistInfo: {
    used: boolean; entries: number; source: string | null; error: string | null; notInDb: string[]; archivedInDb: string[];
  } = { used: false, entries: 0, source: null, error: null, notInDb: [], archivedInDb: [] };
  if (!BYPASS_ALLOWLIST) {
    // The sheet credentials live in the encrypted store; make sure they are loaded before the fetch.
    await ensureSecretsHydrated();
    let fetchError: string | null = null;
    const allowlist = await getRepoAllowlist().catch((e: unknown) => {
      fetchError = e instanceof Error ? e.message : String(e);
      return null;
    });
    if (allowlist?.repos) {
      const allowed = allowlist.repos;
      targets = nonArchived.filter((r) => isRepoAllowed(allowed, r.fullName));
      const known = new Set(all.map((r) => r.fullName.toLowerCase()));
      const notInDb = [...allowed].filter((x) => !known.has(x)).sort();
      const archivedInDb = all.filter((r) => r.archived && allowed.has(r.fullName.toLowerCase())).map((r) => r.fullName).sort();
      allowlistInfo = { used: true, entries: allowlist.count, source: allowlist.source, error: null, notInDb, archivedInDb };
      allowlistNote = `sheet: ${allowlist.count} entries, source=${allowlist.source}` +
        (notInDb.length ? `, not in our repo table: ${notInDb.join(", ")}` : "") +
        (archivedInDb.length ? `, archived: ${archivedInDb.join(", ")}` : "");
    } else {
      const reason = allowlist?.error ?? fetchError ?? "unknown error";
      allowlistInfo = { used: false, entries: 0, source: allowlist?.source ?? null, error: reason, notInDb: [], archivedInDb: [] };
      if (REQUIRE_ALLOWLIST) {
        log(`=== allowlist: UNAVAILABLE — ${reason}`);
        log("=== aborting: --require-allowlist is set, so nothing was scanned");
        await prisma.$disconnect();
        process.exit(EXIT_NO_ALLOWLIST);
      }
      allowlistNote = `UNAVAILABLE — falling back to all non-archived · reason: ${reason}`;
    }
  }
  const inScope = targets.length;
  if (LIMIT > 0) targets = targets.slice(0, LIMIT);

  log(`=== rescan start · repos_total=${all.length} non_archived=${nonArchived.length} targets=${targets.length} concurrency=${CONCURRENCY}`);
  log(`=== allowlist: ${allowlistNote}`);

  const started = Date.now();
  const results: RunResult[] = [];

  let cursor = 0;
  let done = 0;
  let finished = false;

  const writeState = () => {
    writeFileSync(
      STATE,
      JSON.stringify(
        {
          startedAt: new Date(started).toISOString(),
          updatedAt: new Date().toISOString(),
          finished,
          allowlist: allowlistInfo,
          inScope,
          total: targets.length,
          done,
          running: Math.min(CONCURRENCY, targets.length - done),
          elapsedSec: Math.round((Date.now() - started) / 1000),
          ok: results.filter((r) => r.status === "success").length,
          failed: results.filter((r) => r.status === "failed").length,
          skipped: results.filter((r) => r.status === "skipped").length,
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
      let res = await attempt(r);
      let attempts = 1;
      while (res.status === "failed" && attempts <= RETRY_DELAYS_MS.length && isTransient(res.error ?? "")) {
        const waitMs = RETRY_DELAYS_MS[attempts - 1];
        log(`    w${id} retry ${attempts}/${RETRY_DELAYS_MS.length} in ${waitMs / 1000}s ${r.fullName}@${r.scanBranch} — ${(res.error ?? "").replace(/\s+/g, " ").slice(0, 140)}`);
        await sleep(waitMs);
        res = await attempt(r);
        attempts++;
      }
      if (res.status === "failed" && /Remote branch .+ not found/i.test(res.error ?? "") && (await isEmptyRepo(r.owner, r.name))) {
        res = { ...res, status: "skipped", error: "Repository is empty (no commits), nothing to scan" };
      }
      results.push({ ...res, attempts });
      done++;
      log(`[${done}/${targets.length}] w${id} ${res.status.padEnd(7)} ${r.fullName}@${r.scanBranch} findings=${res.findings} crit=${res.crit} ${Math.round(res.durationMs / 1000)}s${attempts > 1 ? ` attempts=${attempts}` : ""}${res.error ? " err=" + res.error.replace(/\s+/g, " ").slice(0, 160) : ""}`);
      if (done % 5 === 0 || done === targets.length) writeState();
    }
  }

  writeState();
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, (_, i) => worker(i + 1)));
  finished = true;
  writeState();

  const ok = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const totalFindings = results.reduce((a, r) => a + r.findings, 0);
  log(`=== rescan done in ${Math.round((Date.now() - started) / 1000)}s · ok=${ok} failed=${failed} skipped=${skipped} findings=${totalFindings}`);

  if (failed || skipped) {
    log("=== not scanned:");
    for (const r of results.filter((x) => x.status !== "success")) {
      log(`    ${r.status} ${r.repo}@${r.branch} — ${(r.error || "unknown").replace(/\s+/g, " ").slice(0, 200)}`);
    }
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  log("FATAL " + (e instanceof Error ? e.stack : String(e)));
  await prisma.$disconnect();
  process.exit(1);
});
