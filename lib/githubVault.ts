/**
 * Encrypted-at-rest GitHub OAuth token vault.
 *
 * AES-256-GCM with a key sourced from INFRA_KMS_KEY (base64). Each row stores
 * the IV + GCM tag + ciphertext as separate binary columns; the plaintext
 * token only exists transiently in process memory during encrypt/decrypt.
 *
 * Public API:
 *   - storeToken(email, token, login, scopes)  — encrypt + upsert
 *   - readToken(email)                          — decrypt + touch lastUsedAt
 *   - revokeConnection(email)                   — mark revoked, scrub blobs
 *   - listConnections()                         — operator view (no plaintext)
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import { prisma } from "./db";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function loadKey(): Buffer {
  const b64 = process.env.INFRA_KMS_KEY;
  if (!b64) {
    throw new Error("INFRA_KMS_KEY missing. Generate with: openssl rand -base64 32");
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`INFRA_KMS_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`);
  }
  return key;
}

interface EncryptedBlob {
  iv: Buffer;
  authTag: Buffer;
  cipher: Buffer;
}

function encrypt(plaintext: string): EncryptedBlob {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv(ALGO, key, iv);
  const cipher = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  const authTag = c.getAuthTag();
  if (authTag.length !== TAG_BYTES) {
    throw new Error("GCM tag length mismatch");
  }
  return { iv, authTag, cipher };
}

function decrypt(blob: EncryptedBlob): string {
  const key = loadKey();
  const d = createDecipheriv(ALGO, key, blob.iv);
  d.setAuthTag(blob.authTag);
  const plain = Buffer.concat([d.update(blob.cipher), d.final()]);
  return plain.toString("utf8");
}

function fingerprint(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface StoredConnection {
  userEmail: string;
  githubLogin: string | null;
  scopes: string | null;
  tokenPrefix: string | null;
  connectedAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export async function storeToken(
  userEmail: string,
  token: string,
  login: string | null,
  scopes: string | null,
): Promise<void> {
  if (!userEmail) throw new Error("userEmail required");
  if (!token || typeof token !== "string") throw new Error("token required");
  const { iv, authTag, cipher } = encrypt(token);
  const tokenHash = fingerprint(token);
  const tokenPrefix = token.slice(0, 4);

  await prisma.githubConnection.upsert({
    where: { userEmail },
    update: {
      githubLogin: login,
      cipher,
      iv,
      authTag,
      scopes,
      tokenHash,
      tokenPrefix,
      revokedAt: null,
      connectedAt: new Date(),
      lastUsedAt: null,
    },
    create: {
      userEmail,
      githubLogin: login,
      cipher,
      iv,
      authTag,
      scopes,
      tokenHash,
      tokenPrefix,
    },
  });
}

export async function readToken(userEmail: string): Promise<{
  token: string;
  login: string | null;
  scopes: string | null;
} | null> {
  if (!userEmail) return null;
  const row = await prisma.githubConnection.findUnique({ where: { userEmail } });
  if (!row || row.revokedAt) return null;
  const token = decrypt({ iv: row.iv, authTag: row.authTag, cipher: row.cipher });
  // touch lastUsedAt (fire-and-forget; failure to update must not break the call)
  prisma.githubConnection.update({
    where: { userEmail },
    data: { lastUsedAt: new Date() },
  }).catch(() => { /* non-fatal */ });
  return { token, login: row.githubLogin, scopes: row.scopes };
}

export async function revokeConnection(userEmail: string): Promise<{
  revokedAtGithub: boolean;
  githubError?: string;
}> {
  if (!userEmail) return { revokedAtGithub: false };

  // 1. Pull the plaintext one last time so we can revoke at GitHub.
  let plaintext: string | null = null;
  try {
    const row = await prisma.githubConnection.findUnique({ where: { userEmail } });
    if (row && !row.revokedAt && row.cipher.length > 0) {
      plaintext = decrypt({ iv: row.iv, authTag: row.authTag, cipher: row.cipher });
    }
  } catch { /* if decrypt fails, still proceed with local scrub */ }

  // 2. Tell GitHub to drop the entire OAuth grant for this app+user.
  //    This forces the consent screen on next connect (no silent re-auth).
  let revokedAtGithub = false;
  let githubError: string | undefined;
  if (plaintext && process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    try {
      const basic = Buffer.from(
        `${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`,
      ).toString("base64");
      const res = await fetch(
        `https://api.github.com/applications/${process.env.GITHUB_CLIENT_ID}/grant`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Basic ${basic}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "natasha-dashboard/1.0",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: plaintext }),
          signal: AbortSignal.timeout(8_000),
        },
      );
      // 204 = revoked, 404 = grant didn't exist (already revoked elsewhere — fine).
      revokedAtGithub = res.status === 204 || res.status === 404;
      if (!revokedAtGithub) githubError = `github ${res.status}`;
    } catch (err) {
      githubError = err instanceof Error ? err.message : "network";
    }
  }

  // 3. Hard-delete the row. The audit trail lives in audit_log (Sprint 1+);
  //    keeping a tombstone row here would only confuse future operators.
  await prisma.githubConnection.deleteMany({ where: { userEmail } });

  return { revokedAtGithub, githubError };
}

export async function getConnectionInfo(userEmail: string): Promise<StoredConnection | null> {
  if (!userEmail) return null;
  const row = await prisma.githubConnection.findUnique({ where: { userEmail } });
  if (!row) return null;
  return {
    userEmail: row.userEmail,
    githubLogin: row.githubLogin,
    scopes: row.scopes,
    tokenPrefix: row.tokenPrefix,
    connectedAt: row.connectedAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}
