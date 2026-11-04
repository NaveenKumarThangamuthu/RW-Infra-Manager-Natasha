"use client";
import { useState } from "react";
import { money } from "./format";

interface Point { date: string; amount: number }
interface Props { points: Point[] }

/**
 * Daily-spend bar chart with hover tooltip, y-axis ticks, and (when enough
 * baseline points exist) MAD-based anomaly highlighting. SVG-only, no chart
 * library dependency.
 */
function formatYTick(v: number): string {
  if (v <= 0) return "$0";
  if (v >= 1000) return `$${Math.round(v / 100) / 10}k`;
  if (v >= 100) return `$${Math.round(v)}`;
  if (v >= 10) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(2)}`;
}

export default function DailyTrend({ points }: Props) {
  const [hover, setHover] = useState<{ x: number; y: number; p: Point } | null>(null);

  if (points.length === 0) {
    return <div className="empty">No daily cost data.</div>;
  }

  const W = 100;
  const H = 100;
  const PAD_TOP = 6;
  const PAD_BOTTOM = 14;
  const PAD_LEFT = 26;
  const PAD_RIGHT = 6;

  const max = Math.max(1, ...points.map((p) => p.amount));
  // Spike detection requires at least 4 baseline points; otherwise skip it.
  const enableSpikes = points.length >= 4;
  let sigma = 1;
  let median = 0;
  if (enableSpikes) {
    const sorted = [...points].map((p) => p.amount).sort((a, b) => a - b);
    median = sorted[Math.floor(sorted.length / 2)];
    const dev = points.map((p) => Math.abs(p.amount - median)).sort((a, b) => a - b);
    const mad = dev[Math.floor(dev.length / 2)];
    // sigma ≈ 1.4826 * MAD; floor relative to the median, not absolute, so
    // small-spend accounts don't see every bar painted as a "spike".
    sigma = Math.max(mad * 1.4826, Math.max(0.05, median * 0.2));
  }

  const innerW = W - PAD_LEFT - PAD_RIGHT;
  const innerH = H - PAD_TOP - PAD_BOTTOM;
  const barW = innerW / points.length;
  const niceMax = Math.max(1, max * 1.05);

  const yTicks = [0, niceMax * 0.25, niceMax * 0.5, niceMax * 0.75, niceMax].map((v) => ({
    v,
    y: PAD_TOP + innerH - (v / niceMax) * innerH,
  }));

  // X-axis tick visibility — pick a stride so we render up to ~8 labels.
  const stride = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div className="daily-trend">
      <div className="dt-wrap" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="dt-svg">
          {yTicks.map((t, i) => (
            <line key={i} x1={PAD_LEFT} y1={t.y} x2={W - PAD_RIGHT} y2={t.y} className="dt-grid" />
          ))}
          {points.map((p, i) => {
            const h = (p.amount / niceMax) * innerH;
            const x = PAD_LEFT + i * barW + barW * 0.15;
            const w = barW * 0.7;
            const y = PAD_TOP + innerH - h;
            const z = enableSpikes ? (p.amount - median) / sigma : 0;
            const isSpike = enableSpikes && z >= 2 && p.amount > median + 1;
            // Hover position as percentage along the panel (not SVG coords);
            // clamp horizontal between 6% and 94% so tooltip never clips.
            const hoverXPct = Math.min(94, Math.max(6, ((x + w / 2) / W) * 100));
            const hoverYPct = (y / H) * 100;
            return (
              <g key={p.date} onMouseEnter={() => setHover({ x: hoverXPct, y: hoverYPct, p })}>
                <rect
                  x={x} y={y} width={w} height={Math.max(0.5, h)} rx={0.6}
                  className={`dt-bar ${isSpike ? "dt-bar-spike" : ""}`}
                />
              </g>
            );
          })}
        </svg>
        {/* Y-axis labels — preserved decimals via formatYTick */}
        <div className="dt-yaxis">
          {yTicks.slice().reverse().map((t, i) => (
            <div key={i} className="dt-ytick" style={{ top: `${t.y}%` }}>
              {formatYTick(t.v)}
            </div>
          ))}
        </div>
        {/* Hover tooltip — clamped */}
        {hover && (
          <div className="dt-tooltip" style={{ left: `${hover.x}%`, top: `${hover.y}%` }}>
            <div className="dt-tt-date">{hover.p.date}</div>
            <div className="dt-tt-val tab-num">{money(hover.p.amount)}</div>
          </div>
        )}
      </div>
      {/* X-axis labels — absolute-positioned so hidden ticks don't take a slot */}
      <div className="dt-xaxis">
        {points.map((p, i) => {
          if (i % stride !== 0) return null;
          // Centre on the corresponding bar in the SVG coord space, then map to %.
          const x = PAD_LEFT + i * barW + barW * 0.5;
          const left = (x / W) * 100;
          return (
            <span key={p.date} className="dt-xtick" style={{ left: `${left}%` }}>
              {p.date.slice(5)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
