/**
 * One-shot fan-out: scan every active (non-archived) repo for the connected
 * user. Concurrency capped to avoid GitHub clone throttling / starving local
 * CPU. Progress logged to stdout.
 */
import { prisma } from "../lib/db";
import { listRepos, resolveScanBranches, getMe } from "../lib/github";
import { readToken } from "../lib/githubVault";
import { scanRepo } from "../lib/scanRepo";

const CONCURRENCY = Number(process.env.SCAN_CONCURRENCY ?? "3");

async function pool<T, R>(items: T[], conc: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(conc, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  const email = process.env.SCAN_AS_EMAIL;
  if (!email) throw new Error("SCAN_AS_EMAIL required");
  const tok = await readToken(email);
  if (!tok) throw new Error(`No GitHub connection for ${email}`);

  const me = await getMe(tok.token);
  console.log(`User: ${me.login}`);

  const all = await listRepos(tok.token, 300);
  const active = all.filter((r) => !r.archived);
  console.log(`Active repos: ${active.length} (of ${all.length} total)`);

  const branches = await resolveScanBranches(
    tok.token,
    active.map((r) => ({ owner: r.owner.login, name: r.name, default_branch: r.default_branch })),
  );

  const t0 = Date.now();
  const results = await pool(active, CONCURRENCY, async (r, i) => {
    const branch = branches.get(r.full_name) ?? r.default_branch;
    const tStart = Date.now();
    process.stdout.write(`[${i + 1}/${active.length}] ${r.full_name}@${branch}  ...`);
    try {
      const out = await scanRepo({
        triggeredBy: email,
        owner: r.owner.login,
        name: r.name,
        branch,
        trigger: "manual",
      });
      const dt = Date.now() - tStart;
      console.log(` ${out.status} (${dt}ms, ${out.findingsTotal} findings)`);
      return out;
    } catch (e) {
      console.log(`  ERROR: ${e instanceof Error ? e.message : "unknown"}`);
      return null;
    }
  });

  const ok = results.filter((r) => r?.status === "success").length;
  const failed = results.filter((r) => r?.status === "failed").length;
  const errored = results.filter((r) => r == null).length;
  const totalFindings = results.reduce((a, r) => a + (r?.findingsTotal ?? 0), 0);
  const dt = Date.now() - t0;
  console.log(`\nDone in ${(dt / 1000).toFixed(1)}s: ${ok} success, ${failed} failed, ${errored} errored. Total findings: ${totalFindings}`);
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); }).finally(() => prisma.$disconnect());
