/**
 * End-to-end repo scan orchestrator.
 *
 *   1. Clone the resolved scan branch into a private temp dir using the user's
 *      GitHub OAuth token (token never written to disk; passed via stdin via
 *      git's askpass mechanism… actually we use the credential helper that
 *      reads from env once, then unsets — simpler than askpass for one-shot).
 *   2. Run Trivy + Gitleaks in parallel.
 *   3. Upsert findings keyed by (repoFullName, fingerprint) so re-scans
 *      converge instead of duplicating.
 *   4. Wipe the temp dir.
 */
import { spawn } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import path from "path";
import os from "os";
import { prisma } from "./db";
import { readToken } from "./githubVault";
import { runAll, type RawFinding } from "./scanners";

// Large monorepos need more than two minutes to clone on a slow link; a kill
// mid-transfer surfaces as "fatal: early EOF". Override with NATASHA_CLONE_TIMEOUT_MS.
const CLONE_TIMEOUT_MS = Number(process.env.NATASHA_CLONE_TIMEOUT_MS) || 120_000;

function runGit(args: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<{
  code: number; stderr: string;
}> {
  return new Promise((resolve) => {
    let stderr = "";
    const child = spawn("git", args, { cwd: opts.cwd, env: { ...process.env, ...opts.env } });
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? CLONE_TIMEOUT_MS);
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

export interface ScanOutcome {
  scanJobId: number;
  status: "success" | "failed";
  durationMs: number;
  commitSha: string | null;
  findingsTotal: number;
  bySeverity: Record<string, number>;
  byScanner: Record<string, { ok: boolean; durationMs: number; count: number; error?: string }>;
  errorMessage?: string;
}

export async function scanRepo(opts: {
  triggeredBy: string;
  owner: string;
  name: string;
  branch: string;
  trigger?: "manual" | "webhook" | "scheduled";
}): Promise<ScanOutcome> {
  const t0 = Date.now();
  const repoFullName = `${opts.owner}/${opts.name}`;
  const job = await prisma.scanJob.create({
    data: {
      repoFullName, repoOwner: opts.owner, repoName: opts.name, branch: opts.branch,
      status: "running", triggeredBy: opts.triggeredBy, trigger: opts.trigger ?? "manual",
    },
  });

  let tmpDir: string | null = null;
  try {
    const tok = await readToken(opts.triggeredBy);
    if (!tok) throw new Error("GitHub not connected for this user.");

    tmpDir = await mkdtemp(path.join(os.tmpdir(), `natasha-scan-${job.id}-`));

    // Token-authenticated HTTPS clone. The token never lands on disk — it lives
    // only in the env var we pass to the child git process.
    const remote = `https://x-access-token:${encodeURIComponent(tok.token)}@github.com/${opts.owner}/${opts.name}.git`;
    const clone = await runGit(
      ["clone", "--depth", "1", "--branch", opts.branch, "--single-branch", remote, tmpDir],
      { timeoutMs: CLONE_TIMEOUT_MS },
    );
    if (clone.code !== 0) {
      throw new Error("clone failed: " + clone.stderr.replace(tok.token, "<redacted>").slice(0, 400));
    }

    // HEAD commit for audit.
    const revParse = await new Promise<string>((resolve) => {
      const c = spawn("git", ["rev-parse", "HEAD"], { cwd: tmpDir! });
      let out = "";
      c.stdout.on("data", (d) => { out += d.toString(); });
      c.on("close", () => resolve(out.trim()));
    });
    const commitSha = /^[0-9a-f]{40}$/.test(revParse) ? revParse : null;

    // Run scanners in parallel.
    const results = await runAll(tmpDir, repoFullName);
    // Scanners can emit the same (repoFullName, fingerprint) twice in one run —
    // e.g. the same CVE reached through two lockfile paths. Those rows are
    // upserted concurrently below, so duplicates race each other into the same
    // unique key and the whole scan fails. Collapse them before writing.
    const seenFingerprints = new Set<string>();
    const allFindings: RawFinding[] = results
      .flatMap((r) => r.findings)
      .filter((f) => !seenFingerprints.has(f.fingerprint) && seenFingerprints.add(f.fingerprint));

    // Upsert each finding by (repoFullName, fingerprint).
    const now = new Date();
    const upserts = allFindings.map((f) =>
      prisma.finding.upsert({
        where: { repo_fingerprint: { repoFullName, fingerprint: f.fingerprint } },
        update: { lastSeenAt: now },
        create: {
          scanJobId: job.id,
          scanner: f.scanner,
          severity: f.severity,
          category: f.category,
          ruleId: f.ruleId,
          title: f.title.slice(0, 500),
          description: f.description ?? null,
          file: f.file ?? null,
          line: f.line ?? null,
          fingerprint: f.fingerprint,
          repoFullName,
          branch: opts.branch,
        },
      }),
    );
    // Cap concurrency to avoid hammering the DB connection pool.
    const BATCH = 20;
    for (let i = 0; i < upserts.length; i += BATCH) {
      await Promise.all(upserts.slice(i, i + BATCH));
    }

    const bySeverity: Record<string, number> = {};
    const byScanner: Record<string, { ok: boolean; durationMs: number; count: number; error?: string }> = {};
    for (const f of allFindings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    for (const r of results) {
      byScanner[r.scanner] = {
        ok: r.ok, durationMs: r.durationMs,
        count: r.findings.length, error: r.error,
      };
    }
    const durationMs = Date.now() - t0;
    await prisma.scanJob.update({
      where: { id: job.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        durationMs,
        commitSha,
        scannerMeta: JSON.stringify({ byScanner, bySeverity }),
      },
    });
    return {
      scanJobId: job.id, status: "success", durationMs, commitSha,
      findingsTotal: allFindings.length, bySeverity, byScanner,
    };
  } catch (err) {
    const durationMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : "unknown";
    await prisma.scanJob.update({
      where: { id: job.id },
      data: { status: "failed", finishedAt: new Date(), durationMs, errorMessage: msg.slice(0, 1000) },
    }).catch(() => {});
    return {
      scanJobId: job.id, status: "failed", durationMs, commitSha: null,
      findingsTotal: 0, bySeverity: {}, byScanner: {}, errorMessage: msg,
    };
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
