"use client";
import { useMemo } from "react";
import { useJson } from "./useJson";
import { RefreshCw, ScanSearch, AlertTriangle, Package } from "lucide-react";

interface DashResp {
  ops?: {
    cronLastRunAt?: string | null;
    snapshotAges?: Record<string, string | null>;
  };
  lastSnap?: Record<string, string | null>;
}
interface AnomalyResp { anomalies?: Array<{ resourceId: string; service: string; amount: number; severity: string; latestDate: string }> }
interface ScansResp { jobs?: Array<{ repoFullName: string; status: string; startedAt: string; findingsCount: number }> }

interface Event {
  key: string;
  at: Date;
  icon: React.ReactNode;
  tone: "info" | "warn" | "crit" | "ok";
  text: string;
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

export default function RecentActivity() {
  const { data: dash } = useJson<DashResp>("/api/dashboard/summary");
  const { data: anomalies } = useJson<AnomalyResp>("/api/cost/anomalies");
  const { data: scans } = useJson<ScansResp>("/api/security/scans");

  const events = useMemo<Event[]>(() => {
    const out: Event[] = [];

    if (dash?.ops?.cronLastRunAt) {
      out.push({
        key: `cron-${dash.ops.cronLastRunAt}`,
        at: new Date(dash.ops.cronLastRunAt),
        icon: <RefreshCw size={13} />,
        tone: "info",
        text: "Cron refresh — 8 snapshots + billing snapshot + Fable daily brief regenerated",
      });
    }

    for (const [source, at] of Object.entries(dash?.lastSnap ?? {})) {
      if (!at) continue;
      out.push({
        key: `snap-${source}-${at}`,
        at: new Date(at),
        icon: <Package size={13} />,
        tone: "info",
        text: `Snapshot refreshed · ${source}`,
      });
    }

    for (const a of (anomalies?.anomalies ?? []).slice(0, 3)) {
      out.push({
        key: `anom-${a.resourceId}-${a.latestDate}`,
        at: new Date(a.latestDate),
        icon: <AlertTriangle size={13} />,
        tone: a.severity === "crit" ? "crit" : a.severity === "warn" ? "warn" : "info",
        text: `Cost anomaly · ${a.service} ${(a.resourceId ?? "").slice(0, 24)} — $${(a.amount ?? 0).toFixed(2)} today`,
      });
    }

    for (const j of (scans?.jobs ?? []).slice(0, 3)) {
      if (j.status !== "success") continue;
      out.push({
        key: `scan-${j.repoFullName}-${j.startedAt}`,
        at: new Date(j.startedAt),
        icon: <ScanSearch size={13} />,
        tone: j.findingsCount > 0 ? "warn" : "ok",
        text: `Trivy scan · ${j.repoFullName} — ${j.findingsCount} finding${j.findingsCount === 1 ? "" : "s"}`,
      });
    }

    out.sort((a, b) => b.at.getTime() - a.at.getTime());
    // Dedup on message body to avoid identical snapshots stacking
    const seen = new Set<string>();
    const deduped: Event[] = [];
    for (const e of out) {
      if (seen.has(e.text)) continue;
      seen.add(e.text);
      deduped.push(e);
      if (deduped.length >= 8) break;
    }
    return deduped;
  }, [dash, anomalies, scans]);

  return (
    <div className="panel activity-panel">
      <div className="panel-head">
        <h2>Recent activity · last 24h</h2>
        <span className="chip">{events.length} events</span>
      </div>
      {events.length === 0 ? (
        <div className="anomaly-banner-clean muted">Nothing has happened in the last 24 hours yet — cron will refresh at the next window.</div>
      ) : (
        <ul className="activity-list">
          {events.map((e) => (
            <li key={e.key} className={`activity-item activity-${e.tone}`}>
              <span className="activity-icon">{e.icon}</span>
              <span className="activity-text">{e.text}</span>
              <span className="activity-time muted small">{distance(e.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
