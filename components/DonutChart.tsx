"use client";
import { money } from "./format";

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface Props {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
}

/**
 * Dependency-free SVG donut chart with a centered total and a side legend
 * showing each segment's value and share. Segments with value <= 0 are ignored.
 */
export default function DonutChart({ segments, size = 220, thickness = 30, centerLabel, centerSub }: Props) {
  const positive = segments.filter((s) => s.value > 0);
  const total = positive.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const center = size / 2;

  let acc = 0;

  return (
    <div className="donut">
      <div className="donut-svg-wrap" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Cost split donut chart">
          <g transform={`rotate(-90 ${center} ${center})`}>
            <circle cx={center} cy={center} r={r} fill="none" stroke="var(--border)" strokeWidth={thickness} opacity={0.35} />
            {total > 0 &&
              positive.map((s) => {
                const frac = s.value / total;
                const len = frac * c;
                // tiny gap between segments for a crisper look
                const gap = positive.length > 1 ? Math.min(2, len * 0.04) : 0;
                const dash = `${Math.max(0, len - gap)} ${c - Math.max(0, len - gap)}`;
                const offset = -acc * c;
                acc += frac;
                return (
                  <circle
                    key={s.label}
                    cx={center}
                    cy={center}
                    r={r}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={thickness}
                    strokeDasharray={dash}
                    strokeDashoffset={offset}
                    strokeLinecap="butt"
                  />
                );
              })}
          </g>
        </svg>
        <div className="donut-center">
          <div className="donut-center-value">{centerLabel ?? money(total)}</div>
          {centerSub && <div className="donut-center-sub">{centerSub}</div>}
        </div>
      </div>

      <ul className="donut-legend">
        {positive
          .slice()
          .sort((a, b) => b.value - a.value)
          .map((s) => {
            const share = total > 0 ? (s.value / total) * 100 : 0;
            return (
              <li key={s.label}>
                <span className="donut-dot" style={{ background: s.color }} />
                <span className="donut-legend-label">{s.label}</span>
                <span className="donut-legend-pct">{share.toFixed(1)}%</span>
                <span className="donut-legend-val">{money(s.value)}</span>
              </li>
            );
          })}
        {total <= 0 && <li className="empty">No tagged cost yet.</li>}
      </ul>
    </div>
  );
}
