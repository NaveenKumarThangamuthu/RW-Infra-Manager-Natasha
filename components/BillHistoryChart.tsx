"use client";
import { useJson } from "./useJson";
import { money } from "./format";

interface MonthlyResp { series?: Array<{ month: string; amount: number }> }

export default function BillHistoryChart() {
  const { data, error, loading } = useJson<MonthlyResp>("/api/cost/monthly-total");

  if (loading) return <div className="panel"><div className="skel skel-donut" /></div>;
  if (error) return null;
  const series = data?.series ?? [];
  if (series.length < 2) return null;

  const w = 900, h = 220;
  const values = series.map((p) => p.amount);
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = Math.max(0.0001, max - min);
  const xStep = w / (series.length - 1);
  const scaleY = (v: number) => h - ((v - min) / span) * (h - 26) - 14;
  const pts = series.map((p, i) => [i * xStep, scaleY(p.amount)] as const);

  const linePath = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${pts[pts.length - 1][0]},${h} L0,${h} Z`;

  const total12mo = values.reduce((a, b) => a + b, 0);
  const avg = total12mo / values.length;
  const latest = values[values.length - 1];
  const deltaMoM = values.length >= 2 && values[values.length - 2] > 0
    ? ((latest - values[values.length - 2]) / values[values.length - 2]) * 100
    : null;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>12-month history</h2>
        <span className="chip">total {money(total12mo)} · avg {money(avg)}/mo · latest {money(latest)}{deltaMoM != null ? ` (${deltaMoM > 0 ? "+" : ""}${deltaMoM.toFixed(1)}% MoM)` : ""}</span>
      </div>
      <div className="bill-history-wrap">
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="bill-history-svg" aria-hidden>
          <defs>
            <linearGradient id="bill-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.55" />
              <stop offset="55%" stopColor="#8b5cf6" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="bill-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#a5b4fc" />
              <stop offset="100%" stopColor="#f472b6" />
            </linearGradient>
          </defs>
          {/* grid lines */}
          {[0.25, 0.5, 0.75].map((frac) => (
            <line key={frac} x1={0} x2={w} y1={h - frac * (h - 26) - 14} y2={h - frac * (h - 26) - 14}
              stroke="rgba(148,163,184,0.10)" strokeDasharray="3 6" />
          ))}
          <path d={areaPath} fill="url(#bill-fill)" />
          <path d={linePath} fill="none" stroke="url(#bill-line)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {pts.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 4 : 2} fill={i === pts.length - 1 ? "#f472b6" : "#c4b5fd"} />
          ))}
        </svg>
        <div className="bill-history-labels">
          {series.map((p, i) => (
            <div key={p.month} className="bill-history-label" style={{ left: `${(i / (series.length - 1)) * 100}%` }} title={`${p.month}: ${money(p.amount)}`}>
              {p.month.slice(5)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
