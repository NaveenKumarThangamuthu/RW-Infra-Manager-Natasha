/**
 * POST /api/security/scan
 *   body: { owner, name, branch }
 *
 * Triggers a synchronous scan of one repository. Returns scan job ID + summary.
 * Synchronous keeps the MVP simple — long-running scans should move to a
 * job queue (Spring Boot ScanJobScheduler) once the backend is online.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { scanRepo } from "@/lib/scanRepo";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — Trivy DBs + clone + scan

function isSafeName(s: string): boolean {
  return /^[A-Za-z0-9_.-]{1,128}$/.test(s);
}
function isSafeBranch(s: string): boolean {
  return /^[A-Za-z0-9_./-]{1,128}$/.test(s) && !s.includes("..");
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { owner?: string; name?: string; branch?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { owner, name, branch } = body;
  if (!owner || !name || !branch) return NextResponse.json({ error: "owner, name, branch required" }, { status: 400 });
  if (!isSafeName(owner) || !isSafeName(name)) return NextResponse.json({ error: "Invalid owner/name" }, { status: 400 });
  if (!isSafeBranch(branch)) return NextResponse.json({ error: "Invalid branch" }, { status: 400 });

  const result = await scanRepo({ triggeredBy: email, owner, name, branch, trigger: "manual" });
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 500 });
}
