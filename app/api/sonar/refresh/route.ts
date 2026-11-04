import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

let running = false;

interface RefreshResult {
  ok: boolean;
  ranMs: number;
  scriptExit: number;
  reportDate?: string;
  productionPdf?: string;
  productionHtml?: string;
  logTail?: string;
  error?: string;
}

function tailLog(): string {
  try {
    const p = path.resolve(process.cwd(), "logs/sonar-refresh.log");
    if (!fs.existsSync(p)) return "";
    const buf = fs.readFileSync(p, "utf8");
    return buf.split("\n").slice(-40).join("\n");
  } catch {
    return "";
  }
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (running) {
    return NextResponse.json<RefreshResult>({ ok: false, ranMs: 0, scriptExit: -1, error: "A refresh is already in progress. Wait for it to finish." }, { status: 409 });
  }
  running = true;

  const started = Date.now();
  const script = path.resolve(process.cwd(), "scripts/refresh-sonar-report.sh");

  try {
    const exitCode: number = await new Promise((resolve, reject) => {
      const child = spawn("bash", [script], {
        cwd: process.cwd(),
        env: { ...process.env, PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Refresh timed out after 240s"));
      }, 240_000);
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => { clearTimeout(timer); resolve(code ?? -1); });
    });

    // Read the freshly-written status file.
    const statusPath = path.resolve(process.cwd(), "public/sonar-reports/latest-status.json");
    let statusOut: Partial<RefreshResult> = {};
    if (fs.existsSync(statusPath)) {
      const s = JSON.parse(fs.readFileSync(statusPath, "utf8"));
      statusOut = {
        reportDate: s.date,
        productionPdf: s.productionPdf,
        productionHtml: s.productionHtml,
      };
    }

    return NextResponse.json<RefreshResult>({
      ok: exitCode === 0,
      ranMs: Date.now() - started,
      scriptExit: exitCode,
      logTail: tailLog(),
      ...statusOut,
    });
  } catch (e) {
    return NextResponse.json<RefreshResult>({
      ok: false,
      ranMs: Date.now() - started,
      scriptExit: -1,
      error: (e as Error).message,
      logTail: tailLog(),
    }, { status: 500 });
  } finally {
    running = false;
  }
}
