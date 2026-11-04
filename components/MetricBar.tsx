"use client";

interface Props {
  /** Metric key — drives thresholds and label formatting. */
  metric: "lcp" | "fcp" | "tbt" | "cls" | "inp" | "si";
  /** Value in the metric's native units (ms for LCP/FCP/TBT/INP/SI, unitless CLS). */
  value: number | null;
  /** Optional label override. Default derives from `metric`. */
  label?: string;
}

interface Thresholds {
  good: number;
  poor: number;
  /** Upper bound of the axis for the visual bar. */
  axisMax: number;
  unit: "ms" | "s" | "score";
  label: string;
}

const CFG: Record<Props["metric"], Thresholds> = {
  lcp: { good: 2500, poor: 4000, axisMax: 8000, unit: "s", label: "LCP" },
  fcp: { good: 1800, poor: 3000, axisMax: 6000, unit: "s", label: "FCP" },
  tbt: { good: 200, poor: 600, axisMax: 1500, unit: "ms", label: "TBT" },
  cls: { good: 0.1, poor: 0.25, axisMax: 0.6, unit: "score", label: "CLS" },
  inp: { good: 200, poor: 500, axisMax: 1000, unit: "ms", label: "INP" },
  si: { good: 3400, poor: 5800, axisMax: 10000, unit: "s", label: "SI" },
};

function fmt(v: number | null, u: Thresholds["unit"]): string {
  if (v === null) return "—";
  if (u === "s") return v >= 1000 ? (v / 1000).toFixed(2) + "s" : Math.round(v) + "ms";
  if (u === "ms") return Math.round(v) + "ms";
  return v.toFixed(3);
}

/**
 * Horizontal CWV metric bar with good/needs-improvement/poor threshold zones,
 * a value marker, and the numeric readout inline. Reads like a mini gauge —
 * useful to show "this LCP sits in the red zone" at a glance.
 */
export default function MetricBar({ metric, value, label }: Props) {
  const cfg = CFG[metric];
  const disp = label ?? cfg.label;
  const has = value !== null;
  const clamped = has ? Math.max(0, Math.min(cfg.axisMax, value)) : 0;
  const pct = has ? (clamped / cfg.axisMax) * 100 : 0;
  const goodPct = (cfg.good / cfg.axisMax) * 100;
  const poorPct = (cfg.poor / cfg.axisMax) * 100;

  const state = !has
    ? "unknown"
    : value <= cfg.good
      ? "good"
      : value <= cfg.poor
        ? "warn"
        : "poor";
  const valueColor =
    state === "good" ? "#22c55e" : state === "warn" ? "#f59e0b" : state === "poor" ? "#ef4444" : "#64748b";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          fontWeight: 600,
        }}
      >
        <span>{disp}</span>
        <span style={{ color: valueColor, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
          {fmt(value, cfg.unit)}
        </span>
      </div>
      <div
        style={{
          position: "relative",
          height: 6,
          borderRadius: 3,
          background: "#1e293b",
          overflow: "hidden",
        }}
        role="progressbar"
        aria-valuenow={has ? Math.round(clamped) : undefined}
        aria-valuemin={0}
        aria-valuemax={cfg.axisMax}
        aria-label={disp}
      >
        <span
          style={{
            position: "absolute",
            left: 0,
            width: `${goodPct}%`,
            top: 0,
            bottom: 0,
            background: "rgba(34,197,94,0.16)",
          }}
        />
        <span
          style={{
            position: "absolute",
            left: `${goodPct}%`,
            width: `${poorPct - goodPct}%`,
            top: 0,
            bottom: 0,
            background: "rgba(245,158,11,0.16)",
          }}
        />
        <span
          style={{
            position: "absolute",
            left: `${poorPct}%`,
            right: 0,
            top: 0,
            bottom: 0,
            background: "rgba(239,68,68,0.16)",
          }}
        />
        {has ? (
          <span
            style={{
              position: "absolute",
              left: `calc(${pct}% - 3px)`,
              top: -2,
              bottom: -2,
              width: 6,
              borderRadius: 2,
              background: valueColor,
              boxShadow: "0 0 0 2px rgba(15,23,42,0.9)",
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
