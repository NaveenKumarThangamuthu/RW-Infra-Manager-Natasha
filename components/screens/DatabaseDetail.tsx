"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { TimeChart } from "@/components/natasha/charts";
import { istTime, MONTHS_SHORT, num } from "@/components/natasha/format";
import { ErrorNote, Screen, ScreenSkeleton, StatStrip } from "@/components/natasha/primitives";
import { IssueList } from "@/components/screens/elasticsearch/IssueList";
import { useJson } from "@/components/useJson";
import { cn } from "@/lib/utils";

interface Series { label: string; unit: string; points: Array<[number, number]> }
interface Stat { avg: number | null; max: number | null; min: number | null; last: number | null }
interface Issue { severity: "critical" | "warning" | "info"; title: string; evidence: string; action: string }
interface Perf {
  id: string; region: string; windowHours: number; fetchedAt: string; engine: string; engineVersion: string; instanceClass: string; status: string;
  allocatedStorageGb: number | null; multiAz: boolean; vcpu: number | null; burstable: boolean; series: Record<string, Series | null>; stats: Record<string, Stat>; issues: Issue[];
}

const GB = 1024 ** 3, MB = 1024 ** 2;
const RANGES = [["3h", 3, "last 3h"], ["6h", 6, "last 6h"], ["1d", 24, "last 24h"], ["3d", 72, "last 3 days"], ["7d", 168, "last 7 days"]] as const;
type RangeKey = (typeof RANGES)[number][0];
const axis = (v: number) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(".0", "") + "k" : String(+v.toFixed(2)));
/** Narrow-range axes (memory, credits) need more precision or every tick reads the same. */
const axisFine = (v: number) => (v >= 1000 ? num(v) : String(+v.toFixed(2)));
const IST_MS = 330 * 60_000;

function timeLabels(points: Array<[number, number]>, long: boolean) {
  const p2 = (v: number) => String(v).padStart(2, "0");
  const mk = (ts: number) => { const t = new Date(ts + IST_MS); return { hm: `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`, dd: `${MONTHS_SHORT[t.getUTCMonth()]} ${t.getUTCDate()}` }; };
  return { labels: points.map(([ts]) => { const m = mk(ts); return long ? m.dd : m.hm; }), full: points.map(([ts]) => { const m = mk(ts); return `${m.dd}, ${m.hm} IST`; }) };
}

