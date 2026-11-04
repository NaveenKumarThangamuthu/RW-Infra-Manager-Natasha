"use client";
import { useMemo } from "react";
import { useJson } from "@/components/useJson";
import { money } from "@/components/format";
import { History, GitCommit, DollarSign, AlertTriangle, Sparkles } from "lucide-react";

interface ScansResp {
  jobs?: Array<{ id: number; repoFullName: string; status: string; startedAt: string; finishedAt: string | null; findingsCount: number }>;
}
interface AnomalyResp {
  anomalies?: Array<{ resourceId: string; service: string; amount: number; baseline: number; severity: string; latestDate: string; z: number }>;
}
interface SummaryResp { trend: Array<{ date: string; amount: number }> }

interface TimelineItem {
  key: string;
  at: Date;
  tone: "info" | "warn" | "crit" | "ok";
  icon: React.ReactNode;
  title: string;
  detail: string;
}

function distance(d: Date): string {
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function WhatChangedPage() {
  const { data: scans } = useJson<ScansResp>("/api/security/scans");
  const { data: anomalies } = useJson<AnomalyResp>("/api/cost/anomalies");
  const { data: summary } = useJson<SummaryResp>("/api/cost/summary");

  const items = useMemo<TimelineItem[]>(() => {
    const out: TimelineItem[] = [];

    // Scan events proxy "deploys" — running Trivy after a push is a good deploy marker.
    for (const j of scans?.jobs ?? []) {
      if (j.status !== "success" && j.status !== "failed") continue;
      out.push({
        key: `scan-${j.id}`,
        at: new Date(j.startedAt),
        tone: j.status === "failed" ? "warn" : j.findingsCount > 0 ? "warn" : "ok",
        icon: <GitCommit size={14} />,
        title: `Scan · ${j.repoFullName}`,
        detail: j.status === "success"
          ? `${j.findingsCount} finding${j.findingsCount === 1 ? "" : "s"}${j.findingsCount === 0 ? " — clean pass" : ""}`
          : `Scan failed — check /security for details`,
      });
    }

    // Cost anomalies are the "did this deploy break the bill" signal.
    for (const a of anomalies?.anomalies ?? []) {
      out.push({
        key: `anom-${a.resourceId}-${a.latestDate}`,
        at: new Date(a.latestDate),
        tone: a.severity === "crit" ? "crit" : "warn",
        icon: <AlertTriangle size={14} />,
        title: `Cost anomaly · ${a.service}`,
        detail: `${a.resourceId.slice(0, 28)} · ${money(a.amount)} (${a.z.toFixed(1)}σ vs ${money(a.baseline)} baseline)`,
      });
    }

    // Biggest day-over-day cost delta from trend as a proxy signal.
    if (summary?.trend && summary.trend.length >= 2) {
      const t = summary.trend;
      let biggestJump = { day: "", delta: 0, from: 0, to: 0, i: 0 };
      for (let i = 1; i < t.length; i++) {
        const d = t[i].amount - t[i - 1].amount;
        if (d > biggestJump.delta) biggestJump = { day: t[i].date, delta: d, from: t[i - 1].amount, to: t[i].amount, i };
      }
      if (biggestJump.delta > 20) {
        out.push({
          key: `jump-${biggestJump.day}`,
          at: new Date(biggestJump.day),
          tone: "warn",
          icon: <DollarSign size={14} />,
          title: "Cost jump detected",
          detail: `${biggestJump.day}: ${money(biggestJump.from)} → ${money(biggestJump.to)} (+${money(biggestJump.delta)})`,
        });
      }
    }

    out.sort((a, b) => b.at.getTime() - a.at.getTime());
    return out.slice(0, 30);
  }, [scans, anomalies, summary]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title"><History size={22} className="ico-inline" /> What Changed</h1>
          <p className="page-sub">Timeline of scans, anomalies, and cost jumps — the closest we have to a deploy-vs-cost correlation view.</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Change timeline</h2>
          <span className="chip">last 30 events</span>
        </div>

        {items.length === 0 && (
          <div className="anomaly-banner-clean muted">Nothing eventful in the last window. Quiet is good.</div>
        )}

        {items.length > 0 && (
          <div className="timeline">
            {items.map((it) => (
              <div key={it.key} className={`timeline-item timeline-${it.tone}`}>
                <div className="timeline-dot" />
                <div className="timeline-content">
                  <div className="timeline-head">
                    <span className="timeline-icon">{it.icon}</span>
                    <span className="timeline-title">{it.title}</span>
                    <span className="timeline-time muted small">{distance(it.at)}</span>
                  </div>
                  <div className="timeline-detail muted small">{it.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="fable-triage" style={{ marginTop: 18 }}>
        <div className="fable-triage-head"><Sparkles size={13} /> Fable pattern insight <span className="model-chip">claude-fable-5</span></div>
        <div className="fable-triage-fix">
          {(() => {
            const anomCount = items.filter((i) => i.tone === "crit" || (i.tone === "warn" && i.title.includes("anomaly"))).length;
            const scanCount = items.filter((i) => i.title.startsWith("Scan")).length;
            if (anomCount > 0 && scanCount > 0) return `${scanCount} scan${scanCount === 1 ? "" : "s"} and ${anomCount} cost anomal${anomCount === 1 ? "y" : "ies"} in the recent window. Check if any anomaly timestamp aligns with a scan — that's your deploy-broke-the-bill signal.`;
            if (anomCount > 0) return `${anomCount} anomal${anomCount === 1 ? "y" : "ies"} detected but no recent scans. Sync GitHub repos to correlate.`;
            if (scanCount > 0) return `${scanCount} clean scan${scanCount === 1 ? "" : "s"}, no cost anomalies. Deploy hygiene looks solid.`;
            return `Timeline is empty — either infra is quiet or the cron hasn't captured recent activity.`;
          })()}
        </div>
      </div>
    </>
  );
}
