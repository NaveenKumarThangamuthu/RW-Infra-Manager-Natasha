"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useJson } from "@/components/useJson";
import { ErrorBox, Loading, Empty } from "@/components/Common";
import RefreshButton from "@/components/RefreshButton";
import SnapshotBanner from "@/components/SnapshotBanner";
import CsvButton from "@/components/CsvButton";
import {
  SeverityPill,
  CostDelta,
  topSeverity,
  totalMonthlyDelta,
  type InstanceAnalysisLite,
  type Recommendation,
} from "@/components/perf/Recommendations";
import { Cpu, MemoryStick, HardDrive, BatteryLow, PauseCircle, TriangleAlert, CheckCircle, type LucideIcon } from "lucide-react";

interface Resp { ok: boolean; fetchedAt: string; analyses: InstanceAnalysisLite[]; }

/**
 * Recommendation *type* filter groups — collapse the raw `kind` field into
 * user-facing buckets. Clicking a button includes/excludes instances that
 * carry a recommendation with any of the matching kinds.
 */
interface RecTypeGroup {
  id: "cpu" | "memory" | "disk" | "credits" | "stopped" | "errors";
  label: string;
  Icon: LucideIcon;
  kinds: Set<string>;
  color: string;
}

const REC_GROUPS: RecTypeGroup[] = [
  { id: "cpu", label: "CPU", Icon: Cpu, color: "#38bdf8", kinds: new Set(["cpu-upsize", "cpu-downsize", "rightsizing-downsize"]) },
  { id: "memory", label: "Memory", Icon: MemoryStick, color: "#a78bfa", kinds: new Set(["memory-pressure"]) },
  { id: "disk", label: "Disk", Icon: HardDrive, color: "#f59e0b", kinds: new Set(["disk-full", "disk-near-full"]) },
  { id: "credits", label: "Credits", Icon: BatteryLow, color: "#facc15", kinds: new Set(["credits-low"]) },
  { id: "stopped", label: "Stopped", Icon: PauseCircle, color: "#94a3b8", kinds: new Set(["stopped"]) },
  { id: "errors", label: "Errors", Icon: TriangleAlert, color: "#f87171", kinds: new Set(["analysis-error"]) },
];

function recGroupFor(kind: string): RecTypeGroup["id"] | null {
  for (const g of REC_GROUPS) if (g.kinds.has(kind)) return g.id;
  return null;
}

