/**
 * On-demand CloudWatch Logs for a Lambda function (Ohio region).
 * Live call — runs only when a user expands a row.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchLambdaLogs } from "@/lib/lambdaOhio";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const fn = url.searchParams.get("function");
  const hours = Math.min(parseInt(url.searchParams.get("hours") ?? "1", 10) || 1, 24);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  if (!fn) return NextResponse.json({ error: "Missing function" }, { status: 400 });

  try {
    const events = await fetchLambdaLogs(fn, limit, hours);
    return NextResponse.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      function: fn,
      hours,
      count: events.length,
      events,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
