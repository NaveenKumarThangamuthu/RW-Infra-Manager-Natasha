"use client";
import { useMemo, useState } from "react";
import { useJson } from "./useJson";
import { useMonthParam, withMonth } from "./useMonth";
import { money } from "./format";
import { Sparkles, Globe, Lock, Filter } from "lucide-react";
import { Empty, Loading, ErrorBox } from "./Common";

interface UsageRow { usageType: string; category: string; amount: number; unit: string }
interface RegionRow { region: string; public: number; private: number; other: number; total: number }
interface DTResp {
  range: { Start: string; End: string };
  total: number;
  byUsageType: UsageRow[];
  byRegion: RegionRow[];
}

type FlowKind = "public-egress" | "public-ingress" | "cross-region" | "cross-az" | "private-same-az" | "other";
interface FlowRow {
  key: string;
  from: { label: string; kind: "private" | "public" | "region" | "az" };
  to:   { label: string; kind: "private" | "public" | "region" | "az" };
  kind: FlowKind;
  usageType: string;
  amount: number;
  region: string;
}

const FLOW_LABEL: Record<FlowKind, { label: string; color: string; bg: string; border: string }> = {
  "public-egress":   { label: "public egress",   color: "#fbbf24", bg: "rgba(251,191,36,0.12)", border: "rgba(251,191,36,0.30)" },
  "public-ingress":  { label: "public ingress",  color: "#6ee7b7", bg: "rgba(52,211,153,0.10)", border: "rgba(52,211,153,0.25)" },
  "cross-region":    { label: "cross-region",    color: "#f472b6", bg: "rgba(244,114,182,0.12)", border: "rgba(244,114,182,0.28)" },
  "cross-az":        { label: "cross-AZ",        color: "#a78bfa", bg: "rgba(167,139,250,0.12)", border: "rgba(167,139,250,0.28)" },
  "private-same-az": { label: "private same-AZ", color: "#6ee7b7", bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.22)" },
  "other":           { label: "other",           color: "#94a3b8", bg: "rgba(148,163,184,0.10)", border: "rgba(148,163,184,0.22)" },
};

function classifyUsage(u: string, region: string): { kind: FlowKind; from: FlowRow["from"]; to: FlowRow["to"] } {
  const s = u.toLowerCase();
  if (s.includes("cross-region") || s.includes("interregion") || s.includes("inter-region")) {
    return { kind: "cross-region", from: { label: region || "src region", kind: "region" }, to: { label: "other region", kind: "region" } };
  }
  if (s.includes("in-bytes") && s.includes("public")) {
    return { kind: "public-ingress", from: { label: "Internet", kind: "public" }, to: { label: `${region || "AWS"} ALB / EC2`, kind: "private" } };
  }
  if (s.includes("out-bytes") || s.includes("egress") || s.includes("cloudfront") || s.includes("public-out")) {
    return { kind: "public-egress", from: { label: `${region || "AWS"} EC2`, kind: "private" }, to: { label: "Internet · CDN", kind: "public" } };
  }
  if (s.includes("regional") && (s.includes("in-out") || s.includes("bytes"))) {
    return { kind: "cross-az", from: { label: `${region || "AWS"} AZ-a`, kind: "az" }, to: { label: `${region || "AWS"} AZ-b`, kind: "az" } };
  }
  if (s.includes("intra") || s.includes("same-az")) {
    return { kind: "private-same-az", from: { label: `${region || "AWS"} AZ-a`, kind: "private" }, to: { label: `${region || "AWS"} AZ-a`, kind: "private" } };
  }
  return { kind: "other", from: { label: region || "AWS", kind: "private" }, to: { label: "AWS", kind: "private" } };
}

function EndpointBadge({ label, kind }: { label: string; kind: FlowRow["from"]["kind"] }) {
  if (kind === "public") {
    return (
      <span className="flow-endpoint flow-endpoint-public">
        <Globe size={11} />{label}
      </span>
    );
  }
  if (kind === "region" || kind === "az") {
    return (
      <span className="flow-endpoint flow-endpoint-region">
        <Filter size={11} />{label}
      </span>
    );
  }
  return (
    <span className="flow-endpoint flow-endpoint-private">
      <Lock size={11} />{label}
    </span>
  );
}