export default function Page() {
  const { data, error, loading, reload } = useJson<Resp>("/api/perf/recommendations");

  const [sev, setSev] = useState<"" | "INFO" | "WARN" | "CRIT">("");
  const [q, setQ] = useState("");
  const [activeTypes, setActiveTypes] = useState<Set<RecTypeGroup["id"]>>(new Set());

  const rows = data?.analyses ?? [];

  /** Per-type counts across the entire dataset (unfiltered, for button badges). */
  const typeCounts = useMemo(() => {
    const c: Record<RecTypeGroup["id"], number> = { cpu: 0, memory: 0, disk: 0, credits: 0, stopped: 0, errors: 0 };
    for (const a of rows) {
      const seen = new Set<RecTypeGroup["id"]>();
      for (const r of a.recommendations) {
        const g = recGroupFor(r.kind);
        if (g && !seen.has(g)) { c[g]++; seen.add(g); }
      }
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((a) => {
      const ts = topSeverity(a.recommendations);
      if (sev && ts !== sev) return false;
      if (activeTypes.size > 0) {
        const hasType = a.recommendations.some((r) => {
          const g = recGroupFor(r.kind);
          return g != null && activeTypes.has(g);
        });
        if (!hasType) return false;
      }
      if (needle && !`${a.name} ${a.instanceId} ${a.type}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, sev, q, activeTypes]);

  function toggleType(id: RecTypeGroup["id"]) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totals = useMemo(() => {
    const counts = { CRIT: 0, WARN: 0, INFO: 0 };
    let savings = 0;
    for (const a of rows) {
      const ts = topSeverity(a.recommendations);
      if (ts && ts in counts) counts[ts]++;
      const delta = totalMonthlyDelta(a.recommendations);
      if (delta < 0) savings += delta;
    }
    return { counts, savings: -savings };
  }, [rows]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Recommendations</h1>
          <p className="page-sub">
            24-hour analysis of CPU, memory, disk, and CPU credits for every instance, served from the
            snapshot cache. CRIT and WARN items first; downsize candidates show potential monthly savings.
          </p>
        </div>
        <RefreshButton sources={["recommendations"]} onDone={reload} label="Refresh analysis" />
      </div>

      <SnapshotBanner capturedAt={data?.fetchedAt ?? null} label="Recommendations snapshot" />

      <div className="card-row" style={{ marginBottom: 14 }}>
        <div className="card"><div className="card-label">Critical</div><div className="card-value" style={{ color: totals.counts.CRIT ? "#f87171" : "#34d399" }}>{totals.counts.CRIT}</div></div>
        <div className="card"><div className="card-label">Warnings</div><div className="card-value" style={{ color: totals.counts.WARN ? "#f59e0b" : "#34d399" }}>{totals.counts.WARN}</div></div>
        <div className="card"><div className="card-label">Info</div><div className="card-value">{totals.counts.INFO}</div></div>
        <div className="card"><div className="card-label">Potential savings/mo</div><div className="card-value" style={{ color: totals.savings ? "#34d399" : undefined }}>${totals.savings.toFixed(2)}</div></div>
      </div>

      <div className="rec-type-filters" role="group" aria-label="Filter by recommendation type">
        {REC_GROUPS.map((g) => {
          const Icon = g.Icon;
          const on = activeTypes.has(g.id);
          const count = typeCounts[g.id];
          return (
            <button
              key={g.id}
              type="button"
              className={`rec-type-btn ${on ? "on" : ""}`}
              onClick={() => toggleType(g.id)}
              aria-pressed={on}
              style={{ ["--rec-type-color" as string]: g.color }}
              title={on ? `Hide ${g.label} recommendations` : `Show only ${g.label} recommendations`}
              disabled={count === 0}
            >
              <Icon size={14} />
              <span className="rec-type-label">{g.label}</span>
              <span className="rec-type-count tab-num">{count}</span>
            </button>
          );
        })}
        {activeTypes.size > 0 && (
          <button
            type="button"
            className="rec-type-clear"
            onClick={() => setActiveTypes(new Set())}
            title="Clear type filters"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="panel">
        <div className="panel-head" style={{ marginBottom: 8 }}>
          <h2>Per-instance analysis</h2>
          <CsvButton
            rows={filtered.map((a) => {
              const top = a.recommendations.slice(0, 3).map((r) => r.message).join(" | ");
              const overflow = a.recommendations.length > 3 ? ` (+${a.recommendations.length - 3} more)` : "";
              return {
                instanceId: a.instanceId,
                name: a.name,
                type: a.type,
                state: a.state,
                severity: topSeverity(a.recommendations) ?? "",
                cpuAvg24h: a.cpuAvg24h ?? null,
                cpuP95_24h: a.cpuP95_24h ?? null,
                memAvg24h: a.memAvg24h ?? null,
                diskMaxPct: a.diskMaxPct ?? null,
                creditBalancePct: a.creditBalancePct ?? null,
                monthlyDeltaUsd: totalMonthlyDelta(a.recommendations),
                recommendationCount: a.recommendations.length,
                topRecommendations: `${top}${overflow}`,
              };
            })}
            filename="recommendations.csv"
            columns={[
              { key: "instanceId", label: "Instance ID" },
              { key: "name", label: "Name" },
              { key: "type", label: "Type" },
              { key: "state", label: "State" },
              { key: "severity", label: "Top severity" },
              { key: "cpuAvg24h", label: "CPU avg 24h (%)" },
              { key: "cpuP95_24h", label: "CPU p95 24h (%)" },
              { key: "memAvg24h", label: "Mem avg 24h (%)" },
              { key: "diskMaxPct", label: "Disk max (%)" },
              { key: "creditBalancePct", label: "Credits min (%)" },
              { key: "monthlyDeltaUsd", label: "Monthly delta ($)" },
              { key: "recommendationCount", label: "Total recommendations" },
              { key: "topRecommendations", label: "Top recommendations" },
            ]}
          />
        </div>
        <div className="filterbar">
          <input className="input" placeholder="Search name / ID / type" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={sev} onChange={(e) => setSev(e.target.value as "" | "INFO" | "WARN" | "CRIT")}>
            <option value="">All severities</option>
            <option value="CRIT">Critical</option>
            <option value="WARN">Warning</option>
            <option value="INFO">Info</option>
          </select>
        </div>

        {error ? <ErrorBox message={error} />
          : loading && !data ? <Loading />
            : filtered.length === 0 ? <Empty text="No instances match." />
              : (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Severity</th>
                        <th>Instance</th>
                        <th>Type</th>
                        <th>State</th>
                        <th>CPU avg / p95</th>
                        <th>Mem avg</th>
                        <th>Disk max</th>
                        <th>Credits min %</th>
                        <th>Top recommendations</th>
                        <th>Δ $/mo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((a) => {
                        const ts = topSeverity(a.recommendations);
                        const delta = totalMonthlyDelta(a.recommendations);
                        return (
                          <tr key={a.instanceId}>
                            <td>{ts ? <SeverityPill sev={ts} /> : <span className="muted">-</span>}</td>
                            <td><Link href={`/perf/ec2/${a.instanceId}`}>{a.name}</Link><br /><span className="mono" style={{ fontSize: 11 }}>{a.instanceId}</span></td>
                            <td>{a.type}</td>
                            <td>{a.state}</td>
                            <td>{a.cpuAvg24h !== null ? `${a.cpuAvg24h.toFixed(0)}% / ${a.cpuP95_24h !== null ? a.cpuP95_24h.toFixed(0) : "-"}%` : <span className="muted">-</span>}</td>
                            <td>{a.memAvg24h !== null ? `${a.memAvg24h.toFixed(0)}%` : <span className="muted">-</span>}</td>
                            <td>{a.diskMaxPct !== null ? `${a.diskMaxPct.toFixed(0)}%` : <span className="muted">-</span>}</td>
                            <td>{a.creditBalancePct !== null ? `${a.creditBalancePct.toFixed(0)}%` : <span className="muted">-</span>}</td>
                            <td style={{ maxWidth: 380 }}>
                              {a.recommendations.slice(0, 2).map((r, i) => <RecLine key={i} r={r} />)}
                              {a.recommendations.length > 2 && (
                                <Link href={`/perf/ec2/${a.instanceId}`} className="note">+ {a.recommendations.length - 2} more</Link>
                              )}
                            </td>
                            <td><CostDelta usd={delta} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
      </div>
    </>
  );
}

function RecLine({ r }: { r: Recommendation }) {
  const c = r.severity === "CRIT" ? "#f87171" : r.severity === "WARN" ? "#f59e0b" : "#94a3b8";
  return (
    <div style={{ fontSize: 12.5, marginBottom: 4 }}>
      <span style={{ color: c, marginRight: 6 }}>●</span>
      {r.message}
    </div>
  );
}
