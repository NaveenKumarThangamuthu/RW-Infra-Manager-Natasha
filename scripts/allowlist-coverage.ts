/** Which Google-Sheet allowlist entries never made it into a scan, and why. */
import { prisma } from "../lib/db";
import { getRepoAllowlist, isRepoAllowed } from "../lib/sheetAllowlist";

async function main() {
  const allowlist = await getRepoAllowlist();
  if (!allowlist?.repos) throw new Error("allowlist unavailable");
  const all = await prisma.repo.findMany();
  const byName = new Map(all.map((r) => [r.fullName.toLowerCase(), r]));

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const scanned = new Set(
    (await prisma.scanJob.findMany({ where: { startedAt: { gte: since }, status: "success" } })).map((j) =>
      j.repoFullName.toLowerCase(),
    ),
  );

  console.log(`allowlist entries: ${allowlist.count}`);
  const notScanned: string[] = [];
  for (const entry of allowlist.repos) {
    const repo = byName.get(String(entry).toLowerCase());
    const key = String(entry).toLowerCase();
    if (scanned.has(key)) continue;
    if (!repo) notScanned.push(`${entry} — NOT in repo table (GitHub sync never returned it: no access, renamed, or deleted)`);
    else if (repo.archived) notScanned.push(`${entry} — archived on GitHub, intentionally out of scope`);
    else notScanned.push(`${entry} — in scope but no successful scan today`);
  }
  console.log(`allowlist entries without a successful scan today: ${notScanned.length}`);
  notScanned.forEach((s) => console.log("   " + s));

  // Repos scanned that the allowlist covers.
  const covered = [...allowlist.repos].filter((e) => scanned.has(String(e).toLowerCase())).length;
  console.log(`\nallowlist entries scanned OK today: ${covered}`);
  await prisma.$disconnect();
}
main();
