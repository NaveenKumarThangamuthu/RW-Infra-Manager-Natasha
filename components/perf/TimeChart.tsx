"use client";

interface Series {
  label: string;
  points: Array<[number, number]>;
  color?: string;
}

const PALETTE = ["#38bdf8", "#a78bfa", "#34d399", "#f59e0b", "#f472b6", "#22d3ee", "#fb7185", "#fbbf24"];

export default function TimeChart({
  series,
  height = 140,
  yLabel,
  yMax,
  formatY,
  formatX,
}: {
  series: Series[];
  height?: number;
  yLabel?: string;
  yMax?: number;
  formatY?: (v: number) => string;
  formatX?: (ts: number) => string;
}) {
  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length === 0) {
    return (
      <div className="empty" style={{ padding: 18, textAlign: "center" }}>
        No data in this window.
      </div>
    );
  }
  const xMin = Math.min(...allPoints.map((p) => p[0]));
  const xMax = Math.max(...allPoints.map((p) => p[0]));
  const dataMax = Math.max(...allPoints.map((p) => p[1]));
  const dataMin = Math.min(...allPoints.map((p) => p[1]), 0);
  const yHi = yMax !== undefined ? yMax : dataMax === 0 ? 1 : dataMax * 1.08;
  const yLo = Math.min(0, dataMin);
  const w = 720;
  const padL = 50, padR = 12, padT = 8, padB = 22;
  const innerW = w - padL - padR;
  const innerH = height - padT - padB;
  const xScale = (x: number) => padL + ((x - xMin) / (xMax - xMin || 1)) * innerW;
  const yScale = (y: number) => padT + innerH - ((y - yLo) / (yHi - yLo || 1)) * innerH;

  const fmtY = formatY ?? ((v) => v.toFixed(1));
  const fmtX = formatX ?? ((ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));

  // gridlines (4)
  const grid: Array<{ y: number; label: string }> = [];
  for (let i = 0; i <= 4; i++) {
    const v = yLo + ((yHi - yLo) * i) / 4;
    grid.push({ y: yScale(v), label: fmtY(v) });
  }
  // x ticks (5)
  const xTicks: Array<{ x: number; label: string }> = [];
  for (let i = 0; i <= 4; i++) {
    const ts = xMin + ((xMax - xMin) * i) / 4;
    xTicks.push({ x: xScale(ts), label: fmtX(ts) });
  }

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }}>
        {/* grid */}
        {grid.map((g, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={g.y} y2={g.y} stroke="#22324a" strokeDasharray="2 4" />
            <text x={padL - 6} y={g.y + 3} fontSize="10" textAnchor="end" fill="#64748b">{g.label}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={t.x} y={height - 6} fontSize="10" textAnchor="middle" fill="#64748b">{t.label}</text>
        ))}
        {/* lines */}
        {series.map((s, i) => {
          const color = s.color ?? PALETTE[i % PALETTE.length];
          if (s.points.length === 0) return null;
          const d = s.points
            .map(([x, y], j) => `${j === 0 ? "M" : "L"}${xScale(x).toFixed(1)},${yScale(y).toFixed(1)}`)
            .join(" ");
          return <path key={i} d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />;
        })}
        {yLabel && (
          <text x={padL - 38} y={padT + 4} fontSize="10" fill="#64748b" transform={`rotate(-90 ${padL - 38} ${padT + 4})`}>
            {yLabel}
          </text>
        )}
      </svg>
      {series.length > 1 && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, marginTop: 4 }}>
          {series.map((s, i) => (
            <span key={i} style={{ color: s.color ?? PALETTE[i % PALETTE.length] }}>
              ● {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
