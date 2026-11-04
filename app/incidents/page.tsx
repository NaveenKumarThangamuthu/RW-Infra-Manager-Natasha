"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useJson } from "@/components/useJson";
import { ErrorBox, Loading } from "@/components/Common";
import RefreshButton from "@/components/RefreshButton";
import SnapshotBanner from "@/components/SnapshotBanner";
import type { InstanceAnalysisLite, Recommendation } from "@/components/perf/Recommendations";

type IncidentType = "EC2" | "GITHUB" | "SPRING" | "CLOUDWATCH" | "PROMETHEUS" | "SCAN";
type Severity = "CRIT" | "HIGH" | "WARN" | "INFO";

interface Incident {
  id: string;
  type: IncidentType;
  severity: Severity;
  title: string;
  source: string;
  detail: string | null;
  detectedAt: string;
  href: string | null;
}
interface SnapMeta { capturedAt: string; via: string | null; fetchMs: number | null; refreshedBy: string | null }
interface IncidentsResp {
  ok: boolean;
  fetchedAt: string;
  snapshotOldestAt: string | null;
  total: number;
  byType: Record<IncidentType, number>;
  bySeverity: Record<Severity, number>;
  incidents: Incident[];
  sourceMeta: Record<string, SnapMeta | null>;
}
interface RecsResp { ok: boolean; fetchedAt: string; analyses: InstanceAnalysisLite[] }

// Unified row shape — either an Incident or a flattened Recommendation.
type Kind = "incident" | "recommendation";
interface UnifiedRow {
  key: string;
  kind: Kind;
  severity: Severity;
  title: string;
  source: string;
  category: string; // For incidents: type. For recs: kind (upsize/downsize/modernize/etc)
  detail: string | null;
  detectedAt: string;
  href: string | null;
  targetType: string | null;
  monthlyDeltaUsd: number | null;
}

const TYPE_META: Record<IncidentType, { label: string; ico: string }> = {
  EC2:        { label: "EC2",        ico: "🖥" },
  GITHUB:     { label: "GitHub",     ico: "🐙" },
  SPRING:     { label: "Spring",     ico: "🌱" },
  CLOUDWATCH: { label: "CloudWatch", ico: "☁" },
  PROMETHEUS: { label: "Prometheus", ico: "📈" },
  SCAN:       { label: "Scans",      ico: "🛡" },
};
const REC_META: Record<string, { label: string; ico: string }> = {
  "cpu-upsize":    { label: "CPU upsize",    ico: "⬆" },
  "cpu-downsize":  { label: "CPU downsize",  ico: "⬇" },
  "rightsizing-downsize": { label: "Rightsize", ico: "↔" },
  "memory-pressure": { label: "Memory",      ico: "🧠" },
  "disk-full":     { label: "Disk full",     ico: "💾" },
  "disk-near-full": { label: "Disk near full", ico: "💾" },
  "credits-low":   { label: "Credits low",   ico: "🔋" },
  "modernize":     { label: "Modernize",     ico: "🚀" },
  "stopped":       { label: "Stopped",       ico: "⏸" },
  "analysis-error": { label: "Analysis err", ico: "⚠" },
};
function recCategoryMeta(kind: string) {
  return REC_META[kind] ?? { label: kind.replace(/-/g, " "), ico: "•" };
}

const SEV_DOT: Record<Severity, string> = {
  CRIT: "#ef4444", HIGH: "#f97316", WARN: "#f59e0b", INFO: "#3b82f6",
};

function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return iso;
  const diff = Date.now() - d;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "ago" : "from now";
  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ${suffix}`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h ${suffix}`;
  return `${Math.round(abs / 86_400_000)}d ${suffix}`;
}

function normalizeRecSev(sev: "INFO" | "WARN" | "CRIT"): Severity {
  return sev === "CRIT" ? "CRIT" : sev === "WARN" ? "WARN" : "INFO";
}