function Chart({ title, unit, stat = "", color, series, long, scale = 1, fmt, zero = true, wide }: { title: string; unit?: string; stat?: string; color: string; series: Series | null; long: boolean; scale?: number; fmt: (v: number) => string; zero?: boolean; wide?: boolean }) {
  const pts = series?.points ?? [];
  const { labels, full } = timeLabels(pts, long);
  return (
    <Card className="min-w-0 px-4 pb-3 pt-3.5" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <div className="mb-3 flex justify-between gap-3"><span className="text-[13px] font-semibold">{title}{unit && <span className="font-normal text-muted-foreground"> · {unit}</span>}</span><span className="text-right text-[12px] text-muted-foreground tnum">{stat}</span></div>
      {pts.length ? (
        <TimeChart labels={labels} full={full} height={110} ticks={4} yTicks={3} zero={zero} area strokeWidth={1.5} uniqueTicks axisWidth={40} axisFmt={zero ? axis : axisFine} fmt={fmt}
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

  const back = (
    <Link href="/rds" className="inline-flex h-[30px] items-center gap-1.5 self-start rounded-[8px] pl-1.5 pr-2.5 text-[13px] font-medium text-fg-2 no-underline hover:bg-hover hover:text-foreground">
      <ChevronLeft size={14} className="block" />All databases
    </Link>
  );
  if (error) return <Screen label="Databases">{back}<ErrorNote message={error} onRetry={reload} /></Screen>;
  if (!data) return <ScreenSkeleton kpis={4} />;

  const p = data.perf, s = p.stats;
  const long = hours > 24;
  const count = (sev: Issue["severity"]) => p.issues.filter((i) => i.severity === sev).length;
  const crit = count("critical"), warn = count("warning"), info = count("info");
  const issueParts = [crit && `${crit} critical`, warn && `${warn} warning${warn === 1 ? "" : "s"}`, info && `${info} info`].filter(Boolean).join(" · ");
  const rangeLabel = RANGES.find((r) => r[0] === range)![2];
  const freeGb = s.freeStorage?.last != null ? s.freeStorage.last / GB : null;
  const freePct = freeGb != null && p.allocatedStorageGb ? (freeGb / p.allocatedStorageGb) * 100 : null;
  const gb = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;
  // Each label says how the figure is aggregated over the window.
  const kpis = [
    { label: "CPU · avg", value: s.cpu?.avg != null ? `${s.cpu.avg.toFixed(1)}%` : "—", sub: s.cpu?.max != null ? `Peak ${s.cpu.max.toFixed(0)}%` : "—" },
    { label: "Connections · avg", value: s.connections?.avg != null ? num(s.connections.avg) : "—", sub: s.connections?.max != null ? `Peak ${num(s.connections.max)}` : "—" },
    { label: "Free memory · low", value: s.freeableMemory?.min != null ? gb(s.freeableMemory.min) : "—", sub: "Lowest point in this window" },
    { label: "Free storage · now", value: freeGb != null ? `${freeGb.toFixed(1)} GB` : "—", sub: p.allocatedStorageGb != null ? `Of ${num(p.allocatedStorageGb)} GB${freePct != null ? ` · ${freePct.toFixed(0)}% free` : ""}` : "—" },
    { label: "Latency · avg", value: s.readLatency?.avg != null && s.writeLatency?.avg != null ? `${(s.readLatency.avg * 1000).toFixed(1)} / ${(s.writeLatency.avg * 1000).toFixed(1)}` : "—", sub: "Read / write, ms" },
    { label: "Issues", value: num(p.issues.length), sub: issueParts || "None detected", color: crit ? "var(--danger)" : warn ? "var(--warning)" : undefined },
  ];

  return (
    <Screen label="Databases">
      {back}
      <div className="mb-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 max-w-[760px] flex-[1_1_420px]">
          <h1 className="m-0 text-[26px] font-semibold leading-[1.2] tracking-[-0.025em]">{p.id}</h1>
          <p className="mb-0 mt-1.5 text-[14px] leading-[1.5] text-muted-foreground">
            {p.engine} {p.engineVersion} · {p.instanceClass}{p.vcpu ? ` (${p.vcpu} vCPU)` : ""} · {p.region} · {p.status} · {p.multiAz ? "Multi-AZ" : "Single-AZ"}{p.burstable ? " · burstable" : ""} · fetched {istTime(p.fetchedAt)} IST
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={range} onChange={setRange} aria-label="Window" options={RANGES.map((r) => ({ value: r[0], label: r[0] }))} />
          <button type="button" title="Refresh" onClick={reload} className="inline-grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-[8px] border border-solid border-border bg-card text-fg-2 hover:bg-hover">
            <RefreshCw size={14} className={cn("block", loading && "animate-nt-spin")} />
          </button>
        </div>
      </div>
      <StatStrip cols={6} items={kpis} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
        <Card>
          <div className="flex items-center gap-2 px-5 pb-3 pt-4">
            <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Detected issues</h3>
            <span className="rounded-full bg-card-2 px-[7px] py-px text-[12px] font-medium text-muted-foreground">{p.issues.length}</span>
          </div>
          <div className="px-5 pb-5"><IssueList issues={p.issues} empty="No issues detected in this window." /></div>
        </Card>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">Performance · {rangeLabel}</h2>
        <span className="text-[12.5px] text-muted-foreground">CloudWatch · times in IST</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4">
        <Chart long={long} title="CPU utilisation" unit="%" color="var(--info)" series={p.series.cpu} fmt={(v) => `${v.toFixed(1)}%`} stat={s.cpu?.avg != null ? `avg ${s.cpu.avg.toFixed(1)}% · peak ${(s.cpu.max ?? 0).toFixed(1)}%` : "—"} />
        <Chart long={long} title="Database connections" color="var(--info)" series={p.series.connections} fmt={(v) => num(v)} stat={s.connections?.avg != null ? `avg ${num(s.connections.avg)} · peak ${num(s.connections.max ?? 0)}` : "—"} />
        <Chart long={long} title="Freeable memory" unit="GB" color="var(--cshared)" series={p.series.freeableMemory} scale={GB} zero={false} fmt={(v) => `${v.toFixed(2)} GB`} stat={s.freeableMemory?.min != null ? `low ${gb(s.freeableMemory.min)}` : "—"} />
        <Chart long={long} title="Free storage" color="var(--cinfra)" series={p.series.freeStorage} scale={GB} zero={false} fmt={(v) => `${v.toFixed(1)} GB`}
          stat={freeGb != null ? `${freeGb.toFixed(1)} GB free${p.allocatedStorageGb != null ? ` of ${num(p.allocatedStorageGb)} GB${freePct != null ? ` (${freePct.toFixed(0)}%)` : ""}` : ""}` : "—"} />
        <Chart long={long} title="Read IOPS" unit="ops/s" color="var(--info)" series={p.series.readIops} fmt={(v) => num(v)} />
        <Chart long={long} title="Write IOPS" unit="ops/s" color="var(--orange)" series={p.series.writeIops} fmt={(v) => num(v)} />
        <Chart long={long} title="Read latency" unit="ms" color="var(--info)" series={p.series.readLatency} scale={1 / 1000} fmt={(v) => `${v.toFixed(2)} ms`} stat={s.readLatency?.avg != null ? `avg ${(s.readLatency.avg * 1000).toFixed(1)} ms` : "—"} />
        <Chart long={long} title="Write latency" unit="ms" color="var(--orange)" series={p.series.writeLatency} scale={1 / 1000} fmt={(v) => `${v.toFixed(1)} ms`} stat={s.writeLatency?.avg != null ? `avg ${(s.writeLatency.avg * 1000).toFixed(1)} ms` : "—"} />
        <Chart long={long} title="Disk queue depth" unit="waiting requests" color="var(--warning)" series={p.series.diskQueueDepth} fmt={(v) => v.toFixed(2)} />
        <Chart long={long} title="Swap usage" unit="MB" color="var(--warning)" series={p.series.swapUsage} scale={MB} fmt={(v) => `${num(v)} MB`} stat={s.swapUsage?.max != null ? `peak ${num(s.swapUsage.max / MB)} MB` : "—"} />
        <Chart long={long} title="Network in" unit="MB/s" color="var(--cshared)" series={p.series.networkIn} scale={MB} fmt={(v) => `${v.toFixed(2)} MB/s`} />
        <Chart long={long} title="Network out" unit="MB/s" color="var(--info)" series={p.series.networkOut} scale={MB} fmt={(v) => `${v.toFixed(2)} MB/s`} />
        {p.series.burstBalance && <Chart long={long} title="EBS burst balance" unit="%" color="var(--cinfra)" series={p.series.burstBalance} fmt={(v) => `${v.toFixed(0)}%`} />}
        {p.series.replicaLag && <Chart long={long} title="Replica lag" unit="seconds" color="var(--orange)" series={p.series.replicaLag} fmt={(v) => `${v.toFixed(0)} s`} />}
        {p.series.cpuCreditBalance && <Chart long={long} wide title="CPU credit balance" unit="credits" color="var(--c30)" series={p.series.cpuCreditBalance} zero={false} fmt={(v) => num(v)} stat={s.cpuCreditBalance?.min != null ? `low ${num(s.cpuCreditBalance.min)}` : "—"} />}
      </div>
    </Screen>
  );
}

export default function DatabaseDetail() {
  return <Suspense fallback={<ScreenSkeleton />}><Inner /></Suspense>;
}
