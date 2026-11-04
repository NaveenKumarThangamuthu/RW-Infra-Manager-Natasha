"use client";
import { useMemo } from "react";
import { useJson } from "@/components/useJson";
import { money } from "@/components/format";
import { TrendingUp, Sparkles } from "lucide-react";
import ForecastAccuracy from "@/components/ForecastAccuracy";

interface SummaryResp {
  isCurrentMonth: boolean;
  mtdTotal: number;
  projectedMonth: number | null;
  forecastRest: number | null;
  prev?: { month: string; total: number };
  trend: Array<{ date: string; amount: number }>;
}
interface AllocResp { byCategory?: Record<string, number> }

const CAT_ORDER: Array<{ key: string; label: string; color: string }> = [
  { key: "2.0", label: "2.0", color: "#38bdf8" },
  { key: "3.0", label: "3.0", color: "#a78bfa" },
  { key: "Infra", label: "Infra", color: "#f59e0b" },
  { key: "Dev", label: "Dev", color: "#f472b6" },
  { key: "Shared", label: "Shared", color: "#34d399" },
];

function FanChart({ series, projected, high, low }: { series: number[]; projected: number; high: number; low: number }) {
  if (series.length < 2) return null;
  const w = 640, h = 220;
  const allValues = [...series, projected, high, low];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = Math.max(0.0001, max - min);
  const xStep = w / (series.length + 4);
  const scaleY = (v: number) => h - ((v - min) / span) * (h - 20) - 10;
  const pts = series.map((v, i) => [i * xStep, scaleY(v)] as const);
  const proj = [(series.length + 3) * xStep, scaleY(projected)] as const;
  const hi = [(series.length + 3) * xStep, scaleY(high)] as const;
  const lo = [(series.length + 3) * xStep, scaleY(low)] as const;
  const midX = (pts[pts.length - 1][0] + proj[0]) / 2;
  const midY = (pts[pts.length - 1][1] + proj[1]) / 2;

  const linePath = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const projPath = `${linePath} L${midX},${midY} L${proj[0]},${proj[1]}`;
  const fanPath = `M${pts[pts.length - 1][0]},${pts[pts.length - 1][1]} L${hi[0]},${hi[1]} L${lo[0]},${lo[1]} Z`;

  return (
    <svg width={w} height={h} className="forecast-fan-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="fan-fill" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id="line-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a5b4fc" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#a5b4fc" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Area fill under actual series */}
      <path d={`${linePath} L${pts[pts.length - 1][0]},${h} L0,${h} Z`} fill="url(#line-fill)" />
      {/* Fan (high/low bounds beyond today) */}
      <path d={fanPath} fill="url(#fan-fill)" stroke="#a78bfa" strokeWidth="0.5" strokeOpacity="0.4" />
      {/* Actual line */}
      <path d={linePath} fill="none" stroke="#c4b5fd" strokeWidth="2" />
      {/* Projected dashed line */}
      <path d={`M${pts[pts.length - 1][0]},${pts[pts.length - 1][1]} L${proj[0]},${proj[1]}`}
        fill="none" stroke="#f472b6" strokeWidth="2" strokeDasharray="4 4" />
      {/* Projection dot */}
      <circle cx={proj[0]} cy={proj[1]} r="4" fill="#f472b6" />
      {/* High/low endpoint markers */}
      <circle cx={hi[0]} cy={hi[1]} r="2" fill="#a78bfa" opacity="0.6" />
      <circle cx={lo[0]} cy={lo[1]} r="2" fill="#a78bfa" opacity="0.6" />
    </svg>
  );
}

