"use client";
import Link from "next/link";

export interface Recommendation {
  severity: "INFO" | "WARN" | "CRIT";
  kind: string;
  message: string;
  targetType?: string;
  monthlyDeltaUsd?: number;
  evidence?: Record<string, string | number>;
}

const SEV_COLOR: Record<string, string> = {
  CRIT: "#f87171",
  WARN: "#f59e0b",
  INFO: "#38bdf8",
};

export function SeverityPill({ sev }: { sev: "INFO" | "WARN" | "CRIT" }) {
  const c = SEV_COLOR[sev];
  return <span className="pill" style={{ borderColor: c, color: c }}>{sev}</span>;
}

export function CostDelta({ usd }: { usd: number | undefined }) {
  if (usd === undefined || usd === 0) return null;
  const save = usd < 0;
  return (
    <span style={{ color: save ? "#34d399" : "#f87171", fontWeight: 600 }}>
      {save ? "saves " : "+"}${Math.abs(usd).toFixed(2)}/mo
    </span>
  );
}

export function RecommendationList({ recs }: { recs: Recommendation[] }) {
  if (recs.length === 0) {
    return <div className="empty">No recommendations.</div>;
  }
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {recs.map((r, i) => (
        <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderBottom: i === recs.length - 1 ? "none" : "1px solid #22324a" }}>
          <SeverityPill sev={r.severity} />
          <div style={{ flex: 1 }}>
            <div>{r.message}</div>
            {(r.targetType || r.monthlyDeltaUsd !== undefined) && (
              <div className="note" style={{ marginTop: 4 }}>
                {r.targetType && <>Target: <span className="mono">{r.targetType}</span>. </>}
                <CostDelta usd={r.monthlyDeltaUsd} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export interface InstanceAnalysisLite {
  instanceId: string;
  name: string;
  region: string;
  type: string;
  state: string;
  source: "prometheus" | "cloudwatch" | "none";
  cpuAvg24h: number | null;
  cpuP95_24h: number | null;
  memAvg24h: number | null;
  diskMaxPct: number | null;
  creditBalancePct: number | null;
  recommendations: Recommendation[];
}

export function topSeverity(recs: Recommendation[]): "INFO" | "WARN" | "CRIT" | null {
  if (recs.some((r) => r.severity === "CRIT")) return "CRIT";
  if (recs.some((r) => r.severity === "WARN")) return "WARN";
  if (recs.length) return "INFO";
  return null;
}

export function totalMonthlyDelta(recs: Recommendation[]): number {
  return recs.reduce((s, r) => s + (r.monthlyDeltaUsd ?? 0), 0);
}

export function instanceLinkCell(a: InstanceAnalysisLite) {
  return (
    <Link href={`/perf/ec2/${a.instanceId}`}>{a.name}</Link>
  );
}
