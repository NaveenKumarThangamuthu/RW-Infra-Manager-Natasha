import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type CertRow = {
  id: number;
  distributor: string;
  filename: string;
  driveFileId: string;
  owner: string;
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  fingerprintSha256: string;
  parsedAt: string;
  daysLeft: number;
  status: string;
  errorMessage: string | null;
  severity: "expired" | "crit" | "warn" | "healthy" | "unknown";
};

function severityFor(daysLeft: number, status: string): CertRow["severity"] {
  if (status !== "success") return "unknown";
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 30) return "crit";
  if (daysLeft <= 90) return "warn";
  return "healthy";
}

export async function GET() {
  const rows = await prisma.certificateCheck.findMany({
    orderBy: [{ distributor: "asc" }, { filename: "asc" }],
  });

  const now = Date.now();
  const items: CertRow[] = rows.map((r) => {
    const daysLeft = Math.floor((r.notAfter.getTime() - now) / (24 * 3600 * 1000));
    return {
      id: r.id,
      distributor: r.distributor,
      filename: r.filename,
      driveFileId: r.driveFileId,
      owner: r.owner,
      subject: r.subject,
      issuer: r.issuer,
      notBefore: r.notBefore.toISOString(),
      notAfter: r.notAfter.toISOString(),
      fingerprintSha256: r.fingerprintSha256,
      parsedAt: r.parsedAt.toISOString(),
      status: r.status,
      errorMessage: r.errorMessage,
      daysLeft,
      severity: severityFor(daysLeft, r.status),
    };
  });

  const kpis = {
    total: items.length,
    expired: items.filter((i) => i.severity === "expired").length,
    crit: items.filter((i) => i.severity === "crit").length,
    warn: items.filter((i) => i.severity === "warn").length,
    healthy: items.filter((i) => i.severity === "healthy").length,
    unknown: items.filter((i) => i.severity === "unknown").length,
    lastScan: items.reduce<string | null>(
      (acc, r) => (!acc || r.parsedAt > acc ? r.parsedAt : acc),
      null
    ),
  };

  const byDistributor: Record<string, CertRow[]> = {};
  for (const it of items) {
    (byDistributor[it.distributor] ||= []).push(it);
  }

  return NextResponse.json({ kpis, items, byDistributor });
}
