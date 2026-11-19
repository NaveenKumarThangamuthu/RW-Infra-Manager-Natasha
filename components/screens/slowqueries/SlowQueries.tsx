"use client";
import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Clock, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { ago, num } from "@/components/natasha/format";
import { Banner, Dot, ErrorNote, Kpi, KpiGrid, PageHeader, Screen, ScreenSkeleton } from "@/components/natasha/primitives";
import { useOnRefreshed } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { cn } from "@/lib/utils";
import { DbQueries } from "./DbQueries";
import { LogTrouble } from "./LogTrouble";
import { SampleSheet } from "./SampleSheet";
import { SlowOps } from "./SlowOps";
import { KIND_HINT, latencyColor, ms, RANGE_LABEL, RANGE_OPTIONS, SEVERITY_COLOR, type LogsResp, type Range, type SampleTarget } from "./types";

/** Kinds that already have their own KPI card. */
const CARD_KINDS = ["sqlFailed", "deadlock", "lockWait"];
/** Under this many rows, timed operations are shown inside the Service logs tab instead of a tab of their own. */
const OPS_TAB_MIN = 3;

type Tab = "logs" | "ops" | "db";
const isRange = (v: string | null): v is Range => v === "1h" || v === "6h" || v === "24h";

function Notes({ notes }: { notes: LogsResp["notes"] }) {
  if (!notes.length) {
    return <Banner tone="var(--success)"><Dot color="var(--success)" size={7} />No likely causes found for this window.</Banner>;
  }
  return (
    <Banner tone={SEVERITY_COLOR[notes[0].severity]} className="items-start py-3">
      <div className="flex w-full flex-col gap-2.5">
        <div className="text-[12px] font-medium text-muted-foreground">Likely causes · worked out from the counts and samples below</div>
        {notes.map((n, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <Dot color={SEVERITY_COLOR[n.severity]} size={7} className="mt-[6px]" />
            <div className="min-w-0">
              <div className="font-semibold">{n.title}</div>
              <div className="mt-0.5 text-fg-2">{n.evidence}</div>
              <div className="mt-0.5 text-[12.5px] text-muted-foreground">{n.action}</div>
            </div>
          </div>
        ))}
      </div>
    </Banner>
  );
}

function Kpis({ data }: { data: LogsResp }) {
  const k = Object.fromEntries(data.kinds.map((x) => [x.key, x]));
  const partial = (...keys: string[]) => keys.some((key) => k[key]?.partial) ? <Badge size="xs" tone="var(--warning)">partial</Badge> : undefined;
  const failed = k.sqlFailed?.total ?? 0;
  const dead = k.deadlock?.total ?? 0, wait = k.lockWait?.total ?? 0;
  // The third card is the largest kind that has no card of its own, so the biggest problem is never missing from this row.
  const top = data.kinds.filter((x) => !CARD_KINDS.includes(x.key)).sort((a, b) => b.total - a.total)[0];
  const topColor = !top?.total ? "var(--success)" : top.key === "readTimeout" ? "var(--info)" : "var(--danger)";
  const slowest = data.operations.rows[0];
  const bad = (n: number) => (n > 0 ? "var(--danger)" : "var(--success)");
  return (
    <KpiGrid>
      <Kpi label="Failed SQL statements" value={num(failed)} valueColor={bad(failed)} badge={partial("sqlFailed")} footer={RANGE_LABEL[data.range]} />
      <Kpi label="Lock contention" value={num(dead + wait)} valueColor={dead + wait ? "var(--warning)" : "var(--success)"} badge={partial("deadlock", "lockWait")}
        footer={`${num(dead)} deadlock${dead === 1 ? "" : "s"} · ${num(wait)} lock wait${wait === 1 ? "" : "s"}`} />
      <Kpi label={top?.total ? top.label : "Service call timeouts"} value={num(top?.total ?? 0)} valueColor={topColor} badge={top ? partial(top.key) : undefined}
        footer={<span className="line-clamp-2">{top?.total ? (KIND_HINT[top.key] ?? `Log lines in the ${RANGE_LABEL[data.range]}`) : "HTTP calls between services"}</span>} />
      <Kpi label="Slowest operation p95" value={slowest ? ms(slowest.p95) : "—"} valueColor={slowest ? latencyColor(slowest.p95) : undefined}
        footer={<span className="line-clamp-2 break-words" title={slowest?.operation}>{slowest ? slowest.operation : "No timing lines sampled"}</span>} />
    </KpiGrid>
  );
}

