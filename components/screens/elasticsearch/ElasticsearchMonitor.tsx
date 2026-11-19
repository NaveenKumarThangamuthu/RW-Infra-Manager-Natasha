"use client";
import { useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { compactCount, istTime, num } from "@/components/natasha/format";
import { Banner, ErrorNote, Screen, ScreenSkeleton, StatStrip } from "@/components/natasha/primitives";
import { useJson } from "@/components/useJson";
import { cn } from "@/lib/utils";
import { IssueList } from "./IssueList";
import { MetricCard } from "./MetricCard";
import { SlowLogPanel } from "./SlowLogPanel";
import { RANGES, type EsLine, type EsMonitor, type EsStat, type RangeKey } from "./types";

const GB = 1024 ** 3;
const STATUS = { green: ["Green", "var(--success)"], yellow: ["Yellow", "var(--warning)"], red: ["Red", "var(--danger)"], unknown: ["Unknown", undefined] } as const;
const pct1 = (v: number) => `${v.toFixed(1)}%`;
const msFmt = (v: number) => `${v < 10 ? v.toFixed(2) : num(v)} ms`;
const gbFmt = (v: number) => `${v.toFixed(1)} GB`;
const dash = "—";
/** Plain names for the memory clean-up (garbage collection) lines. */
const GC_NAMES: Record<string, string> = { young: "Quick clean-up", old: "Full clean-up", "G1 Concurrent GC": "Background clean-up" };
const rename = (lines: EsLine[] | null | undefined, names: Record<string, string>) => lines?.map((l) => ({ ...l, label: names[l.label] ?? l.label }));
const uptime = (sec: number) => (sec >= 86_400 ? `${Math.floor(sec / 86_400)} day${sec >= 172_800 ? "s" : ""}` : sec >= 3600 ? `${Math.floor(sec / 3600)} hour${sec >= 7200 ? "s" : ""}` : `${Math.max(1, Math.floor(sec / 60))} min`);

function avgPeak(s: EsStat | undefined, f: (v: number) => string) {
  return s?.avg != null && s.max != null ? `avg ${f(s.avg)} · peak ${f(s.max)}` : dash;
}

export default function ElasticsearchMonitor() {
  const [range, setRange] = useState<RangeKey>("1d");
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useState<"perf" | "slow">("perf");
  const hours = RANGES.find((r) => r[0] === range)![1];
  const { data, error, loading, reload } = useJson<{ monitor: EsMonitor }>(`/api/elasticsearch?hours=${hours}`);

  if (error) return <Screen label="Elasticsearch"><ErrorNote message={error} onRetry={reload} /></Screen>;
  if (!data) return <ScreenSkeleton kpis={4} />;

  const m = data.monitor, s = m.stats, sr = m.series;
  const long = hours > 24;
  const rangeLabel = RANGES.find((r) => r[0] === range)![2];
  const count = (sev: EsMonitor["issues"][number]["severity"]) => m.issues.filter((i) => i.severity === sev).length;
  const crit = count("critical"), warn = count("warning"), info = count("info");
  const issueParts = [crit && `${crit} critical`, warn && `${warn} warning${warn === 1 ? "" : "s"}`, info && `${info} info`].filter(Boolean).join(" · ");
  const [statusLabel, statusColor] = STATUS[m.status] ?? STATUS.unknown;
  const heapGb = m.heapMaxBytes != null ? m.heapMaxBytes / GB : null;
  const heap = s["heapPct.Heap in use"], cpu = s["cpu.Elasticsearch"], free = s["diskFree.Free disk"];
  const sTime = s["searchTime.Search"], sRate = s["searchRate.Searches"];
  const servers = m.nodeCount != null ? `${m.nodeCount} server${m.nodeCount === 1 ? "" : "s"}` : "? servers";
  const freePct = free?.last != null && m.diskSizeBytes ? (free.last / m.diskSizeBytes) * 100 : null;

  // Each label says how the figure is aggregated over the window. Memory is a sawtooth, so its
  // latest sample jumps on every load: the average is the stable headline.
  const kpis = [
    { label: "Cluster status", value: statusLabel, sub: `${servers} · ${m.shards.unassigned != null ? num(m.shards.unassigned) : "?"} unassigned`, color: statusColor },
    { label: "CPU · avg", value: cpu?.avg != null ? pct1(cpu.avg) : dash, sub: cpu?.max != null ? `Peak ${cpu.max.toFixed(0)}%` : dash },
    { label: "Memory · avg", value: heap?.avg != null ? pct1(heap.avg) : dash, sub: heap?.max != null ? `Peak ${heap.max.toFixed(0)}%${heapGb != null ? ` of ${heapGb.toFixed(1)} GB heap` : ""}` : dash },
    { label: "Free disk · now", value: free?.last != null ? gbFmt(free.last / GB) : dash, sub: m.diskSizeBytes && freePct != null ? `${freePct.toFixed(0)}% free of ${(m.diskSizeBytes / GB).toFixed(0)} GB` : dash },
    { label: "Search time · avg", value: sTime?.avg != null ? msFmt(sTime.avg) : dash, sub: sRate?.avg != null ? `${num(sRate.avg)} searches/s` : "Per shard search" },
    { label: "Issues", value: num(m.issues.length), sub: issueParts || "None detected", color: crit ? "var(--danger)" : warn ? "var(--warning)" : undefined },
  ];
  const subtitle = [
    `Elasticsearch ${m.version ?? "?"}`, servers, m.nodes.map((n) => n.name).join(", ") || null,
    m.uptimeSec != null ? `up ${uptime(m.uptimeSec)}` : null, `fetched ${istTime(m.fetchedAt)} IST`,
  ].filter(Boolean).join(" · ");
  const st = (k: string) => s[k];

  return (
    <Screen label="Elasticsearch">
      <div className="mb-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 max-w-[760px] flex-[1_1_420px]">
          <h1 className="m-0 break-words text-[26px] font-semibold leading-[1.2] tracking-[-0.025em]">Elasticsearch</h1>
          <p className="mb-0 mt-1.5 break-words text-[14px] leading-[1.5] text-muted-foreground">{subtitle}</p>
          <p className="mb-0 mt-1 text-[13px] text-muted-foreground">
            Application database trouble is on <Link href="/slow-queries" className="font-medium text-foreground underline">Slow queries</Link>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={range} onChange={setRange} aria-label="Window" options={RANGES.map((r) => ({ value: r[0], label: r[0] }))} />
          <button type="button" title="Refresh" onClick={() => { reload(); setRefresh((n) => n + 1); }} className="inline-grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-[8px] border border-solid border-border bg-card text-fg-2 hover:bg-hover">
            <RefreshCw size={14} className={cn("block", loading && "animate-nt-spin")} />
          </button>
        </div>
      </div>
      <StatStrip cols={6} items={kpis} />
      {m.failedQueries.length > 0 && (
        <Banner tone="var(--warning)">Some charts could not be loaded: {m.failedQueries.join(", ")}.</Banner>
      )}
      <Card>
        <div className="flex items-center gap-2 px-5 pb-3 pt-4">
          <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Detected issues</h3>
          <span className="rounded-full bg-card-2 px-[7px] py-px text-[12px] font-medium text-muted-foreground">{m.issues.length}</span>
        </div>
        <div className="px-5 pb-5"><IssueList issues={m.issues} empty="No issues detected in this window." /></div>
      </Card>
      <Segmented className="self-start" value={view} onChange={setView} aria-label="Section" options={[{ value: "perf", label: "Performance" }, { value: "slow", label: "Search slow log" }]} />
      {view === "slow" && <SlowLogPanel hours={hours} refresh={refresh} />}
      {view === "perf" && <>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">Performance · {rangeLabel}</h2>
        <span className="text-[12.5px] text-muted-foreground">Times in IST</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4">
        <MetricCard long={long} title="CPU utilisation" unit="%" lines={sr.cpu} colors={["var(--info)", "var(--cshared)"]} fmt={pct1} stat={avgPeak(st("cpu.Elasticsearch"), (v) => `${v.toFixed(0)}%`)} />
        <MetricCard long={long} title="Server load" lines={sr.load} colors={["var(--info)", "var(--orange)", "var(--cshared)"]} fmt={(v) => v.toFixed(2)} stat={m.cpuCores ? `${m.cpuCores} CPU cores` : "load average"} />
        <MetricCard long={long} title="Memory (heap) in use" unit="%" lines={sr.heapPct} colors={["var(--cshared)"]} fmt={pct1} stat={avgPeak(st("heapPct.Heap in use"), (v) => `${v.toFixed(0)}%`)} />
        <MetricCard long={long} title="Memory clean-up time" unit="ms per second" lines={rename(sr.gc, GC_NAMES)} colors={["var(--info)", "var(--orange)", "var(--cinfra)"]} fmt={(v) => `${v.toFixed(1)} ms/s`} />
        <MetricCard long={long} title="Memory safety limit used" unit="%" lines={sr.breakerPct} colors={["var(--warning)"]} fmt={pct1} stat="refused at 100%" />
        <MetricCard long={long} title="Free disk" unit="GB" lines={sr.diskFree} colors={["var(--cinfra)"]} scale={GB} zero={false} fmt={gbFmt} stat={free?.min != null ? `low ${gbFmt(free.min / GB)}` : dash} />
        <MetricCard long={long} title="Disk operations" lines={sr.diskOps} colors={["var(--info)", "var(--orange)"]} fmt={(v) => `${num(v)}/s`} unit="ops/s" />
        <MetricCard long={long} title="Search rate" unit="per second" lines={sr.searchRate} colors={["var(--info)", "var(--cshared)"]} fmt={(v) => `${num(v)}/s`} stat={sRate?.avg != null ? `avg ${num(sRate.avg)}/s` : "per second"} />
        <MetricCard long={long} title="Search time" unit="ms per shard search" lines={sr.searchTime} colors={["var(--info)", "var(--orange)"]} fmt={msFmt} />
        <MetricCard long={long} title="Searches running at once" lines={sr.searchActive} colors={["var(--info)"]} fmt={(v) => v.toFixed(1)} stat={avgPeak(st("searchActive.Search"), (v) => v.toFixed(0))} />
        <MetricCard long={long} title="Waiting in queue" lines={sr.searchQueue} colors={["var(--warning)", "var(--orange)"]} fmt={(v) => v.toFixed(0)} unit="requests" />
        <MetricCard long={long} title="Rejected requests" lines={sr.rejected} colors={["var(--danger)", "var(--orange)"]} fmt={(v) => num(v)} unit="per interval" />
        <MetricCard long={long} title="Indexing rate" lines={sr.indexRate} colors={["var(--orange)"]} fmt={(v) => `${num(v)}/s`} unit="documents/s" />
        <MetricCard long={long} title="Indexing time" lines={sr.indexTime} colors={["var(--orange)"]} fmt={msFmt} unit="ms per document" />
        <MetricCard long={long} title="Documents" lines={sr.docs} colors={["var(--info)"]} zero={false} fmt={compactCount} stat={st("docs.Documents")?.last != null ? compactCount(st("docs.Documents")!.last!) : dash} />
        <MetricCard long={long} title="Stored data" unit="GB" lines={sr.storeSize} colors={["var(--cinfra)"]} scale={GB} zero={false} fmt={gbFmt} stat={st("storeSize.Stored data")?.last != null ? gbFmt(st("storeSize.Stored data")!.last! / GB) : dash} />
        <MetricCard long={long} title="Shards" lines={sr.shards} colors={["var(--success)", "var(--warning)"]} fmt={(v) => num(v)} stat={m.shards.active != null ? `${num(m.shards.active)} active` : dash} />
        <MetricCard long={long} title="Segments" lines={sr.segments} colors={["var(--c30)"]} zero={false} fmt={(v) => num(v)} />
        <MetricCard long={long} title="Open files" lines={sr.openFiles} colors={["var(--info)"]} fmt={(v) => num(v)} stat={m.maxOpenFiles ? `limit ${num(m.maxOpenFiles)}` : "count"} />
        <MetricCard long={long} title="Pending cluster tasks" lines={sr.pendingTasks} colors={["var(--warning)"]} fmt={(v) => num(v)} />
      </div>
      </>}
    </Screen>
  );
}
