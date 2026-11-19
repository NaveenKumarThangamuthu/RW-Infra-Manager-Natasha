"use client";
import { useId, useState, type ReactNode } from "react";
import { axisUsd, usd } from "./format";

export function niceScale(lo: number, hi: number, count: number) {
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const e = raw / mag;
  const step = (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * mag;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { min, max, ticks };
}

/** Monotone cubic path, so a smoothed line never overshoots its data. */
export function monotonePath(p: Array<[number, number]>): string {
  const n = p.length;
  if (!n) return "";
  if (n === 1) return `M${p[0][0]},${p[0][1]}`;
  if (n === 2) return `M${p[0][0]},${p[0][1]}L${p[1][0]},${p[1][1]}`;
  const dx: number[] = [], m: number[] = [], t: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = p[i + 1][0] - p[i][0];
    m[i] = (p[i + 1][1] - p[i][1]) / dx[i];
  }
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${p[i][0] + h},${p[i][1] + t[i] * h} ${p[i + 1][0] - h},${p[i + 1][1] - t[i + 1] * h} ${p[i + 1][0]},${p[i + 1][1]}`;
  }
  return d;
}

export interface ChartSeries {
  name: string; color: string; values: number[];
  /** Draw this line dashed, so a series lying on top of another stays visible. */
  dashed?: boolean;
  /** Stroke width for this line only; defaults to the chart's strokeWidth. */
  width?: number;
}

const VIEW_W = 1000;

export function TimeChart({
  labels, full, series, height = 240, area, ticks = 7, axisWidth = 44, yTicks = 4,
  fmt = usd, axisFmt = axisUsd, extra, empty = "Select a category to plot.", strokeWidth = 2, zero = true, smooth = true, uniqueTicks = false,
}: {
  labels: string[];
  full?: string[];
  series: ChartSeries[];
  height?: number;
  area?: boolean;
  ticks?: number;
  axisWidth?: number;
  yTicks?: number;
  fmt?: (v: number) => string;
  axisFmt?: (v: number) => string;
  extra?: (i: number) => ReactNode;
  empty?: string;
  strokeWidth?: number;
  /** Include zero on the Y axis; turn off for metrics that sit far from it. */
  zero?: boolean;
  /** Curved line (default). Turn off for counts per bucket, where a curve suggests a gradual change. */
  smooth?: boolean;
  /** Skip an X-axis label that repeats the one before it (for example the same day twice). */
  uniqueTicks?: boolean;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const H = height;
  if (!series.length || !n) {
    return <div className="grid place-items-center text-[13px] text-muted-foreground" style={{ height: H + 26 }}>{empty}</div>;
  }
  const vals = series.flatMap((s) => s.values);
  const sc = zero ? niceScale(Math.min(0, ...vals), Math.max(0, ...vals), yTicks) : niceScale(Math.min(...vals), Math.max(...vals), yTicks);
  const X = (i: number) => (n === 1 ? VIEW_W / 2 : (i / (n - 1)) * VIEW_W);
  const Y = (v: number) => H - ((v - sc.min) / (sc.max - sc.min)) * H;
  const pct = (i: number) => `${(X(i) / VIEW_W) * 100}%`;
  const every = Math.max(1, Math.ceil(n / ticks));
  const xl: number[] = [];
  for (let i = 0; i < n; i += every) xl.push(i);
  // Always end on the last point when it is at least half a step away. The tick before it is
  // dropped rather than kept, otherwise the last two labels sit half a step apart and collide.
  if (n > 1 && n - 1 - xl[xl.length - 1] >= every / 2) {
    if (xl.length > 1) xl.pop();
    xl.push(n - 1);
  }
  const shownTicks = uniqueTicks ? xl.filter((i, k) => k === 0 || labels[i] !== labels[xl[k - 1]]) : xl;
  const base = Y(Math.max(sc.min, 0));
  const hv = hover != null && hover < n ? hover : null;

  return (
    <div className="flex gap-2.5">
      <div className="relative shrink-0" style={{ width: axisWidth, height: H }}>
        {sc.ticks.map((t) => (
          <div key={t} className="absolute right-0 whitespace-nowrap text-[11px] text-muted-foreground tnum" style={{ top: Y(t) - 8 }}>{axisFmt(t)}</div>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height: H }}>
          <svg viewBox={`0 0 ${VIEW_W} ${H}`} preserveAspectRatio="none" width="100%" height={H} className="block overflow-visible">
            <defs>
              {series.map((s, i) => (
                <linearGradient key={i} id={`${id}-${i}`} x1={0} y1={0} x2={0} y2={1}>
                  <stop offset="0%" style={{ stopColor: s.color, stopOpacity: 0.24 }} />
                  <stop offset="100%" style={{ stopColor: s.color, stopOpacity: 0 }} />
                </linearGradient>
              ))}
            </defs>
            {sc.ticks.map((t) => (
              <line key={t} x1={0} x2={VIEW_W} y1={Y(t)} y2={Y(t)} vectorEffect="non-scaling-stroke"
                style={{ stroke: t === 0 ? "var(--border-strong)" : "var(--grid)", strokeWidth: 1 }} />
            ))}
            {series.map((s, i) => {
              const pts = s.values.map((v, j): [number, number] => [X(j), Y(v)]);
              const d = smooth ? monotonePath(pts) : pts.map(([x, y], j) => `${j ? "L" : "M"}${x},${y}`).join("");
              return (
                <g key={s.name}>
                  {area && <path d={`${d}L${VIEW_W},${base}L0,${base}Z`} style={{ fill: `url(#${id}-${i})` }} />}
                  <path d={d} vectorEffect="non-scaling-stroke"
                    style={{ fill: "none", stroke: s.color, strokeWidth: s.width ?? strokeWidth, strokeDasharray: s.dashed ? "5 4" : undefined, strokeLinejoin: "round", strokeLinecap: s.dashed ? "butt" : "round" }} />
                </g>
              );
            })}
            {hv != null && <line x1={X(hv)} x2={X(hv)} y1={0} y2={H} vectorEffect="non-scaling-stroke" style={{ stroke: "var(--border-strong)", strokeWidth: 1 }} />}
          </svg>
          {hv != null && series.map((s) => (
            <div key={s.name} className="pointer-events-none absolute h-[9px] w-[9px] rounded-[9px]"
              style={{ left: pct(hv), top: Y(s.values[hv]), margin: "-4.5px 0 0 -4.5px", background: s.color, boxShadow: "0 0 0 2px var(--card)" }} />
          ))}
          {hv != null && (
            <div className="pointer-events-none absolute top-1 z-[2] min-w-[160px] whitespace-nowrap rounded-[8px] border border-solid border-border bg-popover px-2.5 py-2 text-[12px] shadow-[0_8px_24px_rgba(0,0,0,.18)]"
              style={{ left: pct(hv), transform: hv > (n - 1) / 2 ? "translateX(calc(-100% - 14px))" : "translateX(14px)" }}>
              <div className="mb-1 font-medium">{(full ?? labels)[hv]}</div>
              {series.map((s) => (
                <div key={s.name} className="mt-1 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} />
                  <span className="flex-1 text-muted-foreground">{s.name}</span>
                  <span className="font-medium tnum">{fmt(s.values[hv])}</span>
                </div>
              ))}
              {extra && <div className="mt-1.5 text-muted-foreground">{extra(hv)}</div>}
            </div>
          )}
          <div className="absolute inset-0 cursor-crosshair"
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
            }}
            onMouseLeave={() => setHover(null)} />
        </div>
        <div className="relative mt-2 h-4">
          {shownTicks.map((i) => (
            <div key={i} className="absolute whitespace-nowrap text-[11px] text-muted-foreground"
              style={{ left: pct(i), transform: i === 0 ? "none" : i === n - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>
              {labels[i]}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BarChart({
  labels, values, full, height = 200, gap = 4, color = "var(--brand)", colors, fmt = usd, axisFmt = axisUsd, ticks = 8, axisWidth = 44, yTicks = 4,
}: {
  labels: string[]; values: number[]; full?: string[]; height?: number; gap?: number; color?: string; colors?: string[];
  fmt?: (v: number) => string; axisFmt?: (v: number) => string; ticks?: number; axisWidth?: number; yTicks?: number;
}) {
  const [hv, setHv] = useState<number | null>(null);
  const n = values.length, H = height;
  const sc = niceScale(0, Math.max(...values, 0.0001), yTicks);
  const Y = (x: number) => H - (x / sc.max) * H;
  const every = Math.max(1, Math.ceil(n / ticks));
  return (
    <div className="flex gap-2.5">
      <div className="relative shrink-0" style={{ width: axisWidth, height: H }}>
        {sc.ticks.map((t) => <div key={t} className="absolute right-0 whitespace-nowrap text-[11px] text-muted-foreground tnum" style={{ top: Y(t) - 8 }}>{axisFmt(t)}</div>)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height: H }}>
          {sc.ticks.map((t) => <div key={t} className="absolute inset-x-0 h-px bg-grid" style={{ top: Y(t) }} />)}
          <div className="absolute inset-0 flex items-end" style={{ gap }} onMouseLeave={() => setHv(null)}>
            {values.map((x, i) => (
              <div key={i} className="flex h-full min-w-0 flex-1 items-end" onMouseEnter={() => setHv(i)}>
                <div className="w-full rounded-t-[4px] rounded-b-[2px] transition-opacity duration-100"
                  style={{ height: Math.max(x > 0 ? 2 : 0, (x / sc.max) * H), background: colors?.[i] ?? color, opacity: hv == null || hv === i ? 1 : 0.45 }} />
              </div>
            ))}
          </div>
          {hv != null && (
            <div className="pointer-events-none absolute top-1 z-[3] whitespace-nowrap rounded-[8px] border border-solid border-border bg-popover px-2.5 py-2 text-[12px] shadow-[0_8px_24px_rgba(0,0,0,.18)]"
              style={{ left: `${((hv + 0.5) / n) * 100}%`, transform: hv > (n - 1) / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }}>
              <div className="font-medium">{(full ?? labels)[hv]}</div>
              <div className="mt-1 tnum">{fmt(values[hv])}</div>
            </div>
          )}
        </div>
        <div className="mt-2 flex" style={{ gap }}>
          {labels.map((l, i) => (
            <div key={i} className="flex min-w-0 flex-1 justify-center">
              {i % every === 0 && <span className="whitespace-nowrap text-[11px] text-muted-foreground">{l}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Stretching KPI sparkline with an end-point dot. */
export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const W = 240, H = 34;
  if (values.length < 2) return <div style={{ height: H }} />;
  const mn = Math.min(...values), mx = Math.max(...values), sp = mx - mn || 1;
  const pts = values.map((v, i): [number, number] => [(i / (values.length - 1)) * W, H - 4 - ((v - mn) / sp) * (H - 8)]);
  const d = monotonePath(pts), last = pts[pts.length - 1];
  return (
    <div className="relative" style={{ height: H }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block overflow-visible">
        <path d={`${d}L${W},${H}L0,${H}Z`} style={{ fill: color, opacity: 0.1 }} />
        <path d={d} vectorEffect="non-scaling-stroke" style={{ fill: "none", stroke: color, strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" }} />
      </svg>
      <span className="absolute -right-[3px] h-1.5 w-1.5 rounded-[6px]" style={{ top: last[1] - 3, background: color, boxShadow: "0 0 0 2px var(--card)" }} />
    </div>
  );
}

/** Fixed-size inline sparkline used in table rows. */
export function MiniSpark({ values, color, width = 84, height = 28 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return <span style={{ display: "inline-block", width, height }} />;
  const mn = Math.min(...values), mx = Math.max(...values), sp = mx - mn || 1;
  const pts = values.map((v, i): [number, number] => [(i / (values.length - 1)) * width, height - 3 - ((v - mn) / sp) * (height - 6)]);
  const d = monotonePath(pts), last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block shrink-0 overflow-visible">
      <path d={`${d}L${width},${height}L0,${height}Z`} style={{ fill: color, opacity: 0.12 }} />
      <path d={d} style={{ fill: "none", stroke: color, strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" }} />
      <circle cx={last[0]} cy={last[1]} r={2.5} style={{ fill: color }} />
    </svg>
  );
}

export interface DonutSegment { name: string; v: number; color: string }

export function Donut({ segments, total, label, sub, size = 176, thickness = 16 }: {
  segments: DonutSegment[]; total: number; label: ReactNode; sub?: ReactNode; size?: number; thickness?: number;
}) {
  const c = size / 2, r = c - thickness / 2 - 6, C = 2 * Math.PI * r;
  const live = segments.filter((x) => x.v > 0), gap = live.length > 1 ? 2.5 : 0;
  let acc = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block -rotate-90">
        <circle cx={c} cy={c} r={r} style={{ fill: "none", stroke: "var(--card-2)", strokeWidth: thickness }} />
        {live.map((x) => {
          const len = (x.v / (total || 1)) * C;
          const el = <circle key={x.name} cx={c} cy={c} r={r} strokeDasharray={`${Math.max(0, len - gap)} ${C}`} strokeDashoffset={-acc} style={{ fill: "none", stroke: x.color, strokeWidth: thickness }} />;
          acc += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="font-semibold tracking-[-0.02em] tnum" style={{ fontSize: size > 150 ? 19 : 17 }}>{label}</div>
        {sub && <div className="mt-0.5 text-[11.5px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}
