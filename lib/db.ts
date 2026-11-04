/**
 * Prisma client singleton. Next.js dev hot-reloads modules, which would
 * otherwise create a new PrismaClient (and a new MySQL connection pool) on
 * every reload — so we cache it on globalThis in non-production.
 *
 * Connection string resolution order:
 *   1. DATABASE_URL (if explicitly set)
 *   2. Built from MYSQL_USER / MYSQL_PASSWORD / MYSQL_HOST / MYSQL_PORT /
 *      MYSQL_DATABASE (these live in /etc/environment on this host).
 * The password is URL-encoded so special characters (e.g. '#') are safe.
 */
import { PrismaClient } from "@prisma/client";

export function resolveDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const user = process.env.MYSQL_USER;
  if (!user) {
    return undefined;
  }
  const pass = process.env.MYSQL_PASSWORD ?? "";
  const host = process.env.MYSQL_HOST ?? "localhost";
  const port = process.env.MYSQL_PORT ?? "3306";
  const db = process.env.MYSQL_DATABASE ?? "billing";
  const auth = pass
    ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}`
    : encodeURIComponent(user);
  return `mysql://${auth}@${host}:${port}/${db}`;
}

const url = resolveDatabaseUrl();

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; secretsHydration?: Promise<void> };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    ...(url ? { datasources: { db: { url } } } : {}),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Lazy one-time hydration of process.env from the encrypted secret_store table.
 * Cached on globalThis so it runs at most once per Node process. Any route
 * that needs a secret should `await ensureSecretsHydrated()` at the top —
 * cheap after the first call because it returns the cached promise.
 */
export function ensureSecretsHydrated(): Promise<void> {
  if (!globalForPrisma.secretsHydration) {
    globalForPrisma.secretsHydration = (async () => {
      try {
        const [{ hydrateFromDb }] = await Promise.all([import("./secrets")]);
        const { loaded, skipped } = await hydrateFromDb();
        if (loaded > 0) console.log(`[secrets] hydrated ${loaded} from DB (skipped ${skipped})`);
      } catch (e) {
        console.error("[secrets] hydration failed:", (e as Error).message);
      }
    })();
  }
  return globalForPrisma.secretsHydration;
}

// Fire-and-forget on module load so the hydration is well underway before the
// first request that needs a secret arrives.
void ensureSecretsHydrated();
