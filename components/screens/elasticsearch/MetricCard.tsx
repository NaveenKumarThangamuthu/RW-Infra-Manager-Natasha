"use client";
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { TimeChart } from "@/components/natasha/charts";
import { istLabels, type EsLine } from "./types";

const axis = (v: number) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(".0", "") + "k" : String(+v.toFixed(2)));
/** Narrow-range axes need more precision or every tick reads the same. */
const axisFine = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? `${(v / 1000).toFixed(2)}k` : String(+v.toFixed(2)));

/** Put every line on the x-axis of the longest one; a missing point repeats the previous value (0 at the start). */
function align(lines: EsLine[]) {
  const axisLine = lines.reduce((a, b) => (b.points.length > a.points.length ? b : a));
  const ts = axisLine.points.map(([t]) => t);
  const values = lines.map((l) => {
    const m = new Map(l.points);
    let prev = 0;
    return ts.map((t) => { const v = m.get(t); if (v !== undefined) prev = v; return prev; });
  });
  return { ts, values };
}

export function MetricCard({ title, stat, lines, colors, long, scale = 1, fmt, zero = true, wide }: {
  title: string; stat: string; lines: EsLine[] | null | undefined; colors: string[]; long: boolean;
  scale?: number; fmt: (v: number) => string; zero?: boolean; wide?: boolean;
}) {
  const data = useMemo(() => {
    if (!lines?.length) return null;
    const { ts, values } = align(lines);
    return { ...istLabels(ts, long), series: lines.map((l, i) => ({ name: l.label, color: colors[i % colors.length], values: values[i].map((v) => v / scale) })) };
  }, [lines, colors, long, scale]);

  return (
    <Card className="min-w-0 px-4 pb-3 pt-3.5" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <div className="mb-3 flex justify-between gap-3"><span className="text-[13px] font-semibold">{title}</span><span className="text-right text-[12px] text-muted-foreground tnum">{stat}</span></div>
      {data ? (
        <>
          <TimeChart labels={data.labels} full={data.full} height={110} ticks={4} yTicks={3} zero={zero} area={data.series.length === 1} strokeWidth={1.5} axisWidth={40}
            axisFmt={zero ? axis : axisFine} fmt={fmt} series={data.series} />
          {data.series.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
              {data.series.map((s) => <span key={s.name} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} />{s.name}</span>)}
            </div>
          )}
        </>
      ) : <div className="py-6 text-center text-[12.5px] text-muted-foreground">Prometheus returned no data for this metric. That is not the same as a healthy zero.</div>}
    </Card>
  );
}
