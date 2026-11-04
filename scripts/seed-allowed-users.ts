/**
 * Seed the login allowlist. Only emails in `allowed_user` may sign in via Google.
 *
 * Usage:
 *   npm run db:seed                          # seeds DEFAULT_ALLOWED below
 *   ALLOWED_EMAILS="a@x.com,b@y.com" npm run db:seed
 */
import { prisma } from "../lib/db";

const DEFAULT_ALLOWED = ["naveen@rw.team"];

async function main() {
  const fromEnv = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const emails = fromEnv.length > 0 ? fromEnv : DEFAULT_ALLOWED;

  for (const email of emails) {
    await prisma.allowedUser.upsert({
      where: { email },
      update: { active: true },
      create: { email, active: true },
    });
    console.log(`allowed: ${email}`);
  }
  console.log(`Seeded ${emails.length} allowed user(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
