"use client";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

interface Props {
  /** Current value. */
  current: number | null;
  /** Comparison value (older). */
  previous: number | null;
  /** true when "higher is better" (e.g. perf score). false for latency metrics (LCP/CLS/TBT). */
  higherIsBetter: boolean;
  /** Suffix for the numeric delta (e.g. "pts", "s", "ms", ""). */
  unit?: string;
  /** Decimals for the delta value. Default 0. */
  decimals?: number;
  /** Comparison window label, e.g. "vs 7d". */
  label?: string;
}

/**
 * Inline delta indicator: coloured arrow + magnitude + a "vs …" caption.
 * Green = improved (in the higherIsBetter direction), red = regressed, grey = flat.
 */
export default function Delta({ current, previous, higherIsBetter, unit = "", decimals = 0, label }: Props) {
  if (current === null || previous === null || previous === 0) {
    return <span className="delta delta--flat"><Minus size={11} /> —</span>;
  }
  const diff = current - previous;
  const improved = higherIsBetter ? diff > 0 : diff < 0;
  const regressed = higherIsBetter ? diff < 0 : diff > 0;
  const magnitude = Math.abs(diff);
  const eps = 0.0001;
  const flat = magnitude < eps || (Math.abs(diff / previous) < 0.005 && magnitude < 1);

  const color = flat ? "#7c8aa5" : improved ? "#22c55e" : regressed ? "#ef4444" : "#7c8aa5";
  const Icon = flat ? Minus : improved ? ArrowUp : ArrowDown;
  const shown = magnitude >= 1 ? magnitude.toFixed(decimals) : magnitude.toFixed(Math.max(decimals, 2));

  return (
    <span className="delta" style={{ color }} title={`Current ${current}, previous ${previous}`}>
      <Icon size={11} strokeWidth={2.5} />
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
        {shown}{unit}
      </span>
      {label ? <span className="delta-label muted small">{label}</span> : null}
    </span>
  );
}
