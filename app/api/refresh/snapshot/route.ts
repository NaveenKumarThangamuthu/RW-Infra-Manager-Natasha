/**
 * Manual refresh endpoint. Pages serve from the latest cached snapshot;
 * users click a "Refresh" button → POST here → fetch live + persist.
 *
 * Body:  { source: "spring-health" | "spring-logs" | "ec2-health" |
 *           "cloudwatch-alarms" | "prom-alerts" | "all" }
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ALL_SOURCES, saveSnapshot, saveFailure, pruneOld, type LiveSource } from "@/lib/dataSnapshot";
import {
  fetchSpringHealth,
  fetchSpringLogs,
  fetchEc2Health,
  fetchEc2Volumes,
  fetchCloudWatchAlarms,
  fetchPromAlerts,
  fetchRecommendations,
  fetchLambdaOhio,
} from "@/lib/snapshotFetchers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FETCHERS: Record<LiveSource, () => Promise<{ payload: unknown; via: string | null; fetchMs: number }>> = {
  "spring-health": fetchSpringHealth,
  "spring-logs": fetchSpringLogs,
  "ec2-health": fetchEc2Health,
  "ec2-volumes": fetchEc2Volumes,
  "cloudwatch-alarms": fetchCloudWatchAlarms,
  "prom-alerts": fetchPromAlerts,
  "recommendations": fetchRecommendations,
  "lambda-ohio": fetchLambdaOhio,
};

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = session.user.email;

  const body = await req.json().catch(() => ({}));
  const requested: string = body?.source ?? "all";
  const targets: LiveSource[] = requested === "all" ? ALL_SOURCES : ALL_SOURCES.includes(requested as LiveSource) ? [requested as LiveSource] : [];
  if (targets.length === 0) {
    return NextResponse.json({ error: `Unknown source: ${requested}` }, { status: 400 });
  }

  const results = await Promise.all(targets.map(async (src) => {
    try {
      const { payload, via, fetchMs } = await FETCHERS[src]();
      const meta = await saveSnapshot(src, payload, { via, fetchMs, refreshedBy: email });
      await pruneOld(src);
      return { source: src, ok: true, fetchMs, via, capturedAt: meta.capturedAt };
    } catch (err) {
      await saveFailure(src, err, email);
      return { source: src, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }));

  const failedCount = results.filter((r) => !r.ok).length;
  return NextResponse.json({ ok: failedCount === 0, refreshedBy: email, results }, { status: failedCount === results.length ? 502 : 200 });
}