export default function Page() {
  const { data: iData, error: iErr, loading: iLoading, reload: iReload } = useJson<IncidentsResp>("/api/incidents");
  const { data: rData, error: rErr, reload: rReload } = useJson<RecsResp>("/api/perf/recommendations");

  const [kind, setKind] = useState<Kind | "all">("all");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [q, setQ] = useState("");

  const reloadAll = () => { iReload(); rReload(); };

  const rows = useMemo<UnifiedRow[]>(() => {
    const out: UnifiedRow[] = [];
    for (const i of iData?.incidents ?? []) {
      out.push({
        key: `i:${i.id}`,
        kind: "incident",
        severity: i.severity,
        title: i.title,
        source: i.source,
        category: i.type,
        detail: i.detail,
        detectedAt: i.detectedAt,
        href: i.href,
        targetType: null,
        monthlyDeltaUsd: null,
      });
    }
    for (const a of rData?.analyses ?? []) {
      for (const r of a.recommendations) {
        // Skip the "ok" placeholder rec since it's not actionable
        if (r.kind === "ok") continue;
        out.push({
          key: `r:${a.instanceId}:${r.kind}:${r.targetType ?? ""}`,
          kind: "recommendation",
          severity: normalizeRecSev(r.severity),
          title: r.message,
          source: `${a.name || a.instanceId} · ${a.type}`,
          category: r.kind,
          detail: null,
          detectedAt: rData?.fetchedAt ?? new Date().toISOString(),
          href: `/perf/ec2/${encodeURIComponent(a.instanceId)}`,
          targetType: r.targetType ?? null,
          monthlyDeltaUsd: r.monthlyDeltaUsd ?? null,
        });
      }
    }
    // Sort: by severity (CRIT > HIGH > WARN > INFO), then newest first
    const SEV_RANK: Record<Severity, number> = { CRIT: 0, HIGH: 1, WARN: 2, INFO: 3 };
    out.sort((a, b) => {
      const sd = SEV_RANK[a.severity] - SEV_RANK[b.severity];
      if (sd !== 0) return sd;
      return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
    });
    return out;
  }, [iData, rData]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (severity && r.severity !== severity) return false;
      if (needle) {
        const hay = `${r.title} ${r.source} ${r.category} ${r.detail ?? ""} ${r.targetType ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, kind, severity, q]);

  const counts = useMemo(() => {
    const c = {
      total: rows.length,
      incident: 0, recommendation: 0,
      CRIT: 0, HIGH: 0, WARN: 0, INFO: 0,
    };
    for (const r of rows) {
      if (r.kind === "incident") c.incident++;
      else c.recommendation++;
      c[r.severity]++;
    }
    return c;
  }, [rows]);

  const savings = useMemo(() => {
    let s = 0;
    for (const r of rows) {
      if (r.kind === "recommendation" && r.monthlyDeltaUsd != null && r.monthlyDeltaUsd < 0) s += r.monthlyDeltaUsd;
    }
    return s;
  }, [rows]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Alerts &amp; Actions</h1>
          <p className="page-sub">
            Unified feed of open incidents plus per-instance recommendations. Filter by kind, severity, or source; each row
            has an action link (rec cards go to the instance drawer, incidents go to their source).
          </p>
        </div>
        <RefreshButton sources={["all"]} onDone={reloadAll} label="Refresh all sources" />
      </div>

      <SnapshotBanner capturedAt={iData?.snapshotOldestAt ?? null} label="Oldest external snapshot" />

      {(iErr || rErr) && <ErrorBox message={iErr ?? rErr ?? ""} />}
      {iLoading && !iData && <Loading />}

      {(iData || rData) && (
        <>
          <div className="incident-hero">
            <div className="card primary">
              <div className="card-label">Open items</div>
              <div className="big-number" style={{ color: counts.CRIT > 0 ? "#f87171" : counts.HIGH > 0 ? "#f59e0b" : "#34d399" }}>
                {counts.total}
              </div>
              <div className="sev-row">
                <span><span className="dot" style={{ background: "#ef4444" }} />{counts.CRIT} Crit</span>
                <span><span className="dot" style={{ background: "#f97316" }} />{counts.HIGH} High</span>
                <span><span className="dot" style={{ background: "#f59e0b" }} />{counts.WARN} Warn</span>
                <span><span className="dot" style={{ background: "#3b82f6" }} />{counts.INFO} Info</span>
              </div>
            </div>
            <div className="card">
              <div className="card-label">Incidents</div>
              <div className="card-value" style={{ color: counts.incident > 0 ? "#f87171" : "#34d399" }}>{counts.incident}</div>
            </div>
            <div className="card">
              <div className="card-label">Recommendations</div>
              <div className="card-value" style={{ color: "#38bdf8" }}>{counts.recommendation}</div>
            </div>
            <div className="card">
              <div className="card-label">Potential $/mo saved</div>
              <div className="card-value" style={{ color: savings < 0 ? "#34d399" : "#94a3b8" }}>
                {savings < 0 ? `$${Math.abs(savings).toFixed(0)}` : "—"}
              </div>
            </div>
          </div>

          {/* KIND filter chips — the new bit */}
          <div className="type-chips" style={{ marginBottom: 12 }}>
            <button className={`type-chip ${kind === "all" ? "active" : ""}`} onClick={() => setKind("all")}>
              All <span className="count">{counts.total}</span>
            </button>
            <button className={`type-chip ${kind === "incident" ? "active" : ""} ${counts.incident === 0 ? "zero" : ""}`} onClick={() => setKind("incident")}>
              🚨 Incidents <span className="count">{counts.incident}</span>
            </button>
            <button className={`type-chip ${kind === "recommendation" ? "active" : ""} ${counts.recommendation === 0 ? "zero" : ""}`} onClick={() => setKind("recommendation")}>
              💡 Recommendations <span className="count">{counts.recommendation}</span>
            </button>
          </div>

          <div className="panel">
            <div className="filterbar">
              <input className="input" placeholder="Search title / source / category / target-type" value={q} onChange={(e) => setQ(e.target.value)} />
              <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value as Severity | "")}>
                <option value="">All severity</option>
                <option value="CRIT">Critical</option>
                <option value="HIGH">High</option>
                <option value="WARN">Warning</option>
                <option value="INFO">Info</option>
              </select>
            </div>

            {filtered.length === 0 ? (
              rows.length === 0 ? (
                <div className="empty-state-clear">
                  <div className="icon">✓</div>
                  <h3>All clear</h3>
                  <p>No open incidents or recommendations.</p>
                </div>
              ) : (
                <div className="empty-state-clear">
                  <div className="icon">🔍</div>
                  <h3 style={{ color: "var(--muted)" }}>No matches</h3>
                  <p>{rows.length} row{rows.length === 1 ? "" : "s"} hidden by the current filters.</p>
                </div>
              )
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="incidents-table">
                  <thead>
                    <tr>
                      <th style={{ width: 100 }}>Kind</th>
                      <th style={{ width: 90 }}>Severity</th>
                      <th style={{ width: 130 }}>Category</th>
                      <th>What</th>
                      <th style={{ width: 220 }}>Source</th>
                      <th style={{ width: 130 }}>Cost / Delta</th>
                      <th style={{ width: 120 }}>Detected</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => {
                      const catMeta = r.kind === "incident"
                        ? TYPE_META[r.category as IncidentType]
                        : recCategoryMeta(r.category);
                      const isSaving = r.monthlyDeltaUsd != null && r.monthlyDeltaUsd < 0;
                      return (
                        <tr key={r.key} className="incident-row">
                          <td>
                            <span className={`kind-chip kind-${r.kind}`}>
                              {r.kind === "incident" ? "🚨 Incident" : "💡 Rec"}
                            </span>
                          </td>
                          <td><span className={`sev-pill ${r.severity.toLowerCase()}`}>{r.severity}</span></td>
                          <td>
                            <span className={r.kind === "incident" ? `type-badge t-${r.category}` : "type-badge t-REC"}>
                              {catMeta?.ico ?? ""} {catMeta?.label ?? r.category}
                            </span>
                          </td>
                          <td>
                            <div className="title">{r.title}</div>
                            {r.detail && <div className="detail" title={r.detail}>{r.detail.length > 220 ? r.detail.slice(0, 220) + "…" : r.detail}</div>}
                            {r.targetType && <div className="detail">→ target <span className="mono">{r.targetType}</span></div>}
                          </td>
                          <td><span className="source">{r.source}</span></td>
                          <td>
                            {r.monthlyDeltaUsd != null ? (
                              <span style={{ color: isSaving ? "#34d399" : "#f87171", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                                {isSaving ? "-" : "+"}${Math.abs(r.monthlyDeltaUsd).toFixed(0)}/mo
                              </span>
                            ) : <span className="muted">—</span>}
                          </td>
                          <td><span className="when" title={new Date(r.detectedAt).toLocaleString()}>{relTime(r.detectedAt)}</span></td>
                          <td>
                            {r.href ? (
                              <Link href={r.href} className="go" aria-label="Open">→</Link>
                            ) : <span className="muted">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
