/**
 * AS2 EDI certificate scanner.
 *
 * Walks the Drive folder tree at ROOT_FOLDER_ID (one subfolder per distributor),
 * downloads each .cer/.crt/.pem file, parses it with `openssl x509`, and upserts
 * the metadata into certificate_check. Private-key material (.key, .p12) is
 * intentionally never downloaded.
 *
 * Alerts to the Telegram Infra topic when a cert first crosses 30 days remaining
 * — de-duped by comparing notAfter against the previously-alerted notAfter, so
 * a re-issued cert (new expiry) can alert again but the same cert alerts once.
 */
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { prisma } from "./db";
import { sendCertificateAlert } from "./notify";

const ROOT_FOLDER_ID = "16KmX024jE8emGGZwNJntX3PRrirsLMkg";
const REFRESH_TOKEN_FILE = "/tmp/gdrive-refresh-token.txt";
const ALERT_THRESHOLD_DAYS = 30;
const CERT_EXT_RE = /\.(cer|crt|pem)$/i;

function stripQuotes(s: string | undefined): string {
  if (!s) return "";
  return s.replace(/^["']|["']$/g, "").trim();
}

async function readRefreshToken(): Promise<string | null> {
  const envTok = process.env.GDRIVE_REFRESH_TOKEN?.trim();
  if (envTok) return envTok;
  try {
    const s = (await fs.readFile(REFRESH_TOKEN_FILE, "utf8")).trim();
    return s || null;
  } catch {
    return null;
  }
}

async function mintAccessToken(refreshToken: string): Promise<string> {
  const clientId = stripQuotes(process.env.GOOGLE_INFRA_CLIENT_ID);
  const clientSecret = stripQuotes(
    process.env.GOOGLE_INFRA_CLIENT_SECRET_ID ||
      process.env.GOOGLE_INFRA_CLIENT_SECRET
  );
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const j = (await r.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!r.ok || !j.access_token) {
    throw new Error(`token refresh failed: ${j.error || r.status} ${j.error_description || ""}`);
  }
  return j.access_token;
}

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
};

async function listChildren(accessToken: string, folderId: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const fields = encodeURIComponent("files(id,name,mimeType,size,modifiedTime),nextPageToken");
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`drive list ${folderId} failed: ${r.status}`);
  const j = (await r.json()) as { files?: DriveFile[] };
  return j.files ?? [];
}

