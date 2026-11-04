/**
 * Verify that today's scans actually captured each repo's latest commit.
 *
 * For every successful scan job from today, compare the commit SHA recorded at
 * clone time against the branch HEAD GitHub reports right now. A mismatch means
 * someone pushed after the scan ran (or the scan used a stale branch).
 */
import { prisma } from "../lib/db";
import { readToken } from "../lib/githubVault";

const USER = process.env.NATASHA_SCAN_USER || "naveen@rw.team";

async function main() {
  const tok = await readToken(USER);
  if (!tok) throw new Error("no GitHub token for " + USER);

  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const jobs = await prisma.scanJob.findMany({
    where: { startedAt: { gte: since } },
    orderBy: { startedAt: "desc" },
  });
  // Keep only the most recent job per repo.
  const latest = new Map<string, (typeof jobs)[number]>();
  for (const j of jobs) if (!latest.has(j.repoFullName)) latest.set(j.repoFullName, j);

  const rows = [...latest.values()];
  console.log(`today's scan jobs: ${jobs.length}, distinct repos: ${rows.length}`);

  let current = 0, behind = 0, failed = 0, unknown = 0;
  const drift: string[] = [];
  const problems: string[] = [];

  const CONC = 8;
  let i = 0;
  async function worker() {
    for (;;) {
      const n = i++;
      if (n >= rows.length) return;
      const j = rows[n];
      if (j.status !== "success") {
        failed++;
        problems.push(`${j.repoFullName}@${j.branch} — scan status=${j.status}`);
        continue;
      }
      const url = `https://api.github.com/repos/${j.repoFullName}/commits/${encodeURIComponent(j.branch)}`;
      try {
        const r = await fetch(url, {
          headers: { Authorization: `Bearer ${tok!.token}`, Accept: "application/vnd.github+json" },
        });
        if (!r.ok) {
          unknown++;
          problems.push(`${j.repoFullName}@${j.branch} — GitHub ${r.status}`);
          continue;
        }
        const head = (await r.json()).sha as string;
        if (j.commitSha && head.startsWith(j.commitSha.slice(0, 7))) {
          current++;
        } else {
          behind++;
          drift.push(`${j.repoFullName}@${j.branch} scanned=${(j.commitSha || "?").slice(0, 7)} head=${head.slice(0, 7)}`);
        }
      } catch (e) {
        unknown++;
        problems.push(`${j.repoFullName}@${j.branch} — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  console.log(`\nup-to-date (scanned commit == current HEAD): ${current}`);
  console.log(`behind (new commits pushed since scan)     : ${behind}`);
  console.log(`scan failed                                 : ${failed}`);
  console.log(`could not verify                            : ${unknown}`);
  if (drift.length) {
    console.log("\n--- repos with newer commits than the scan ---");
    drift.forEach((d) => console.log("   " + d));
  }
  if (problems.length) {
    console.log("\n--- problems ---");
    problems.forEach((p) => console.log("   " + p));
  }
  await prisma.$disconnect();
}
main();
