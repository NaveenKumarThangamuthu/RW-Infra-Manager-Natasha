#!/usr/bin/env node
/**
 * Reads secret_store, decrypts every row with INFRA_KMS_KEY, and prints
 * shell `export KEY='value'` lines to stdout. Use it from bash like:
 *
 *   eval "$(node scripts/hydrate-secrets-cli.mjs)"
 *
 * This is how cron scripts get SONAR_TOKEN, GDRIVE_REFRESH_TOKEN, etc.
 * now that they live in the DB, not .env.
 */
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const master = process.env.INFRA_KMS_KEY;
if (!master) {
  console.error("INFRA_KMS_KEY missing from env — cannot decrypt secret_store");
  process.exit(1);
}
const key = crypto.createHash("sha256").update(master, "utf8").digest();

function decrypt(ciphertext, iv, authTag) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function shellQuote(v) {
  // Wrap in single quotes and escape any embedded single quotes.
  return `'${String(v).replace(/'/g, "'\\''")}'`;
}

const prisma = new PrismaClient();
try {
  const rows = await prisma.secret.findMany();
  for (const row of rows) {
    try {
      const val = decrypt(row.ciphertext, row.iv, row.authTag);
      process.stdout.write(`export ${row.key}=${shellQuote(val)}\n`);
    } catch (e) {
      console.error(`# skip ${row.key} — decrypt failed:`, e.message);
    }
  }
} finally {
  await prisma.$disconnect();
}
