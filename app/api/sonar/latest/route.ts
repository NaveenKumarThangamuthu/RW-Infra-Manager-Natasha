import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

interface LatestStatus {
  date: string;
  generatedAt: string;
  indexHtml: string;
  productionHtml: string;
  productionPdf: string;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const statusPath = path.resolve(process.cwd(), "public/sonar-reports/latest-status.json");
  if (!fs.existsSync(statusPath)) {
    return NextResponse.json({ ok: false, hasReport: false });
  }
  const raw = fs.readFileSync(statusPath, "utf8");
  const status = JSON.parse(raw) as LatestStatus;

  // Verify the actual files still exist.
  const files: Array<[string, string]> = [
    ["indexHtml", status.indexHtml],
    ["productionHtml", status.productionHtml],
    ["productionPdf", status.productionPdf],
  ];
  const exists: Record<string, boolean> = {};
  for (const [key, rel] of files) {
    exists[key] = fs.existsSync(path.resolve(process.cwd(), "public" + rel));
  }

  return NextResponse.json({ ok: true, hasReport: true, ...status, exists });
}
