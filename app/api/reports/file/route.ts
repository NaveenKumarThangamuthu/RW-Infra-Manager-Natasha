import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CONTENT_TYPE, REPORTS_DIR, findReportFile, type ReportKind } from "@/lib/reports";

export const dynamic = "force-dynamic";

const FRAME = "frame-ancestors 'self'";

function csp(kind: ReportKind): string {
  return kind === "html" ? `sandbox allow-scripts allow-popups; ${FRAME}` : FRAME;
}

function disposition(name: string, download: boolean): string {
  const plain = name.replace(/"/g, "");
  return `${download ? "attachment" : "inline"}; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  let res: NextResponse;
  if (!session?.user?.email) {
    res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } else {
    try {
      const entry = await findReportFile(req.nextUrl.searchParams.get("name") ?? "");
      if (!entry) {
        res = NextResponse.json({ error: "Report not found." }, { status: 404 });
      } else {
        const buffer = await fs.promises.readFile(path.join(REPORTS_DIR, entry.name));
        res = new NextResponse(buffer, {
          headers: {
            "Content-Type": CONTENT_TYPE[entry.kind],
            "Content-Length": String(buffer.length),
            "Content-Disposition": disposition(entry.name, req.nextUrl.searchParams.get("download") === "1"),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": csp(entry.kind),
          },
        });
      }
    } catch (e) {
      console.error("reports: read failed", e);
      res = NextResponse.json({ error: "Could not read the report." }, { status: 500 });
    }
  }
  return res;
}
