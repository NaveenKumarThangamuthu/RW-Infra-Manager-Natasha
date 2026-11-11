"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { AlertOctagon, AlertTriangle, ChevronLeft, Info, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { TimeChart } from "@/components/natasha/charts";
import { MONTHS_SHORT, num } from "@/components/natasha/format";
import { ErrorNote, Screen, ScreenSkeleton } from "@/components/natasha/primitives";
import { useJson } from "@/components/useJson";
import { cn, tint } from "@/lib/utils";

interface Series { label: string; unit: string; points: Array<[number, number]> }
interface Stat { avg: number | null; max: number | null; min: number | null; last: number | null }
interface Issue { severity: "critical" | "warning" | "info"; title: string; evidence: string; action: string }
interface Perf {
  id: string; region: string; windowHours: number; fetchedAt: string; engine: string; engineVersion: string; instanceClass: string; status: string;
  allocatedStorageGb: number | null; multiAz: boolean; vcpu: number | null; burstable: boolean; series: Record<string, Series | null>; stats: Record<string, Stat>; issues: Issue[];
}
interface TopQuery { rank: number; digestText: string; countStar: number; sumRowsExamined: number; rowsExaminedPerCall: number; avgLatencyMs: number; fullScanRatio: number | null }
interface Insights { available: boolean; reason?: string; remedy?: string; queries: TopQuery[]; issues: Issue[] }

