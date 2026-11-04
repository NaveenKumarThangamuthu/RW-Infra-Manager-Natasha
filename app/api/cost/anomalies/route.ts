/**
 * Cost anomaly feed for the home dashboard.
 *
 * Reads `ResourceDailyCost` rows, computes a 14-day median + MAD baseline per
 * (service, resourceId), and surfaces resources whose latest-day cost is at
 * least `Z_THRESHOLD` MAD-standard-deviations above the baseline AND adds at
 * least `$MIN_DOLLARS` of incremental spend. Returns the top N outliers.
 *
 * MAD-based z-score is more robust than mean+stdev when a series has a single
 * spike — exactly the case where we want to flag.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const Z_THRESHOLD = 2.5;
const MIN_DOLLARS = 1.0;
const BASELINE_DAYS = 14;
const TOP_N = 8;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mad(xs: number[], med: number): number {
  if (xs.length === 0) return 0;
  const dev = xs.map((x) => Math.abs(x - med));
  return median(dev);
}

interface Anomaly {
  service: "EC2" | "LAMBDA" | "SNS" | string;
  resourceId: string;
  latestDate: string;
  latestAmount: number;
  baselineMedian: number;
  spikeUsd: number;
  zScore: number;
  baselineDays: number;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const since = new Date(Date.now() - (BASELINE_DAYS + 1) * 86_400_000);
  const sinceKey = since.toISOString().slice(0, 10);

  const rows = await prisma.resourceDailyCost.findMany({
    where: { date: { gte: sinceKey } },
    orderBy: [{ service: "asc" }, { resourceId: "asc" }, { date: "asc" }],
  });

  const grouped = new Map<string, { service: string; resourceId: string; series: Array<{ date: string; amount: number }> }>();
  for (const r of rows) {
    const k = `${r.service}|${r.resourceId}`;
    if (!grouped.has(k)) grouped.set(k, { service: r.service, resourceId: r.resourceId, series: [] });
    grouped.get(k)!.series.push({ date: r.date, amount: Number(r.amount) });
  }

  const anomalies: Anomaly[] = [];
  for (const { service, resourceId, series } of grouped.values()) {
    if (series.length < 4) continue;
    const last = series[series.length - 1];
    const baseline = series.slice(0, -1).map((p) => p.amount);
    const med = median(baseline);
    const m = mad(baseline, med);
    // sigma ≈ 1.4826 * MAD; guard against 0-MAD with a small floor
    const sigma = Math.max(m * 1.4826, 0.05);
    const z = (last.amount - med) / sigma;
    const spike = last.amount - med;
    if (z >= Z_THRESHOLD && spike >= MIN_DOLLARS) {
      anomalies.push({
        service,
        resourceId,
        latestDate: last.date,
        latestAmount: +last.amount.toFixed(2),
        baselineMedian: +med.toFixed(2),
        spikeUsd: +spike.toFixed(2),
        zScore: +z.toFixed(1),
        baselineDays: baseline.length,
      });
    }
  }

  anomalies.sort((a, b) => b.spikeUsd - a.spikeUsd);

  return NextResponse.json({
    ok: true,
    computedAt: new Date().toISOString(),
    threshold: { zScore: Z_THRESHOLD, minDollars: MIN_DOLLARS, baselineDays: BASELINE_DAYS },
    anomalies: anomalies.slice(0, TOP_N),
    totalChecked: grouped.size,
  });
}
