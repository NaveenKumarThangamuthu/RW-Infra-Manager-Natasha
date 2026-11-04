/**
 * Set (or reset) a user's password from the command line. Useful for the
 * initial password and as the admin "forgot password" recovery path (there is
 * no email-based reset, by design). The password is read from the environment
 * so it is never written to a file.
 *
 * Usage:
 *   USER_EMAIL=me@x.com USER_PASSWORD=... npm run set:password
 *
 * Creates the user (active) if missing, otherwise updates the hash.
 */
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db";

async function main() {
  const email = (process.env.USER_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.USER_PASSWORD ?? "";

  if (!email || !password) {
    console.error("USER_EMAIL and USER_PASSWORD env vars are required.");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.allowedUser.upsert({
    where: { email },
    update: { passwordHash, active: true },
    create: { email, passwordHash, active: true },
  });
  console.log(`Password set for ${email}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