function Inner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlRange = params.get("range");
  const range: Range = isRange(urlRange) ? urlRange : "6h";
  const [tab, setTab] = useState<Tab>("logs");
  const [bust, setBust] = useState(0);
  const [target, setTarget] = useState<SampleTarget | null>(null);
  const logs = useJson<LogsResp>(`/api/slow-queries/logs?range=${range}${bust ? `&refresh=1&t=${bust}` : ""}`);
  useOnRefreshed(() => logs.reload());

  const setRange = (r: Range) => {
    setBust(0);
    router.replace(`${pathname}?range=${r}`, { scroll: false });
  };
  const data = logs.data;
  const busy = logs.loading;

  const header = (
    <PageHeader maxWidth={800} title="Slow queries"
      description="Database trouble from two sources: failed statements, lock contention, MongoDB and service-call timeouts found in the application logs, and MySQL statement statistics."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented size="md" value={range} onChange={setRange} aria-label="Time range" options={RANGE_OPTIONS.map((r) => ({ value: r, label: r }))} />
          <Button variant="primary" size="lg" className="px-3.5" disabled={busy} onClick={() => setBust(Date.now())}>
            <RefreshCw size={14} className={cn("block", busy && "animate-nt-spin")} />{busy ? "Loading…" : "Refresh"}
          </Button>
        </div>
      } />
  );

  if (!data && !logs.error) return <ScreenSkeleton kpis={4} />;

  const grand = data ? data.kinds.reduce((n, k) => n + k.total, 0) : null;
  const opsCount = data?.operations.rows.length ?? 0;
  const opsTab = !data || opsCount >= OPS_TAB_MIN;
  const shown: Tab = tab === "ops" && !opsTab ? "logs" : tab;
  return (
    <Screen label="Slow queries">
      {header}
      {logs.error && <ErrorNote message={`Service logs unavailable: ${logs.error}`} onRetry={logs.reload} />}
      {data?.via === "public" && <Banner tone="var(--warning)">Using the public log endpoint: the internal one is unreachable, so logs come from the slower route.</Banner>}
      {data && <Kpis data={data} />}
      {data && <Notes notes={data.notes} />}
      <div className="flex flex-wrap items-center gap-2.5">
        <Segmented size="md" value={shown} onChange={setTab} aria-label="Section" options={[
          { value: "logs" as Tab, label: "Service logs", count: grand != null ? num(grand) : undefined },
          ...(opsTab ? [{ value: "ops" as Tab, label: "Timed operations", count: data ? opsCount : undefined }] : []),
          { value: "db" as Tab, label: "Database" },
        ]} />
        {data && shown !== "db" && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <Badge size="md" tone="var(--success)"><Clock size={12} className="block" />Logs {ago(data.fetchedAt)}</Badge>
            {data.cached && <Badge size="md">cached</Badge>}
          </span>
        )}
      </div>
      {shown === "logs" && data && <LogTrouble data={data} onOpen={setTarget} />}
      {shown === "logs" && data && !opsTab && opsCount > 0 && <SlowOps data={data} />}
      {shown === "ops" && data && <SlowOps data={data} />}
      {shown !== "db" && !data && logs.error && <div className="text-[13px] text-muted-foreground">The Database tab does not depend on the logs and still works.</div>}
      {shown === "db" && <DbQueries />}
      <SampleSheet target={target} range={range} kinds={data?.kinds ?? []} onClose={() => setTarget(null)} />
    </Screen>
  );
}

export default function SlowQueries() {
  return <Suspense fallback={<ScreenSkeleton />}><Inner /></Suspense>;
}
