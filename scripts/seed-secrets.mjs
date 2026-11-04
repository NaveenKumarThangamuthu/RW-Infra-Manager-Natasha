#!/usr/bin/env node
/**
 * One-shot: for every MANAGED_KEY currently in process.env (loaded from .env),
 * write an encrypted row into secret_store. Idempotent — running again just
 * updates the ciphertext with a fresh IV.
 *
 * Bootstrap keys stay in .env forever.
 */
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const MANAGED_KEYS = [
  "SONAR_URL", "SONAR_TOKEN",
  "GDRIVE_REFRESH_TOKEN",
  "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
  "GTMETRIX_API_KEY", "GOOGLE_PSI_API_KEY",
  "ELK_URL_LAN", "ELK_URL_PUBLIC", "ELK_USER", "ELK_PASS",
  "PROMETHEUS_URL", "CRON_SECRET",
];

const master = process.env.INFRA_KMS_KEY;
if (!master) { console.error("INFRA_KMS_KEY missing from env"); process.exit(1); }
const key = crypto.createHash("sha256").update(master, "utf8").digest();

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

const prisma = new PrismaClient();
let seeded = 0, missing = 0;
for (const k of MANAGED_KEYS) {
  const val = process.env[k];
  if (!val) { missing++; console.log(`skip ${k} (not in env)`); continue; }
  const { ciphertext, iv, authTag } = encrypt(val);
  await prisma.secret.upsert({
    where: { key: k },
    update: { ciphertext, iv, authTag, updatedBy: "seed-script" },
    create: { key: k, ciphertext, iv, authTag, updatedBy: "seed-script", description: `Seeded from .env on ${new Date().toISOString().slice(0,10)}` },
  });
  seeded++;
  console.log(`seed ${k}`);
}
console.log(`\ndone: ${seeded} seeded · ${missing} missing`);
await prisma.$disconnect();
