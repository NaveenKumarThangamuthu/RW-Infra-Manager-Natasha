/**
 * Machine endpoint hit by the system crontab twice a day (09:00 & 15:00 IST).
 * Protected by a Bearer CRON_SECRET (NOT Google auth — it runs headless).
 *
 *   POST /api/refresh?label=09:00
 *   Authorization: Bearer <CRON_SECRET>
 */
import { NextResponse } from "next/server";
import { runSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const label = new URL(req.url).searchParams.get("label") ?? "manual";
  try {
    const result = await runSnapshot(label);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Refresh failed" },
      { status: 500 },
    );
  }
}