async function downloadFile(accessToken: string, fileId: string, destPath: string): Promise<void> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`drive download ${fileId} failed: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await fs.writeFile(destPath, buf);
}

type OpensslResult = {
  subject: string;
  issuer: string;
  notBefore: Date;
  notAfter: Date;
  fingerprint: string;
};

function runOpenssl(args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn("openssl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", () => {});
    p.on("close", (code) => resolve({ stdout: out, code: code ?? 1 }));
  });
}

async function parseCert(filePath: string): Promise<OpensslResult> {
  // Try PEM first; fall back to DER (Google Drive stores both flavors with .cer/.crt).
  for (const inform of ["PEM", "DER"]) {
    const args = [
      "x509",
      "-in",
      filePath,
      "-inform",
      inform,
      "-noout",
      "-subject",
      "-issuer",
      "-startdate",
      "-enddate",
      "-fingerprint",
      "-sha256",
    ];
    const r = await runOpenssl(args);
    if (r.code !== 0) continue;
    const lines = r.stdout.split("\n");
    const subject = (lines.find((l) => l.startsWith("subject=")) || "").slice(8).trim();
    const issuer = (lines.find((l) => l.startsWith("issuer=")) || "").slice(7).trim();
    const notBeforeStr = (lines.find((l) => l.startsWith("notBefore=")) || "").slice(10).trim();
    const notAfterStr = (lines.find((l) => l.startsWith("notAfter=")) || "").slice(9).trim();
    const fpLine = lines.find((l) => l.startsWith("sha256 Fingerprint=")) || "";
    const fingerprint = fpLine.slice(19).replace(/:/g, "").toLowerCase().trim();
    const notBefore = new Date(notBeforeStr);
    const notAfter = new Date(notAfterStr);
    if (!subject || !issuer || isNaN(notBefore.getTime()) || isNaN(notAfter.getTime())) {
      continue;
    }
    return { subject, issuer, notBefore, notAfter, fingerprint };
  }
  throw new Error("openssl could not parse file as PEM or DER");
}

function determineOwner(subject: string): "RW" | "PARTNER" {
  // Subject looks like: C=US, ST=Illinois, O=Restaurantware, CN=RW_GFS_AS2, ...
  const s = subject.toLowerCase();
  return s.includes("o=restaurantware") || s.includes("cn=rw_") ? "RW" : "PARTNER";
}

export type ScanSummary = {
  distributors: number;
  filesConsidered: number;
  filesParsed: number;
  filesFailed: number;
  alertsSent: number;
  durationMs: number;
};

export async function scanCertificates(opts?: { silent?: boolean }): Promise<ScanSummary> {
  const started = Date.now();
  const refreshToken = await readRefreshToken();
  if (!refreshToken) {
    throw new Error(
      "no gdrive refresh token — visit /api/gdrive/connect once to grant Drive access"
    );
  }
  const accessToken = await mintAccessToken(refreshToken);

  const distributors = (await listChildren(accessToken, ROOT_FOLDER_ID)).filter(
    (f) => f.mimeType === "application/vnd.google-apps.folder"
  );

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "certs-scan-"));

  let filesConsidered = 0;
  let filesParsed = 0;
  let filesFailed = 0;
  const alertsQueue: Array<{
    distributor: string;
    filename: string;
    owner: string;
    subject: string;
    notAfter: Date;
    daysLeft: number;
  }> = [];

  try {
    for (const dist of distributors) {
      const children = await listChildren(accessToken, dist.id);
      const certFiles = children.filter(
        (c) =>
          c.mimeType !== "application/vnd.google-apps.folder" &&
          CERT_EXT_RE.test(c.name)
      );

      for (const cf of certFiles) {
        filesConsidered++;
        const localPath = path.join(tmpRoot, `${cf.id}_${cf.name}`);
        try {
          await downloadFile(accessToken, cf.id, localPath);
          const parsed = await parseCert(localPath);
          const owner = determineOwner(parsed.subject);
          const daysLeft = Math.floor(
            (parsed.notAfter.getTime() - Date.now()) / (24 * 3600 * 1000)
          );

          const existing = await prisma.certificateCheck.findUnique({
            where: {
              distributor_filename: { distributor: dist.name, filename: cf.name },
            },
          });

          const shouldAlert =
            daysLeft <= ALERT_THRESHOLD_DAYS &&
            daysLeft >= 0 &&
            (!existing?.alertedAt ||
              !existing.notAfter ||
              existing.notAfter.getTime() !== parsed.notAfter.getTime());

          await prisma.certificateCheck.upsert({
            where: {
              distributor_filename: { distributor: dist.name, filename: cf.name },
            },
            create: {
              distributor: dist.name,
              filename: cf.name,
              driveFileId: cf.id,
              driveModifiedTime: cf.modifiedTime ? new Date(cf.modifiedTime) : null,
              owner,
              subject: parsed.subject,
              issuer: parsed.issuer,
              notBefore: parsed.notBefore,
              notAfter: parsed.notAfter,
              fingerprintSha256: parsed.fingerprint,
              parsedAt: new Date(),
              status: "success",
              alertedAt: shouldAlert ? new Date() : null,
            },
            update: {
              driveFileId: cf.id,
              driveModifiedTime: cf.modifiedTime ? new Date(cf.modifiedTime) : null,
              owner,
              subject: parsed.subject,
              issuer: parsed.issuer,
              notBefore: parsed.notBefore,
              notAfter: parsed.notAfter,
              fingerprintSha256: parsed.fingerprint,
              parsedAt: new Date(),
              status: "success",
              errorMessage: null,
              ...(shouldAlert ? { alertedAt: new Date() } : {}),
            },
          });

          if (shouldAlert) {
            alertsQueue.push({
              distributor: dist.name,
              filename: cf.name,
              owner,
              subject: parsed.subject,
              notAfter: parsed.notAfter,
              daysLeft,
            });
          }
          filesParsed++;
        } catch (e: unknown) {
          filesFailed++;
          const msg = e instanceof Error ? e.message : String(e);
          await prisma.certificateCheck.upsert({
            where: {
              distributor_filename: { distributor: dist.name, filename: cf.name },
            },
            create: {
              distributor: dist.name,
              filename: cf.name,
              driveFileId: cf.id,
              driveModifiedTime: cf.modifiedTime ? new Date(cf.modifiedTime) : null,
              owner: "PARTNER",
              subject: "",
              issuer: "",
              notBefore: new Date(0),
              notAfter: new Date(0),
              fingerprintSha256: crypto
                .createHash("sha256")
                .update(cf.id)
                .digest("hex"),
              status: "parse_failed",
              errorMessage: msg.slice(0, 500),
            },
            update: {
              driveFileId: cf.id,
              status: "parse_failed",
              errorMessage: msg.slice(0, 500),
              parsedAt: new Date(),
            },
          });
        } finally {
          fs.unlink(localPath).catch(() => {});
        }
      }
    }
  } finally {
    fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }

  let alertsSent = 0;
  if (!opts?.silent && alertsQueue.length > 0) {
    for (const a of alertsQueue) {
      const r = await sendCertificateAlert(a);
      if (r.ok) alertsSent++;
    }
  }

  return {
    distributors: distributors.length,
    filesConsidered,
    filesParsed,
    filesFailed,
    alertsSent,
    durationMs: Date.now() - started,
  };
}
