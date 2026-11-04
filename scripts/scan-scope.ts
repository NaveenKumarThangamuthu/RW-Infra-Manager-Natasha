/** Print the exact repo set a bulk scan would target, and their branches. */
import { prisma } from "../lib/db";
import { getRepoAllowlist, isRepoAllowed } from "../lib/sheetAllowlist";

async function main() {
  const all = await prisma.repo.findMany();
  const nonArchived = all.filter((r) => !r.archived);
  const allowlist = await getRepoAllowlist().catch(() => null);
  const targets = allowlist?.repos
    ? nonArchived.filter((r) => isRepoAllowed(allowlist.repos, r.fullName))
    : nonArchived;

  console.log("repos total      :", all.length);
  console.log("non-archived     :", nonArchived.length);
  console.log("allowlist entries:", allowlist?.count, "source:", allowlist?.source, "err:", allowlist?.error ?? "none");
  console.log("TARGETS          :", targets.length);
  const b: Record<string, number> = {};
  targets.forEach((r) => (b[r.scanBranch] = (b[r.scanBranch] || 0) + 1));
  console.log("branches         :", JSON.stringify(b));
  await prisma.$disconnect();
}
main();
