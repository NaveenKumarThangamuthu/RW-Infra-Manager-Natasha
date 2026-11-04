/**
 * Remove ephemeral e2e test users created by the Playwright run.
 * Deletes any AllowedUser row whose email starts with "e2e-test-".
 * Safe to run at any time — no-op if none exist.
 */
import { prisma } from "../lib/db";

async function main() {
  const removed = await prisma.allowedUser.deleteMany({
    where: { email: { startsWith: "e2e-test-" } },
  });
  console.log(`Removed ${removed.count} ephemeral e2e user(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
