"use client";
import Sparkline from "./Sparkline";

interface Props {
  label: string;
  /** Formatted primary value (e.g. "6.9s"). */
  display: string;
  /** Verdict — "good" | "warn" | "poor" | "unknown". */
  verdict: "good" | "warn" | "poor" | "unknown";
  /** 30d spark of the metric. */
  spark: number[];
  /** Optional caption below the value, e.g. "vs 4.2s target". */
  caption?: string;
}

const VERDICT: Record<Props["verdict"], { label: string; color: string; bg: string }> = {
  good: { label: "Good", color: "#22c55e", bg: "rgba(34,197,94,0.10)" },
  warn: { label: "Needs work", color: "#f59e0b", bg: "rgba(245,158,11,0.10)" },
  poor: { label: "Poor", color: "#ef4444", bg: "rgba(239,68,68,0.10)" },
  unknown: { label: "No data", color: "#64748b", bg: "rgba(100,116,139,0.10)" },
};

/**
 * Large Core-Web-Vitals summary tile. Big metric number, verdict pill, and a
 * subtle sparkline showing 30d trend. Meant for the CWV hero row.
 */
export default function CwvTile({ label, display, verdict, spark, caption }: Props) {
  const v = VERDICT[verdict];
  return (
    <div className="cwv-tile">
      <div className="cwv-tile-head">
        <span className="cwv-tile-label">{label}</span>
        <span className="cwv-tile-verdict" style={{ color: v.color, background: v.bg, borderColor: v.color + "40" }}>
          {v.label}
        </span>
      </div>
      <div className="cwv-tile-value" style={{ color: v.color }}>
        {display}
      </div>
      <div className="cwv-tile-foot">
        <span className="muted small">{caption ?? " "}</span>
        <div style={{ marginLeft: "auto" }}>
          <Sparkline points={spark} color={v.color} width={100} height={28} fill />
        </div>
      </div>
    </div>
  );
}
