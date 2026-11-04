"use client";
import { useEffect, useState, useMemo } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { useJson } from "./useJson";
import { money } from "./format";

interface SeriesRow { date: string; [category: string]: string | number }
interface Resp {
  ok: boolean;
  days: number;
  categories: string[];
  series: SeriesRow[];
  totals: Record<string, number>;
  grandTotal: number;
  since: string;
}

const CAT_COLORS: Record<string, string> = {
  "2.0": "#38bdf8",
  "3.0": "#a78bfa",
  Infra: "#f59e0b",
  Dev: "#f472b6",
  Shared: "#34d399",
  "Not using": "#64748b",
  Other: "#94a3b8",
};

const DAY_OPTIONS = [7, 14, 30, 60, 90] as const;
type DayOption = typeof DAY_OPTIONS[number];

const DEFAULT_ENABLED = new Set(["2.0", "3.0"]);

function formatY(v: number): string {
  if (v <= 0) return "$0";
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  if (v >= 100) return `$${Math.round(v)}`;
  if (v >= 10) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(2)}`;
}

/**
 * Multi-series daily spend chart, grouped by category (2.0 / 3.0 / Infra / Dev / …).
 * Interactive: category toggles, date-range picker (7/14/30/60/90 days), maximize.
 */
export default function CategoryDailyChart() {
  const [days, setDays] = useState<DayOption>(30);
  const [enabled, setEnabled] = useState<Set<string>>(new Set(DEFAULT_ENABLED));
  const [maximized, setMaximized] = useState(false);
  const { data, loading, error } = useJson<Resp>(`/api/cost/daily-by-category?days=${days}`);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && maximized) setMaximized(false);
    }
    if (maximized) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized]);

  const visibleCats = useMemo(
    () => (data?.categories ?? []).filter((c) => enabled.has(c)),
    [data, enabled],
  );

  function toggle(cat: string) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  const chartBody = (
    <div className={`cdc ${maximized ? "cdc-max" : ""}`}>
      <div className="cdc-head">
        <div>
          <h2 className="cdc-title">Daily spend by category</h2>
          <p className="cdc-sub muted small">
            {loading && !data ? "Loading…"
              : data ? `${data.series.length} day${data.series.length === 1 ? "" : "s"} · from ${data.since} · total ${money(data.grandTotal)}`
              : "—"}
          </p>
        </div>
        <div className="cdc-controls">
          <div className="cdc-range" role="group" aria-label="Date range">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                className={days === d ? "active" : ""}
                onClick={() => setDays(d)}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn-ghost cdc-max-btn"
            onClick={() => setMaximized((v) => !v)}
            aria-label={maximized ? "Exit fullscreen" : "Maximize chart"}
            title={maximized ? "Exit fullscreen (Esc)" : "Maximize (press Esc to exit)"}
          >
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {maximized ? "Exit" : "Maximize"}
          </button>
          {maximized && (
            <button
              type="button"
              className="drawer-close cdc-close"
              onClick={() => setMaximized(false)}
              aria-label="Close fullscreen"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="cdc-legend" role="group" aria-label="Category toggles">
        {(data?.categories ?? []).map((cat) => {
          const active = enabled.has(cat);
          const total = data?.totals?.[cat] ?? 0;
          return (
            <button
              key={cat}
              type="button"
              className={`cdc-legend-item ${active ? "on" : "off"}`}
              onClick={() => toggle(cat)}
              aria-pressed={active}
            >
              <span className="cdc-legend-dot" style={{ background: CAT_COLORS[cat] ?? "#94a3b8", opacity: active ? 1 : 0.3 }} />
              <span className="cdc-legend-label">{cat}</span>
              {data && <span className="cdc-legend-total tab-num muted small">{money(total)}</span>}
            </button>
          );
        })}
      </div>

      <div className="cdc-plot">
        {error ? (
          <div className="empty">Could not load category daily spend.</div>
        ) : loading && !data ? (
          <div className="skel skel-donut" style={{ height: maximized ? "70vh" : 320 }} />
        ) : !data || data.series.length === 0 ? (
          <div className="empty">No per-instance daily cost data yet. Run a refresh to populate.</div>
        ) : (
          <CategorySvg series={data.series} categories={visibleCats} maximized={maximized} />
        )}
      </div>
    </div>
  );

  if (maximized) {
    return (
      <>
        <div className="drawer-scrim" onClick={() => setMaximized(false)} aria-hidden />
        <div className="cdc-modal" role="dialog" aria-modal="true" aria-label="Daily spend chart fullscreen">
          {chartBody}
        </div>
      </>
    );
  }

  return <div className="panel cdc-panel">{chartBody}</div>;
}

/* -------------------- SVG chart -------------------- */

function CategorySvg({ series, categories, maximized }: { series: SeriesRow[]; categories: string[]; maximized: boolean }) {
  const [hover, setHover] = useState<{ i: number; x: number } | null>(null);
  const W = 100;
  const H = maximized ? 60 : 100;
  const PAD_TOP = 6;
  const PAD_BOTTOM = 14;
  const PAD_LEFT = 26;
  const PAD_RIGHT = 6;

  const max = Math.max(
    1,
    ...series.flatMap((row) => categories.map((c) => Number(row[c] ?? 0))),
  );
  const niceMax = Math.max(1, max * 1.1);

  const innerW = W - PAD_LEFT - PAD_RIGHT;
  const innerH = H - PAD_TOP - PAD_BOTTOM;
  const stepX = series.length > 1 ? innerW / (series.length - 1) : 0;

  const yTicks = [0, niceMax * 0.25, niceMax * 0.5, niceMax * 0.75, niceMax].map((v) => ({
    v,
    y: PAD_TOP + innerH - (v / niceMax) * innerH,
  }));

  function xAt(i: number): number { return PAD_LEFT + i * stepX; }
  function yAt(v: number): number { return PAD_TOP + innerH - (v / niceMax) * innerH; }

  const xStride = Math.max(1, Math.ceil(series.length / (maximized ? 12 : 8)));

  return (
    <div className={`cdc-svg-wrap ${maximized ? "cdc-svg-wrap-max" : ""}`} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="cdc-svg">
        {yTicks.map((t, i) => (
          <line key={i} x1={PAD_LEFT} y1={t.y} x2={W - PAD_RIGHT} y2={t.y} className="dt-grid" />
        ))}
        {/* Per-category polyline */}
        {categories.map((cat) => {
          const color = CAT_COLORS[cat] ?? "#94a3b8";
          const pts = series.map((row, i) => `${xAt(i)},${yAt(Number(row[cat] ?? 0))}`).join(" ");
          return <polyline key={cat} points={pts} className="cdc-line" style={{ stroke: color }} />;
        })}
        {/* Hover crosshair */}
        {hover && (
          <line x1={xAt(hover.i)} y1={PAD_TOP} x2={xAt(hover.i)} y2={PAD_TOP + innerH} className="cdc-hover-line" />
        )}
        {/* Invisible hit rects for hover */}
        {series.map((row, i) => {
          const x1 = i === 0 ? PAD_LEFT : xAt(i) - stepX / 2;
          const w = i === 0 || i === series.length - 1 ? stepX / 2 : stepX;
          return (
            <rect
              key={row.date + i}
              x={x1} y={PAD_TOP} width={w} height={innerH}
              className="cdc-hit"
              onMouseEnter={() => setHover({ i, x: xAt(i) })}
            />
          );
        })}
        {/* Point markers on hover */}
        {hover && categories.map((cat) => {
          const v = Number(series[hover.i][cat] ?? 0);
          return (
            <circle
              key={cat}
              cx={xAt(hover.i)}
              cy={yAt(v)}
              r={0.9}
              className="cdc-point"
              style={{ fill: CAT_COLORS[cat] ?? "#94a3b8" }}
            />
          );
        })}
      </svg>

      {/* Y-axis labels */}
      <div className="cdc-yaxis">
        {yTicks.slice().reverse().map((t, i) => (
          <div key={i} className="dt-ytick" style={{ top: `${t.y}%` }}>
            {formatY(t.v)}
          </div>
        ))}
      </div>

      {/* X-axis labels */}
      <div className="dt-xaxis">
        {series.map((row, i) => {
          if (i % xStride !== 0) return null;
          const left = (xAt(i) / W) * 100;
          return (
            <span key={row.date} className="dt-xtick" style={{ left: `${left}%` }}>
              {String(row.date).slice(5)}
            </span>
          );
        })}
      </div>

      {/* Hover tooltip */}
      {hover && series[hover.i] && (
        <div
          className="cdc-tooltip"
          style={{ left: `${Math.min(90, Math.max(10, (hover.x / W) * 100))}%`, top: "6%" }}
        >
          <div className="cdc-tt-date">{String(series[hover.i].date)}</div>
          {categories.map((cat) => (
            <div key={cat} className="cdc-tt-row">
              <span className="cdc-tt-dot" style={{ background: CAT_COLORS[cat] ?? "#94a3b8" }} />
              <span className="cdc-tt-cat">{cat}</span>
              <span className="cdc-tt-val tab-num">{money(Number(series[hover.i][cat] ?? 0))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