const GB = 1024 ** 3, MB = 1024 ** 2;
const RANGES = [["3h", 3, "last 3h"], ["6h", 6, "last 6h"], ["1d", 24, "last 24h"], ["3d", 72, "last 3 days"], ["7d", 168, "last 7 days"]] as const;
type RangeKey = (typeof RANGES)[number][0];
const ISSUE_TONE = { critical: { color: "var(--danger)", label: "Critical", icon: AlertOctagon }, warning: { color: "var(--warning)", label: "Warning", icon: AlertTriangle }, info: { color: "var(--info)", label: "Info", icon: Info } };
const axis = (v: number) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(".0", "") + "k" : String(+v.toFixed(2)));
/** Narrow-range axes (memory, credits) need more precision or every tick reads the same. */
const axisFine = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)}k` : String(+v.toFixed(2)));
const IST_MS = 330 * 60_000;

function timeLabels(points: Array<[number, number]>, long: boolean) {
  const p2 = (v: number) => String(v).padStart(2, "0");
  const mk = (ts: number) => { const t = new Date(ts + IST_MS); return { hm: `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`, dd: `${MONTHS_SHORT[t.getUTCMonth()]} ${t.getUTCDate()}` }; };
  return { labels: points.map(([ts]) => { const m = mk(ts); return long ? m.dd : m.hm; }), full: points.map(([ts]) => { const m = mk(ts); return `${m.dd}, ${m.hm} IST`; }) };
}

function Chart({ title, stat, color, series, long, scale = 1, fmt, zero = true, wide }: { title: string; stat: string; color: string; series: Series | null; long: boolean; scale?: number; fmt: (v: number) => string; zero?: boolean; wide?: boolean }) {
  const pts = series?.points ?? [];
  const { labels, full } = timeLabels(pts, long);
  return (
    <Card className="min-w-0 px-4 pb-3 pt-3.5" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <div className="mb-3 flex justify-between gap-3"><span className="text-[13px] font-semibold">{title}</span><span className="text-[12px] text-muted-foreground tnum">{stat}</span></div>
      {pts.length ? (
        <TimeChart labels={labels} full={full} height={110} ticks={4} yTicks={3} zero={zero} area strokeWidth={1.5} axisWidth={40} axisFmt={zero ? axis : axisFine} fmt={fmt}
          series={[{ name: title, color, values: pts.map(([, v]) => v / scale) }]} />
      ) : <div className="py-6 text-center text-[12.5px] text-muted-foreground">CloudWatch returned no datapoints for this metric. That is not the same as a healthy zero.</div>}
    </Card>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const sp = useSearchParams();
  const region = sp.get("region") ?? "us-east-1";
  const [range, setRange] = useState<RangeKey>("1d");
  const hours = RANGES.find((r) => r[0] === range)![1];
  const base = `/api/rds/${encodeURIComponent(params.id)}`;
  const { data, error, loading, reload } = useJson<{ perf: Perf }>(`${base}?region=${encodeURIComponent(region)}&hours=${hours}`);
  const { data: q } = useJson<{ insights: Insights }>(`${base}/queries?region=${encodeURIComponent(region)}`);

  const back = (
    <Link href="/rds" className="inline-flex h-[30px] items-center gap-1.5 self-start rounded-[8px] pl-1.5 pr-2.5 text-[13px] font-medium text-fg-2 no-underline hover:bg-hover hover:text-foreground">
      <ChevronLeft size={14} className="block" />All databases
    </Link>
  );
  if (error) return <Screen label="Databases">{back}<ErrorNote message={error} onRetry={reload} /></Screen>;
  if (!data) return <ScreenSkeleton kpis={4} />;

  const p = data.perf, s = p.stats;
  const long = hours > 24;
  const crit = p.issues.filter((i) => i.severity === "critical").length;
  const warn = p.issues.filter((i) => i.severity === "warning").length;
  const insights = q?.insights;
  const rangeLabel = RANGES.find((r) => r[0] === range)![2];
  const kpis: Array<[string, string, string, string?]> = [
    ["CPU average", s.cpu?.avg != null ? `${s.cpu.avg.toFixed(1)}%` : "—", s.cpu?.max != null ? `Peak ${s.cpu.max.toFixed(0)}%` : "—"],
    ["Connections", s.connections?.avg != null ? num(s.connections.avg) : "—", s.connections?.max != null ? `Peak ${num(s.connections.max)}` : "—"],
    ["Freeable memory", s.freeableMemory?.min != null ? `${num(s.freeableMemory.min / MB)} MB` : "—", "Low-water mark"],
    ["Free storage", s.freeStorage?.last != null ? `${(s.freeStorage.last / GB).toFixed(1)} GB` : "—", p.allocatedStorageGb != null ? `Of ${num(p.allocatedStorageGb)} GB` : "—"],
    ["Read / write latency", s.readLatency?.avg != null && s.writeLatency?.avg != null ? `${(s.readLatency.avg * 1000).toFixed(1)} / ${(s.writeLatency.avg * 1000).toFixed(1)} ms` : "—", "Average"],
    ["Issues", `${crit} / ${warn}`, "Critical / warning", crit ? "var(--danger)" : warn ? "var(--warning)" : "var(--success)"],
  ];

  return (
    <Screen label="Databases">
      {back}
      <div className="mb-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 max-w-[760px] flex-[1_1_420px]">
          <h1 className="m-0 text-[26px] font-semibold leading-[1.2] tracking-[-0.025em]">{p.id}</h1>
          <p className="mb-0 mt-1.5 text-[14px] leading-[1.5] text-muted-foreground">
            {p.engine} {p.engineVersion} · {p.instanceClass}{p.vcpu ? ` (${p.vcpu} vCPU)` : ""} · {p.region} · {p.status} · {p.multiAz ? "Multi-AZ" : "Single-AZ"}{p.burstable ? " · burstable" : ""} · fetched {new Date(p.fetchedAt).toLocaleTimeString()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={range} onChange={setRange} aria-label="Window" options={RANGES.map((r) => ({ value: r[0], label: r[0] }))} />
          <button type="button" title="Refresh" onClick={reload} className="inline-grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-[8px] border border-solid border-border bg-card text-fg-2 hover:bg-hover">
            <RefreshCw size={14} className={cn("block", loading && "animate-nt-spin")} />
          </button>
        </div>
      </div>
      <Card className="grid overflow-hidden grid-cols-[repeat(var(--k6,6),minmax(0,1fr))]">
        {kpis.map(([label, value, sub, color]) => (
          <div key={label} className="flex min-w-0 flex-col gap-1.5 px-5 py-4 shadow-[1px_0_0_var(--border),0_1px_0_var(--border)]">
            <span className="text-[13px] font-medium leading-5 text-muted-foreground">{label}</span>
            <span className="mt-auto whitespace-nowrap text-[24px] font-semibold leading-[30px] tracking-[-0.03em] tnum" style={{ color }}>{value}</span>
            <span className="text-[12.5px] leading-[18px] text-muted-foreground">{sub}</span>
          </div>
        ))}
      </Card>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
        <Card>
          <div className="flex items-center gap-2 px-5 pb-3 pt-4">
            <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Detected issues</h3>
            <span className="rounded-full bg-card-2 px-[7px] py-px text-[12px] font-medium text-muted-foreground">{p.issues.length}</span>
          </div>
          <div className="flex flex-col gap-2.5 px-5 pb-5">
            {p.issues.length === 0 && <div className="text-[13px] text-muted-foreground">No issues detected in this window.</div>}
            {p.issues.map((i) => {
              const t = ISSUE_TONE[i.severity], Icon = t.icon;
              return (
                <div key={i.title} className="flex items-start gap-3 rounded-[10px] border border-solid p-3.5" style={{ borderColor: `color-mix(in oklab, ${t.color} 30%, var(--border))`, background: `color-mix(in oklab, ${t.color} 5%, var(--card))` }}>
                  <span className="pt-px" style={{ color: t.color }}><Icon size={14} className="block" /></span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold">{i.title}</span>
                      <span className="inline-flex h-5 items-center rounded-[5px] px-1.5 text-[11px] font-semibold" style={{ color: t.color, background: tint(t.color) }}>{t.label}</span>
                    </div>
                    <div className="mt-1 text-[13px] text-fg-2">{i.evidence}</div>
                    {i.action && <div className="mt-1 text-[12.5px] text-muted-foreground">{i.action}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card>
          <div className="px-5 pb-3 pt-4"><h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Top queries by rows examined</h3></div>
          {!insights && <div className="mx-5 mb-5 text-[13px] text-muted-foreground">Loading query insights…</div>}
          {insights && !insights.available && (
            <div className="mx-5 mb-5 rounded-[10px] border border-dashed border-border-strong p-3.5 text-[13px] leading-[1.55]">
              <div className="font-semibold">Not available</div>
              <div className="mt-0.5 text-fg-2">{insights.reason}</div>
              {insights.remedy && <div className="mt-2 text-[12.5px] text-muted-foreground">{insights.remedy}</div>}
            </div>
          )}
          {insights?.available && (
            <div className="flex flex-col gap-2.5 px-5 pb-5">
              {insights.queries.length === 0 && <div className="text-[13px] text-muted-foreground">No query digests recorded yet.</div>}
              {insights.queries.slice(0, 8).map((x) => (
                <div key={x.rank} className="rounded-[10px] border border-solid border-border bg-card-2 px-3 py-2.5">
                  <div className="line-clamp-2 break-all font-mono text-[11.5px] leading-[1.55] text-fg-2" title={x.digestText}>{x.digestText}</div>
                  <div className="mt-1.5 flex flex-wrap gap-3 text-[12px] text-muted-foreground tnum">
                    <span>{num(x.rowsExaminedPerCall)} rows/call</span><span>{num(x.countStar)} calls</span><span>{x.avgLatencyMs.toFixed(1)} ms avg</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">Performance · {rangeLabel}</h2>
        <span className="text-[12.5px] text-muted-foreground">CloudWatch · times in IST</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4">
        <Chart long={long} title="CPU utilisation" color="var(--danger)" series={p.series.cpu} fmt={(v) => `${v.toFixed(1)}%`} stat={s.cpu?.avg != null ? `avg ${s.cpu.avg.toFixed(1)}% · peak ${(s.cpu.max ?? 0).toFixed(1)}%` : "—"} />
        <Chart long={long} title="Database connections" color="var(--info)" series={p.series.connections} fmt={(v) => num(v)} stat={s.connections?.avg != null ? `avg ${num(s.connections.avg)} · peak ${num(s.connections.max ?? 0)}` : "—"} />
        <Chart long={long} title="Freeable memory" color="var(--cshared)" series={p.series.freeableMemory} scale={MB} zero={false} fmt={(v) => `${num(v)} MB`} stat={s.freeableMemory?.min != null ? `low ${num(s.freeableMemory.min / MB)} MB` : "—"} />
        <Chart long={long} title="Free storage" color="var(--cinfra)" series={p.series.freeStorage} scale={GB} fmt={(v) => `${v.toFixed(1)} GB`} stat={s.freeStorage?.min != null ? `low ${(s.freeStorage.min / GB).toFixed(1)} GB` : "—"} />
        <Chart long={long} title="Read IOPS" color="var(--info)" series={p.series.readIops} fmt={(v) => num(v)} stat="ops/s" />
        <Chart long={long} title="Write IOPS" color="var(--orange)" series={p.series.writeIops} fmt={(v) => num(v)} stat="ops/s" />
        <Chart long={long} title="Read latency" color="var(--info)" series={p.series.readLatency} scale={1 / 1000} fmt={(v) => `${v.toFixed(2)} ms`} stat={s.readLatency?.avg != null ? `avg ${(s.readLatency.avg * 1000).toFixed(1)} ms` : "—"} />
        <Chart long={long} title="Write latency" color="var(--orange)" series={p.series.writeLatency} scale={1 / 1000} fmt={(v) => `${v.toFixed(1)} ms`} stat={s.writeLatency?.avg != null ? `avg ${(s.writeLatency.avg * 1000).toFixed(1)} ms` : "—"} />
        <Chart long={long} title="Disk queue depth" color="var(--warning)" series={p.series.diskQueueDepth} fmt={(v) => v.toFixed(2)} stat="requests" />
        <Chart long={long} title="Swap usage" color="var(--danger)" series={p.series.swapUsage} scale={MB} fmt={(v) => `${num(v)} MB`} stat={s.swapUsage?.max != null ? `peak ${num(s.swapUsage.max / MB)} MB` : "—"} />
        <Chart long={long} title="Network in" color="var(--cshared)" series={p.series.networkIn} scale={MB} fmt={(v) => `${v.toFixed(2)} MB/s`} stat="MB/s" />
        <Chart long={long} title="Network out" color="var(--info)" series={p.series.networkOut} scale={MB} fmt={(v) => `${v.toFixed(2)} MB/s`} stat="MB/s" />
        {p.series.burstBalance && <Chart long={long} title="EBS burst balance" color="var(--cinfra)" series={p.series.burstBalance} fmt={(v) => `${v.toFixed(0)}%`} stat="%" />}
        {p.series.replicaLag && <Chart long={long} title="Replica lag" color="var(--orange)" series={p.series.replicaLag} fmt={(v) => `${v.toFixed(0)} s`} stat="seconds" />}
        {p.series.cpuCreditBalance && <Chart long={long} wide title="CPU credit balance" color="var(--c30)" series={p.series.cpuCreditBalance} zero={false} fmt={(v) => num(v)} stat={s.cpuCreditBalance?.min != null ? `low ${num(s.cpuCreditBalance.min)}` : "—"} />}
      </div>
    </Screen>
  );
}

export default function DatabaseDetail() {
  return <Suspense fallback={<ScreenSkeleton />}><Inner /></Suspense>;
}
