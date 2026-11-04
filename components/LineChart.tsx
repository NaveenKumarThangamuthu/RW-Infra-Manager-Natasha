"use client";
import { useRef, useState } from "react";
import { money } from "./format";

export interface LineSeries {
  label: string;
  color: string;
  values: number[]; // aligned to labels
}

interface Props {
  labels: string[];
  series: LineSeries[];
  height?: number;
}

interface Hover {
  index: number;
  rectW: number;
  rectH: number;
}

/** Responsive multi-series SVG line chart with grid, legend and an interactive
 *  hover tooltip (works with mouse and touch). No chart library. */
export default function LineChart({ labels, series, height = 260 }: Props) {
  const W = 760;
  const H = height;
  const padL = 64, padR = 16, padT = 16, padB = 34;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const allVals = series.flatMap((s) => s.values);
  const maxY = Math.max(1, ...allVals);
  const minY = Math.min(0, ...allVals);
  const n = labels.length;

  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - ((v - minY) / (maxY - minY || 1)) * innerH;

  const steps = 4;
  const gridVals = Array.from({ length: steps + 1 }, (_, i) => minY + ((maxY - minY) * i) / steps);
  const labelEvery = Math.max(1, Math.ceil(n / 6));

  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  function locate(clientX: number) {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vbX = ((clientX - rect.left) / rect.width) * W;
    let idx = 0, best = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(x(i) - vbX);
      if (d < best) { best = d; idx = i; }
    }
    setHover({ index: idx, rectW: rect.width, rectH: rect.height });
  }

  const tipLeft = hover ? (x(hover.index) / W) * hover.rectW : 0;
  const placeRight = hover ? tipLeft < hover.rectW * 0.6 : true;

  return (
    <div className="linechart">
      <div className="linechart-legend">
        {series.map((s) => (
          <span key={s.label} className="lc-legend-item">
            <span className="lc-swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      <div className="lc-plot">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          onMouseMove={(e) => locate(e.clientX)}
          onMouseLeave={() => setHover(null)}
          onTouchStart={(e) => locate(e.touches[0].clientX)}
          onTouchMove={(e) => locate(e.touches[0].clientX)}
        >
          {gridVals.map((gv, i) => (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y(gv)} y2={y(gv)} stroke="var(--border)" strokeWidth={1} opacity={0.4} />
              <text x={padL - 8} y={y(gv) + 4} textAnchor="end" fontSize={10.5} fill="var(--muted)">{money(gv)}</text>
            </g>
          ))}

          {labels.map((lb, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text key={lb + i} x={x(i)} y={H - 12} textAnchor="middle" fontSize={10.5} fill="var(--muted)">{lb}</text>
            ) : null,
          )}

          {hover && (
            <line x1={x(hover.index)} x2={x(hover.index)} y1={padT} y2={padT + innerH} stroke="var(--accent)" strokeWidth={1} opacity={0.5} strokeDasharray="3 3" />
          )}

          {series.map((s) => {
            const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
            return (
              <g key={s.label}>
                <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                {s.values.map((v, i) => (
                  <circle key={i} cx={x(i)} cy={y(v)} r={hover?.index === i ? 5 : 2.8} fill={s.color}
                    stroke={hover?.index === i ? "#0b1222" : "none"} strokeWidth={hover?.index === i ? 2 : 0} />
                ))}
              </g>
            );
          })}
        </svg>

        {hover && (
          <div
            className="lc-tooltip"
            style={{ left: tipLeft, top: 6, transform: placeRight ? "translateX(10px)" : "translateX(-100%) translateX(-10px)" }}
          >
            <div className="lc-tt-month">{labels[hover.index]}</div>
            {series.map((s) => (
              <div key={s.label} className="lc-tt-row">
                <span className="lc-swatch" style={{ background: s.color }} />
                <span className="lc-tt-label">{s.label}</span>
                <span className="lc-tt-val">{money(s.values[hover.index])}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