export default function ForecastPage() {
  const { data: summary } = useJson<SummaryResp>("/api/cost/summary");
  const { data: alloc } = useJson<AllocResp>("/api/cost/allocation");

  const projected = summary?.forecastRest ?? summary?.projectedMonth ?? 0;
  const trend = summary?.trend ?? [];

  // Simple high/low bounds: ±15% of projected as a first-cut confidence band.
  const high = projected * 1.15;
  const low = projected * 0.85;

  const deltaVsPrev = summary?.prev?.total && summary.prev.total > 0
    ? ((projected - summary.prev.total) / summary.prev.total) * 100
    : null;

  const confidence = useMemo(() => {
    // Rough confidence: if we have >= 15 days of trend, high. 7-14: med. <7: low.
    if (trend.length >= 15) return { label: "high", color: "#6ee7b7" };
    if (trend.length >= 7) return { label: "medium", color: "#facc15" };
    return { label: "low", color: "#fca5a5" };
  }, [trend.length]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title"><TrendingUp size={22} className="ico-inline" /> Forecast &amp; Trends</h1>
          <p className="page-sub">Where the current month is headed, plus how well recent forecasts have tracked reality.</p>
        </div>
      </div>

      <div className="cards">
        <div className="card kpi kpi-accent">
          <div className="label">Projected end of month</div>
          <div className="value tab-num">{money(projected)}</div>
          {deltaVsPrev != null && (
            <div className="kpi-foot muted small">
              {deltaVsPrev > 0 ? "+" : ""}{deltaVsPrev.toFixed(1)}% vs {summary?.prev?.month}
            </div>
          )}
        </div>
        <div className="card kpi">
          <div className="label">Confidence</div>
          <div className="value tab-num" style={{ color: confidence.color, fontSize: 22, textTransform: "capitalize" }}>{confidence.label}</div>
          <div className="kpi-foot muted small">{trend.length} day{trend.length === 1 ? "" : "s"} of history</div>
        </div>
        <div className="card kpi">
          <div className="label">Upper bound (+15%)</div>
          <div className="value tab-num">{money(high)}</div>
          <div className="kpi-foot muted small">worst-case if trend accelerates</div>
        </div>
        <div className="card kpi">
          <div className="label">Lower bound (−15%)</div>
          <div className="value tab-num">{money(low)}</div>
          <div className="kpi-foot muted small">best-case if trend decelerates</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Projection fan</h2>
          <span className="chip">actual → projected → high/low</span>
        </div>
        <div className="forecast-fan-wrap">
          {trend.length >= 2 ? (
            <FanChart series={trend.map((t) => t.amount)} projected={projected} high={high} low={low} />
          ) : (
            <div className="empty">Not enough history for a fan chart yet.</div>
          )}
        </div>
        <div className="forecast-fan-legend muted small">
          <span className="forecast-legend-line forecast-legend-actual" /> Actual daily spend &nbsp;·&nbsp;
          <span className="forecast-legend-line forecast-legend-projected" /> Projected end of month &nbsp;·&nbsp;
          <span className="forecast-legend-fan" /> ±15% confidence band
        </div>
      </div>

      <ForecastAccuracy />

      <div className="panel">
        <div className="panel-head">
          <h2>Projected split by category</h2>
          <span className="chip">EOM</span>
        </div>
        {alloc?.byCategory ? (
          <div className="cat-tiles">
            {CAT_ORDER.map((c) => {
              const spent = alloc.byCategory![c.key] ?? 0;
              const daysElapsed = new Date().getDate();
              const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
              const proj = daysElapsed > 0 ? (spent / daysElapsed) * daysInMonth : 0;
              return (
                <div key={c.key} className="cat-tile" style={{ borderColor: `${c.color}30`, textDecoration: "none" }}>
                  <div className="cat-tile-head">
                    <span className="cat-swatch-dot" style={{ background: c.color }} />
                    <span className="cat-tile-label">{c.label}</span>
                  </div>
                  <div className="cat-tile-spend" style={{ color: c.color }}>{money(proj)}</div>
                  <div className="cat-tile-blurb">actual {money(spent)} MTD</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty">Loading category split…</div>
        )}
      </div>

      <div className="fable-triage" style={{ marginTop: 18 }}>
        <div className="fable-triage-head"><Sparkles size={13} /> Fable outlook <span className="model-chip">claude-fable-5</span></div>
        <div className="fable-triage-fix">
          {trend.length < 7
            ? "Not enough data to give a confident outlook yet — projection uses a straight-line extrapolation for now."
            : deltaVsPrev != null && deltaVsPrev > 15
              ? `Projected to end ${deltaVsPrev.toFixed(0)}% above last month. Investigate the biggest anomaly on the home dashboard before the trend hardens.`
              : deltaVsPrev != null && deltaVsPrev < -10
                ? `Projected ${Math.abs(deltaVsPrev).toFixed(0)}% below last month — good work. Confirm nothing critical went offline.`
                : `Steady month — projection tracks within 15% of the previous month.`}
        </div>
      </div>
    </>
  );
}