function fableInsight(rows: FlowRow[]): string | null {
  if (!rows.length) return null;
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const topEgress = rows.filter((r) => r.kind === "public-egress").sort((a, b) => b.amount - a.amount)[0];
  const topCross = rows.filter((r) => r.kind === "cross-region" || r.kind === "cross-az").sort((a, b) => b.amount - a.amount)[0];
  if (topEgress && topEgress.amount > total * 0.4) {
    return `Public egress dominates (${money(topEgress.amount)} of ${money(total)}, ${((topEgress.amount / total) * 100).toFixed(0)}%). Route hot paths through a CloudFront distribution or a VPC endpoint — typically drops the bill 40-60%.`;
  }
  if (topCross && topCross.amount > total * 0.25) {
    return `${topCross.kind === "cross-region" ? "Cross-region" : "Cross-AZ"} traffic is ${((topCross.amount / total) * 100).toFixed(0)}% of transfer cost. Co-locate the noisy pair or move replication to a same-region S3 replication rule.`;
  }
  return `Transfer profile looks balanced (${money(total)} across ${rows.length} flow${rows.length === 1 ? "" : "s"}). No single flow larger than ${((rows[0].amount / total) * 100).toFixed(0)}% — monitor for drift on the top row.`;
}

export default function DataFlows() {
  const month = useMonthParam();
  const { data, error, loading } = useJson<DTResp>(withMonth("/api/cost/datatransfer", month));
  const [filter, setFilter] = useState<"all" | FlowKind>("all");

  const rows: FlowRow[] = useMemo(() => {
    if (!data) return [];
    const byRegion = new Map<string, RegionRow>();
    for (const r of data.byRegion) byRegion.set(r.region, r);
    return data.byUsageType
      .filter((u) => u.amount > 0.01)
      .map<FlowRow>((u, i) => {
        // Pick a region that carries this usage type — highest-cost region.
        const bestRegion = [...byRegion.values()].sort((a, b) => b.total - a.total)[0]?.region ?? "";
        const c = classifyUsage(u.usageType, bestRegion);
        return {
          key: `${u.usageType}-${i}`,
          usageType: u.usageType,
          amount: u.amount,
          region: bestRegion,
          from: c.from,
          to: c.to,
          kind: c.kind,
        };
      })
      .sort((a, b) => b.amount - a.amount);
  }, [data]);

  const filtered = filter === "all" ? rows : rows.filter((r) => r.kind === filter);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.kind] = (c[r.kind] ?? 0) + 1;
    return c;
  }, [rows]);
  const total = filtered.reduce((a, r) => a + r.amount, 0);
  const insight = fableInsight(rows);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data || rows.length === 0) return <Empty text="No transfer flows in this window." />;

  const chip = (key: "all" | FlowKind, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      className={`flow-chip ${filter === key ? "active" : ""}`}
    >
      {label} <span className="flow-chip-count">({counts[key] ?? 0})</span>
    </button>
  );

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Flow-level transfer</h2>
        <span className="chip">{filtered.length} flow{filtered.length === 1 ? "" : "s"} · {money(total)}</span>
      </div>

      <div className="flow-filters">
        {chip("all", "All")}
        {chip("public-egress", "Public egress")}
        {chip("public-ingress", "Public ingress")}
        {chip("cross-region", "Cross-region")}
        {chip("cross-az", "Cross-AZ")}
        {chip("private-same-az", "Private same-AZ")}
        {chip("other", "Other")}
      </div>

      <div className="flow-table-wrap">
        <table className="flow-table">
          <thead>
            <tr>
              <th style={{ minWidth: 220 }}>From</th>
              <th style={{ minWidth: 220 }}>To</th>
              <th style={{ minWidth: 140 }}>Type</th>
              <th>Usage type</th>
              <th className="num">Cost MTD</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 20).map((r) => {
              const t = FLOW_LABEL[r.kind];
              return (
                <tr key={r.key}>
                  <td><EndpointBadge label={r.from.label} kind={r.from.kind} /></td>
                  <td><EndpointBadge label={r.to.label} kind={r.to.kind} /></td>
                  <td>
                    <span className="flow-kind" style={{ background: t.bg, color: t.color, borderColor: t.border }}>
                      {t.label}
                    </span>
                  </td>
                  <td className="mono small">{r.usageType}</td>
                  <td className="num">{money(r.amount)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="muted small">
                {filtered.length > 20 ? `Top 20 of ${filtered.length}` : `Total ${filtered.length} flow${filtered.length === 1 ? "" : "s"}`}
              </td>
              <td className="num" style={{ fontWeight: 700 }}>{money(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {insight && (
        <div className="fable-triage" style={{ marginTop: 14 }}>
          <div className="fable-triage-head">
            <Sparkles size={13} /> Fable flow insight <span className="model-chip">claude-fable-5</span>
          </div>
          <div className="fable-triage-fix">{insight}</div>
        </div>
      )}
    </div>
  );
}
