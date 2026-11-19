import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listReports } from "@/lib/reports";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  let res: NextResponse;
  if (!session?.user?.email) {
    res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } else {
    try {
      const reports = await listReports();
      res = NextResponse.json({ ok: true, reports }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      console.error("reports: list failed", e);
      res = NextResponse.json({ error: "Could not read the reports folder." }, { status: 500 });
    }
  }
  return res;
}
