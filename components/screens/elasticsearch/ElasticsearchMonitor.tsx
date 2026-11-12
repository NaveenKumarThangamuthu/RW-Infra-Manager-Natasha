"use client";
import { useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { compact, num } from "@/components/natasha/format";
import { Banner, ErrorNote, Screen, ScreenSkeleton } from "@/components/natasha/primitives";
import { useJson } from "@/components/useJson";
import { cn } from "@/lib/utils";
import { IssueList } from "./IssueList";
import { MetricCard } from "./MetricCard";
import { SlowLogPanel } from "./SlowLogPanel";
import { RANGES, type EsMonitor, type EsStat, type RangeKey } from "./types";

const GB = 1024 ** 3;
const STATUS = { green: ["Green", "var(--success)"], yellow: ["Yellow", "var(--warning)"], red: ["Red", "var(--danger)"], unknown: ["Unknown", undefined] } as const;
const pct1 = (v: number) => `${v.toFixed(1)}%`;
const msFmt = (v: number) => `${v < 10 ? v.toFixed(2) : num(v)} ms`;
const gbFmt = (v: number) => `${v.toFixed(1)} GB`;
const dash = "—";

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
  const crit = m.issues.filter((i) => i.severity === "critical").length;
  const warn = m.issues.filter((i) => i.severity === "warning").length;
  const [statusLabel, statusColor] = STATUS[m.status] ?? STATUS.unknown;
  const heapGb = m.heapMaxBytes != null ? m.heapMaxBytes / GB : null;
  const heap = s["heapPct.Heap in use"], cpu = s["cpu.Elasticsearch"], free = s["diskFree.Free disk"];
  const sTime = s["searchTime.Search"], sRate = s["searchRate.Searches"];
  const servers = m.nodeCount != null ? `${m.nodeCount} server${m.nodeCount === 1 ? "" : "s"}` : "? servers";
  const freePct = free?.last != null && m.diskSizeBytes ? (free.last / m.diskSizeBytes) * 100 : null;

  const kpis: Array<[string, string, string, string?]> = [
    ["Cluster status", statusLabel, `${servers} · ${m.shards.unassigned != null ? num(m.shards.unassigned) : "?"} copies unassigned`, statusColor],
    ["CPU average", cpu?.avg != null ? pct1(cpu.avg) : dash, cpu?.max != null ? `Peak ${cpu.max.toFixed(0)}%` : dash],
    ["Memory in use", heap?.last != null ? pct1(heap.last) : dash,
      heap?.last != null && heapGb != null ? `${(heap.last / 100 * heapGb).toFixed(1)} of ${heapGb.toFixed(1)} GB heap · peak ${(heap.max ?? 0).toFixed(0)}%` : dash],
    ["Free disk", free?.last != null ? gbFmt(free.last / GB) : dash, m.diskSizeBytes && freePct != null ? `Of ${(m.diskSizeBytes / GB).toFixed(1)} GB · ${freePct.toFixed(1)}% free` : dash],
    ["Search time", sTime?.avg != null ? msFmt(sTime.avg) : dash, `per shard search${sRate?.avg != null ? ` · ${num(sRate.avg)} searches/s` : ""}`],
    ["Issues", `${crit} / ${warn}`, "Critical / warning", crit ? "var(--danger)" : warn ? "var(--warning)" : "var(--success)"],
  ];
  const subtitle = [
    `Elasticsearch ${m.version ?? "?"}`, servers, m.nodes.map((n) => n.name).join(", ") || null,
    m.uptimeSec != null ? `up ${Math.floor(m.uptimeSec / 86400)} days` : null, `fetched ${new Date(m.fetchedAt).toLocaleTimeString()}`,
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
      <Card className="grid overflow-hidden grid-cols-[repeat(var(--k6,6),minmax(0,1fr))]">
        {kpis.map(([label, value, sub, color]) => (
          <div key={label} className="flex min-w-0 flex-col gap-1.5 px-5 py-4 shadow-[1px_0_0_var(--border),0_1px_0_var(--border)]">
            <span className="text-[13px] font-medium leading-5 text-muted-foreground">{label}</span>
            <span className="mt-auto whitespace-nowrap text-[24px] font-semibold leading-[30px] tracking-[-0.03em] tnum" style={{ color }}>{value}</span>
            <span className="text-[12.5px] leading-[18px] text-muted-foreground">{sub}</span>
          </div>
        ))}
      </Card>
      {m.failedQueries.length > 0 && (
        <Banner tone="var(--warning)">Some charts could not be loaded from Prometheus: {m.failedQueries.join(", ")}.</Banner>
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
        <span className="text-[12.5px] text-muted-foreground">Prometheus · times in IST</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4">
        <MetricCard long={long} title="CPU utilisation" lines={sr.cpu} colors={["var(--danger)", "var(--info)"]} fmt={pct1} stat={avgPeak(st("cpu.Elasticsearch"), (v) => `${v.toFixed(0)}%`)} />
        <MetricCard long={long} title="Server load" lines={sr.load} colors={["var(--info)", "var(--orange)", "var(--cshared)"]} fmt={(v) => v.toFixed(2)} stat={m.cpuCores ? `${m.cpuCores} CPU cores` : "load average"} />
        <MetricCard long={long} title="Memory (heap) in use" lines={sr.heapPct} colors={["var(--cshared)"]} fmt={pct1} stat={avgPeak(st("heapPct.Heap in use"), (v) => `${v.toFixed(0)}%`)} />
        <MetricCard long={long} title="Memory clean-up time" lines={sr.gc} colors={["var(--info)", "var(--danger)", "var(--cinfra)"]} fmt={(v) => `${v.toFixed(1)} ms/s`} stat="ms per second" />
        <MetricCard long={long} title="Memory safety limit used" lines={sr.breakerPct} colors={["var(--warning)"]} fmt={pct1} stat="requests are refused at 100%" />
        <MetricCard long={long} title="Free disk" lines={sr.diskFree} colors={["var(--cinfra)"]} scale={GB} zero={false} fmt={gbFmt} stat={free?.min != null ? `low ${gbFmt(free.min / GB)}` : dash} />
        <MetricCard long={long} title="Disk operations" lines={sr.diskOps} colors={["var(--info)", "var(--orange)"]} fmt={(v) => `${num(v)}/s`} stat="ops/s" />
        <MetricCard long={long} title="Search rate" lines={sr.searchRate} colors={["var(--info)", "var(--cshared)"]} fmt={(v) => `${num(v)}/s`} stat={sRate?.avg != null ? `avg ${num(sRate.avg)}/s` : "per second"} />
        <MetricCard long={long} title="Search time" lines={sr.searchTime} colors={["var(--info)", "var(--orange)"]} fmt={msFmt} stat="ms per shard search" />
        <MetricCard long={long} title="Searches running at once" lines={sr.searchActive} colors={["var(--info)"]} fmt={(v) => v.toFixed(1)} stat={avgPeak(st("searchActive.Search"), (v) => v.toFixed(0))} />
        <MetricCard long={long} title="Waiting in queue" lines={sr.searchQueue} colors={["var(--warning)", "var(--orange)"]} fmt={(v) => v.toFixed(0)} stat="requests" />
        <MetricCard long={long} title="Rejected requests" lines={sr.rejected} colors={["var(--danger)", "var(--orange)"]} fmt={(v) => num(v)} stat="per interval" />
        <MetricCard long={long} title="Indexing rate" lines={sr.indexRate} colors={["var(--orange)"]} fmt={(v) => `${num(v)}/s`} stat="documents/s" />
        <MetricCard long={long} title="Indexing time" lines={sr.indexTime} colors={["var(--orange)"]} fmt={msFmt} stat="ms per document" />
        <MetricCard long={long} title="Documents" lines={sr.docs} colors={["var(--info)"]} zero={false} fmt={compact} stat={st("docs.Documents")?.last != null ? `${(st("docs.Documents")!.last! / 1e6).toFixed(1)} M` : dash} />
        <MetricCard long={long} title="Stored data" lines={sr.storeSize} colors={["var(--cinfra)"]} scale={GB} zero={false} fmt={gbFmt} stat={st("storeSize.Stored data")?.last != null ? gbFmt(st("storeSize.Stored data")!.last! / GB) : dash} />
        <MetricCard long={long} title="Shards" lines={sr.shards} colors={["var(--success)", "var(--warning)"]} fmt={(v) => num(v)} stat={m.shards.active != null ? `${num(m.shards.active)} active` : dash} />
        <MetricCard long={long} title="Segments" lines={sr.segments} colors={["var(--c30)"]} zero={false} fmt={(v) => num(v)} stat="count" />
        <MetricCard long={long} title="Open files" lines={sr.openFiles} colors={["var(--info)"]} fmt={(v) => num(v)} stat={m.maxOpenFiles ? `limit ${num(m.maxOpenFiles)}` : "count"} />
        <MetricCard long={long} title="Pending cluster tasks" lines={sr.pendingTasks} colors={["var(--warning)"]} fmt={(v) => num(v)} stat="count" />
      </div>
      </>}
    </Screen>
  );
}
