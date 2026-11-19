"use client";
import { useMemo } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { BarChart } from "@/components/natasha/charts";
import { compact, istTime, num } from "@/components/natasha/format";
import { ErrorNote, Skeleton } from "@/components/natasha/primitives";
import { useJson } from "@/components/useJson";
import { IssueList } from "./IssueList";
import { SlowLogTables } from "./SlowLogTables";
import { dur, istLabels, type SlowLogOk, type SlowLogResp } from "./types";

const SETTINGS_KEYS = ["ELASTICSEARCH_HOST", "ELASTICSEARCH_PORT", "ELASTICSEARCH_USER", "ELASTICSEARCH_PASSWORD"];
const BUCKET: Record<number, string> = { 3: "10 minutes", 6: "15 minutes", 24: "hour", 72: "3 hours", 168: "6 hours" };

function Heading({ sub }: { sub?: string }) {
  return (
    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">Search slow log</h2>
      {sub && <span className="text-[12.5px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function Loaded({ d }: { d: SlowLogOk }) {
  const long = d.windowHours > 24;
  const chart = useMemo(() => {
    const c = istLabels(d.trend.map(([t]) => t), long);
    // Over several days, name each day once (under its first bar) instead of repeating it.
    return long ? { ...c, labels: c.labels.map((l, i) => (i === 0 || l !== c.labels[i - 1] ? l : "")) } : c;
  }, [d.trend, long]);
  const stats: Array<[string, string, string]> = [
    ["Slow searches", num(d.total), `${num(d.levels.warn)} warn · ${num(d.levels.info)} info · ${num(d.levels.debug)} debug`],
    ["Typical (p50)", dur(d.p50Ms), "half took longer"],
    ["Slow (p95)", dur(d.p95Ms), `1 in 20 took longer · p99 ${dur(d.p99Ms)}`],
    ["Slowest", dur(d.maxMs), d.slowest[0] ? d.slowest[0].index : "—"],
  ];
  return (
    <>
      <Card className="grid overflow-hidden grid-cols-[repeat(var(--k4,4),minmax(0,1fr))]">
        {stats.map(([label, value, sub]) => (
          <div key={label} className="flex min-w-0 flex-col gap-1.5 px-5 py-4 shadow-[1px_0_0_var(--border),0_1px_0_var(--border)]">
            <span className="text-[13px] font-medium leading-5 text-muted-foreground">{label}</span>
            <span className="mt-auto whitespace-nowrap text-[24px] font-semibold leading-[30px] tracking-[-0.03em] tnum">{value}</span>
            <span className="truncate text-[12.5px] leading-[18px] text-muted-foreground">{sub}</span>
          </div>
        ))}
      </Card>
      {d.findings.length > 0 && (
        <Card>
          <div className="flex items-center gap-2 px-5 pb-3 pt-4">
            <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Slow log findings</h3>
            <span className="rounded-full bg-card-2 px-[7px] py-px text-[12px] font-medium text-muted-foreground">{d.findings.length}</span>
          </div>
          <div className="px-5 pb-5"><IssueList issues={d.findings} /></div>
        </Card>
      )}
      <Card className="pb-4">
        <CardHeader title="Slow searches over time" description={`Searches logged per ${BUCKET[d.windowHours] ?? "interval"} · times in IST`} />
        <div className="px-4 pt-3">
          {/* Counts per interval are bars: a curve would suggest a gradual change between buckets. */}
          {d.trend.length > 0
            ? <BarChart labels={chart.labels} full={chart.full} values={d.trend.map(([, n]) => n)} height={160} gap={2} color="var(--warning)" fmt={(v) => `${num(v)} slow searches`} axisFmt={compact} axisWidth={40} ticks={long ? d.trend.length : 6} yTicks={3} />
            : <div className="grid h-[186px] place-items-center text-[13px] text-muted-foreground">No slow searches in this window.</div>}
        </div>
      </Card>
      <SlowLogTables d={d} />
    </>
  );
}

export function SlowLogPanel({ hours, refresh }: { hours: number; refresh: number }) {
  const url = `/api/elasticsearch/slowlog?hours=${hours}${refresh ? `&refresh=1&r=${refresh}` : ""}`;
  const { data, error, reload } = useJson<SlowLogResp>(url);

  if (error) return <><Heading /><ErrorNote message={error} onRetry={reload} /></>;
  if (!data) {
    return (
      <>
        <Heading />
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-[96px] rounded-[12px]" />
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[44px]" />)}
        </div>
      </>
    );
  }
  if (data.state === "not_configured") {
    return (
      <>
        <Heading />
        <Card className="px-5 py-4 text-[13px] leading-[1.55]">
          <div className="font-semibold">Not connected</div>
          <div className="mt-0.5 text-fg-2">
            To list slow searches, set these four keys in Settings:{" "}
            {SETTINGS_KEYS.map((k, i) => <span key={k}><code className="font-mono text-[12px]">{k}</code>{i < SETTINGS_KEYS.length - 1 ? ", " : "."}</span>)}
          </div>
        </Card>
      </>
    );
  }
  if (data.state === "error") return <><Heading /><ErrorNote message={data.message} onRetry={reload} /></>;
  const sub = `Elasticsearch slow log · last ${data.windowHours >= 72 ? `${data.windowHours / 24} days` : `${data.windowHours}h`} · fetched ${istTime(data.fetchedAt)} IST`;
  if (data.total === 0) {
    return <><Heading sub={sub} /><Card className="px-5 py-4 text-[13px] text-muted-foreground">No slow searches recorded in this window.</Card></>;
  }
  return <><Heading sub={sub} /><Loaded d={data} /></>;
}
