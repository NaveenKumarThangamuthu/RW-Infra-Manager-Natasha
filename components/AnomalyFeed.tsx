"use client";
import Link from "next/link";
import { AlertTriangle, TrendingUp, Sparkles, CircleCheck } from "lucide-react";
import { useJson } from "./useJson";
import { money } from "./format";
import type { InspectPayload } from "./InspectorDrawer";

interface Anomaly {
  service: string;
  resourceId: string;
  latestDate: string;
  latestAmount: number;
  baselineMedian: number;
  spikeUsd: number;
  zScore: number;
  baselineDays: number;
}

interface Resp {
  ok: boolean;
  threshold: { zScore: number; minDollars: number; baselineDays: number };
  anomalies: Anomaly[];
  totalChecked: number;
  computedAt: string;
}

function severityClass(spike: number): string {
  if (spike >= 50) return "crit";
  if (spike >= 10) return "warn";
  return "info";
}

function multiplier(latest: number, base: number): string {
  if (base <= 0) return "—";
  const x = latest / base;
  if (x >= 100) return `${Math.round(x)}×`;
  if (x >= 10) return `${x.toFixed(1)}×`;
  return `${x.toFixed(2)}×`;
}

function openInspector(a: Anomaly) {
  const payload: InspectPayload = {
    kind: a.service === "EC2" ? "ec2" : a.service === "LAMBDA" ? "lambda" : a.service === "SNS" ? "sns" : "service",
    id: a.resourceId,
    label: `${a.service} cost anomaly`,
    cost14d: a.latestAmount,
    href: a.service === "EC2" ? `/perf/ec2/${a.resourceId}` : a.service === "LAMBDA" ? `/lambda` : `/sns`,
    meta: {
      Service: a.service,
      "Latest day": a.latestDate,
      "Latest amount": money(a.latestAmount),
      "Baseline median": money(a.baselineMedian),
      "Spike Δ": money(a.spikeUsd),
      "z-score": String(a.zScore),
      Baseline: `${a.baselineDays} days`,
    },
  };
  window.dispatchEvent(new CustomEvent<InspectPayload>("natasha:inspect", { detail: payload }));
}

export default function AnomalyFeed() {
  const { data, loading, error } = useJson<Resp>("/api/cost/anomalies");

  // Loading — slim shimmer in a banner-style panel, not a full panel doubling padding
  if (loading && !data) {
    return <div className="anomaly-loading skel skel-row" aria-label="Computing anomalies…" />;
  }
  if (error) {
    return <div className="anomaly-banner anomaly-banner-error">Could not compute cost anomalies right now.</div>;
  }
  if (!data) return null;

  // Empty state — slim green banner instead of a full panel
  if (data.anomalies.length === 0) {
    return (
      <div className="anomaly-banner anomaly-banner-clean" role="status">
        <CircleCheck size={15} />
        <span><strong>All clear</strong> — no resource jumped ≥ {data.threshold.zScore}σ vs its {data.threshold.baselineDays}-day median.</span>
        <span className="muted small">{data.totalChecked.toLocaleString()} resources scanned</span>
      </div>
    );
  }

  const latestDate = data.anomalies[0]?.latestDate;

  return (
    <div className="panel anomaly-panel">
      <div className="panel-head">
        <h2>
          <Sparkles size={16} className="ico-inline" />
          Cost anomalies
          <span className="chip">last {data.threshold.baselineDays}d baseline · z ≥ {data.threshold.zScore}σ</span>
          {latestDate && <span className="chip">latest data: {latestDate}</span>}
        </h2>
        <span className="muted small">{data.totalChecked.toLocaleString()} resources scanned</span>
      </div>

      <ul className="anomaly-list">
        {data.anomalies.map((a) => (
          <li key={`${a.service}-${a.resourceId}`} className={`anomaly-row sev-${severityClass(a.spikeUsd)}`}>
            <div className="anomaly-ico">
              <AlertTriangle size={18} />
            </div>
            <div className="anomaly-body">
              <div className="anomaly-title">
                <span className="anomaly-svc">{a.service}</span>
                <button
                  type="button"
                  className="anomaly-resource mono"
                  onClick={() => openInspector(a)}
                  title="Open inspector"
                >
                  {a.resourceId}
                </button>
                {a.service === "EC2" && (
                  <Link href={`/perf/ec2/${a.resourceId}`} className="anomaly-resource-link muted small" title="Open full page">↗</Link>
                )}
              </div>
              <div className="anomaly-meta muted">
                {a.latestDate} · baseline {money(a.baselineMedian)} → {money(a.latestAmount)} ({multiplier(a.latestAmount, a.baselineMedian)})
              </div>
            </div>
            <div className="anomaly-impact">
              <span className="anomaly-spike">
                <TrendingUp size={14} /> +{money(a.spikeUsd)}
              </span>
              <span className="anomaly-z muted">z = {a.zScore}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
