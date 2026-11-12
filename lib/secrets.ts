/**
 * Envelope-encrypted secret store.
 *
 * Design
 * ------
 * Bootstrap credentials (MYSQL_USER/PASSWORD/DATABASE_URL/NEXTAUTH_SECRET/
 * NEXTAUTH_URL/INFRA_KMS_KEY) MUST stay in .env because the app can't reach
 * the DB or decrypt anything before they're loaded. Every OTHER app secret
 * lives in the secret_store table as AES-256-GCM ciphertext.
 *
 * INFRA_KMS_KEY is the master key. It is hashed with SHA-256 to derive the
 * 256-bit AES key, so any string length in .env works.
 *
 * Rotating a secret updates the row + calls hydrateFromDb() so process.env
 * picks up the new value without a Natasha restart.
 */
import crypto from "crypto";
import { prisma } from "@/lib/db";

/** Env vars that MUST stay in .env — never move to DB. */
export const BOOTSTRAP_KEYS = new Set<string>([
  "DATABASE_URL",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "MYSQL_HOST",
  "MYSQL_PORT",
  "MYSQL_DATABASE",
  "INFRA_KMS_KEY",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  // Node runtime plumbing — not secrets
  "PATH",
  "PORT",
  "USER",
  "HOME",
  "NODE_ENV",
  "NODE_EXTRA_CA_CERTS",
  "AWS_PROFILE",
]);

/** Env vars we WANT in the DB store. Anything not in this set stays in .env. */
export const MANAGED_KEYS = new Set<string>([
  "SONAR_URL",
  "SONAR_TOKEN",
  "GDRIVE_REFRESH_TOKEN",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "ELK_URL_LAN",
  "ELK_URL_PUBLIC",
  "ELK_USER",
  "ELK_PASS",
  "PROMETHEUS_URL",
  "CRON_SECRET",
  "ELASTICSEARCH_HOST",
  "ELASTICSEARCH_PORT",
  "ELASTICSEARCH_USER",
  "ELASTICSEARCH_PASSWORD",
  "ES_SLOWLOG_INDEX",
]);

function masterKey(): Buffer {
  const raw = process.env.INFRA_KMS_KEY;
  if (!raw) throw new Error("INFRA_KMS_KEY missing from .env — cannot encrypt/decrypt secrets");
  // Derive a 32-byte key from whatever length string the operator set.
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

/** Returns { ciphertext, iv, authTag } — all base64. */
export function encrypt(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decrypt(ciphertext: string, iv: string, authTag: string): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]);
  return dec.toString("utf8");
}

/** Hydrate process.env from the DB. Called once at boot and after each rotation. */
export async function hydrateFromDb(): Promise<{ loaded: number; skipped: number }> {
  try {
    const rows = await prisma.secret.findMany();
    let loaded = 0, skipped = 0;
    for (const row of rows) {
      if (BOOTSTRAP_KEYS.has(row.key)) { skipped++; continue; }
      try {
        const value = decrypt(row.ciphertext, row.iv, row.authTag);
        process.env[row.key] = value;
        loaded++;
      } catch (e) {
        console.error("[secrets] failed to decrypt", row.key, (e as Error).message);
        skipped++;
      }
    }
    return { loaded, skipped };
  } catch (e) {
    // Table might not exist yet (fresh install). Don't crash.
    console.error("[secrets] hydrateFromDb error:", (e as Error).message);
    return { loaded: 0, skipped: 0 };
  }
}

/** Upsert a secret + refresh process.env in-place. */
export async function setSecret(key: string, value: string, updatedBy: string, description?: string): Promise<void> {
  if (BOOTSTRAP_KEYS.has(key)) throw new Error(`${key} is a bootstrap credential — must stay in .env, not DB`);
  const { ciphertext, iv, authTag } = encrypt(value);
  await prisma.secret.upsert({
    where: { key },
    update: { ciphertext, iv, authTag, description, updatedBy },
    create: { key, ciphertext, iv, authTag, description, updatedBy },
  });
  process.env[key] = value;
}

export async function deleteSecret(key: string): Promise<void> {
  await prisma.secret.delete({ where: { key } });
  delete process.env[key];
}

/** Metadata-only listing (never returns plaintext). */
export async function listSecrets(): Promise<Array<{ key: string; updatedAt: string; updatedBy: string; description: string | null; managed: boolean }>> {
  const rows = await prisma.secret.findMany({ orderBy: { key: "asc" } });
  return rows.map((r) => ({
    key: r.key,
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedBy,
    description: r.description,
    managed: MANAGED_KEYS.has(r.key),
  }));
}

/** Fetch decrypted plaintext for a specific key. Session-guarded callers only. */
export async function getSecret(key: string): Promise<string | null> {
  const row = await prisma.secret.findUnique({ where: { key } });
  if (!row) return null;
  try {
    return decrypt(row.ciphertext, row.iv, row.authTag);
  } catch {
    return null;
  }
}
