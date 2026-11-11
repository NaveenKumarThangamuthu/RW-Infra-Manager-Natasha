"use client";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, ChevronUp, Clock, Download, List, RefreshCw, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { downloadCsv, toCsv } from "@/components/csv";
import { CheckButton } from "@/components/natasha/CheckButton";
import { ago, bytes, isStale, num } from "@/components/natasha/format";
import { Banner, EmptyState, ErrorNote, PageHeader, Screen, ScreenSkeleton, StatStrip } from "@/components/natasha/primitives";
import { useOnRefreshed, useShell } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { cn } from "@/lib/utils";
import { buildLogLookup, jobShortName, type DetailState, type DetailWindow, type HealthResp, type LogResp, type SpringServiceHealth } from "./data";
import { ServiceDetail } from "./ServiceDetail";

const COLS = "20px minmax(240px,2fr) 116px 64px 56px minmax(170px,1fr)";
type SortKey = "name" | "err" | "cpu" | "heap";
const WINDOWS: DetailWindow[] = ["15m", "1h", "6h", "24h"];

function Inner() {
  const params = useSearchParams();
  const { refresh, refreshing, toast } = useShell();
  const health = useJson<HealthResp>("/api/perf/spring");
  const logs = useJson<LogResp>("/api/perf/spring/logs?window=1h");
  useOnRefreshed(() => { health.reload(); logs.reload(); });

  const [view, setView] = useState<"list" | "server">("list");
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [job, setJob] = useState("all");
  const [downOnly, setDownOnly] = useState(false);
  const [errOnly, setErrOnly] = useState(false);
  const [win, setWin] = useState<DetailWindow>("1h");
  const [sort, setSort] = useState<SortKey>("err");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const inflight = useRef(new Set<string>());

  useEffect(() => { setQ(params.get("q") ?? ""); }, [params]);

  const rows = useMemo(() => health.data?.services ?? [], [health.data]);
  const logLookup = useMemo(() => buildLogLookup(logs.data?.services ?? []), [logs.data]);
  const jobs = useMemo(() => Array.from(new Set(rows.map((r) => r.job))).sort(), [rows]);

  const fetchDetails = useCallback(async (prom: string, elk: string, w: DetailWindow) => {
    const key = `${prom}__${w}`;
    if (inflight.current.has(key)) return;
    inflight.current.add(key);
    setDetails((p) => ({ ...p, [prom]: { loading: true } }));
    try {
      const res = await fetch(`/api/perf/spring/logs/details?service=${encodeURIComponent(elk)}&window=${w}&size=100`);
      const text = await res.text();
      if (/^\s*<(!doctype|html|head|body)/i.test(text)) {
        throw new Error(res.url.includes("/login") ? "Session expired — please sign in again." : `Logs request failed (${res.status}). ELK may be slow — try again in a moment.`);
      }
      const body = text ? JSON.parse(text) : {};
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setDetails((p) => ({ ...p, [prom]: body }));
    } catch (e) {
      setDetails((p) => ({ ...p, [prom]: { error: e instanceof Error ? e.message : String(e) } }));
    } finally {
      inflight.current.delete(key);
    }
  }, []);

  const toggle = (name: string) => {
    const next = new Set(open);
    if (next.has(name)) next.delete(name);
    else {
      next.add(name);
      const elk = logLookup(name)?.service;
      const cached = details[name];
      if (elk && (!cached || "error" in cached)) void fetchDetails(name, elk, win);
    }
    setOpen(next);
  };

  const changeWindow = (w: DetailWindow) => {
    setWin(w);
    setDetails({});
    for (const name of Array.from(open)) {
      const elk = logLookup(name)?.service;
      if (elk) void fetchDetails(name, elk, w);
    }
  };

  const errOf = useCallback((r: SpringServiceHealth) => logLookup(r.serviceName)?.errors ?? 0, [logLookup]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => (job === "all" || r.job === job) && (!downOnly || !r.up) && (!errOnly || errOf(r) > 0)
      && (!needle || r.serviceName.toLowerCase().includes(needle) || r.instance.toLowerCase().includes(needle)));
    const sign = dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sort === "name") return sign * a.serviceName.localeCompare(b.serviceName);
      if (sort === "cpu") return sign * ((a.cpu ?? -1) - (b.cpu ?? -1));
      if (sort === "heap") return sign * ((a.heapPct ?? -1) - (b.heapPct ?? -1));
      return sign * (errOf(a) - errOf(b));
    });
  }, [rows, q, job, downOnly, errOnly, sort, dir, errOf]);

  const groups = useMemo(() => {
    if (view === "list") return null;
    const m = new Map<string, SpringServiceHealth[]>();
    for (const r of filtered) {
      const host = r.instance.split(":")[0] || "unknown";
      m.set(host, [...(m.get(host) ?? []), r]);
    }
    return Array.from(m.entries())
      .map(([host, services]) => ({ host, services, errors: services.reduce((n, s) => n + errOf(s), 0) }))
      .sort((a, b) => b.errors - a.errors || a.host.localeCompare(b.host));
  }, [view, filtered, errOf]);

  const onSort = (k: SortKey) => {
    if (sort === k) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(k); setDir(k === "name" ? "asc" : "desc"); }
  };
  const SortHead = ({ k, children, end }: { k: SortKey; children: React.ReactNode; end?: boolean }) => (
    <button type="button" onClick={() => onSort(k)} className={cn("inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[12px] font-medium text-muted-foreground hover:text-foreground", end && "justify-end")}>
      {children}{sort === k && (dir === "asc" ? <ChevronUp size={12} className="block" /> : <ChevronDown size={12} className="block" />)}
    </button>
  );

  const header = (
    <PageHeader maxWidth={780} title="Spring Services" description="Health (Prometheus) + ERROR/WARN log stats (DEV ELK) in one view. Click any row to see recent ERROR entries (deduplicated by pattern)."
      actions={<Button variant="primary" size="lg" className="px-3.5" disabled={refreshing} onClick={() => void refresh(["spring-health", "spring-logs"])}>
        <RefreshCw size={14} className={cn("block", refreshing && "animate-nt-spin")} />Refresh data
      </Button>} />
  );

  if (health.error) return <Screen label="Spring Services">{header}<ErrorNote message={health.error} onRetry={health.reload} /></Screen>;
  if (!health.data) return <ScreenSkeleton kpis={4} />;

  const down = rows.filter((r) => !r.up).length;
  const highHeap = rows.filter((r) => r.heapPct != null && r.heapPct > 85).length;
  const erroring = rows.filter((r) => errOf(r) > 0).length;
  const totalErrors = (logs.data?.services ?? []).reduce((n, s) => n + s.errors, 0);
  const anyOpen = open.size > 0;
  const good = (n: number) => (n > 0 ? "var(--danger)" : "var(--success)");

  const Row = (r: SpringServiceHealth) => {
    const log = logLookup(r.serviceName);
    const isOpen = open.has(r.serviceName);
    const errs = log?.errors ?? 0;
    const heap = r.heapPct;
    const heapColor = heap == null ? "var(--subtle-fg)" : heap >= 85 ? "var(--danger)" : heap >= 70 ? "var(--warning)" : "var(--success)";
    const statusColor = r.up ? "var(--success)" : "var(--danger)";
    return (
      <Fragment key={`${r.serviceName}-${r.instance}-${r.job}`}>
        <div role="button" tabIndex={0} onClick={() => toggle(r.serviceName)} onKeyDown={(e) => { if (e.key === "Enter") toggle(r.serviceName); }}
          className={cn("grid min-h-14 cursor-pointer items-center gap-3.5 border-0 border-b border-solid border-border px-5 py-2 hover:bg-hover", isOpen && "bg-hover")} style={{ gridTemplateColumns: COLS }}>
          <span className={cn("grid place-items-center text-muted-foreground transition-transform duration-150", isOpen && "rotate-90")}><ChevronRight size={14} className="block" /></span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13.5px] font-medium">{r.serviceName}</span>
              {["Java", "Spring"].map((t) => <span key={t} className="shrink-0 rounded-[4px] border border-solid border-border px-[5px] text-[10.5px] font-medium text-muted-foreground">{t}</span>)}
            </div>
            <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{r.job} · <span className="font-mono">{r.instance}</span></div>
          </div>
          <div className="text-right">
            <div className="text-[13px] font-semibold tnum" style={{ color: errs ? (errs >= 1000 ? "var(--danger)" : "var(--fg)") : "var(--subtle-fg)" }}>{errs ? num(errs) : "—"}</div>
            {log && errs > 0 && <div className="mt-0.5 whitespace-nowrap text-[11px] text-muted-foreground tnum">{(log.errorRate * 100).toFixed(2)}% of {num(log.total)} req</div>}
          </div>
          <Badge tone={statusColor} className="justify-self-start gap-[5px] text-[11.5px] font-semibold">
            <span className="h-1.5 w-1.5 rounded-[6px]" style={{ background: statusColor }} />{r.up ? "UP" : "DOWN"}
          </Badge>
          <span className="text-[12.5px] tnum">{r.cpu != null ? `${(r.cpu * 100).toFixed(1)}%` : "—"}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-1.5 flex-1 overflow-hidden rounded-[6px] bg-card-2"><span className="block h-full rounded-[6px]" style={{ width: `${Math.max(2, Math.min(100, heap ?? 0))}%`, background: heapColor }} /></span>
              <span className="w-[30px] text-right text-[12px] font-medium tnum">{heap != null ? `${heap.toFixed(0)}%` : "—"}</span>
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{bytes(r.heapUsedBytes)} / {bytes(r.heapMaxBytes)}</div>
          </div>
        </div>
        {isOpen && <ServiceDetail name={r.serviceName} hasElk={!!log} detail={details[r.serviceName]} window={win} />}
      </Fragment>
    );
  };

  const promAt = health.data.fetchedAt;
  const elkAt = logs.data?.fetchedAt ?? null;

  return (
    <Screen label="Spring Services">
      {header}
      {logs.data?.via === "public" && <Banner tone="var(--warning)">Using the public ELK endpoint — the LAN URL is unreachable, so logs come from the slower route.</Banner>}
      <StatStrip items={[
        { label: "Total services", value: num(rows.length) },
        { label: "Down", value: num(down), color: good(down) },
        { label: "Heap over 85%", value: num(highHeap), color: good(highHeap) },
        { label: "Erroring · 1h", value: num(erroring), color: good(erroring) },
        { label: "Errors · 1h", value: num(totalErrors), color: good(totalErrors) },
      ]} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 px-4 pb-2.5 pt-3.5">
          <Segmented size="md" value={view} onChange={setView} aria-label="View" options={[
            { value: "list", label: "List", icon: <List size={12} className="block" /> },
            { value: "server", label: "By server", icon: <Server size={12} className="block" /> },
          ]} />
          <SearchInput wrapperClassName="min-w-[200px] flex-[0_1_280px]" placeholder="Search service or host…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Segmented value={job} onChange={setJob} aria-label="Job" options={[{ value: "all", label: "All jobs" }, ...jobs.map((j) => ({ value: j, label: jobShortName(j) }))]} />
          <CheckButton on={downOnly} onClick={() => setDownOnly((v) => !v)}>Down only</CheckButton>
          <CheckButton on={errOnly} onClick={() => setErrOnly((v) => !v)}>With errors</CheckButton>
          <Button size="sm" className="ml-auto h-8 text-[12.5px]" onClick={() => {
            downloadCsv("spring-services.csv", toCsv(filtered.map((r) => {
              const log = logLookup(r.serviceName);
              return {
                serviceName: r.serviceName, job: r.job, instance: r.instance, up: r.up ? "UP" : "DOWN",
                cpuPct: r.cpu != null ? +(r.cpu * 100).toFixed(2) : null, heapPct: r.heapPct != null ? +r.heapPct.toFixed(2) : null,
                heapUsedBytes: r.heapUsedBytes, heapMaxBytes: r.heapMaxBytes, errors: log?.errors ?? 0, warns: log?.warns ?? 0, total: log?.total ?? 0,
                errorRatePct: log ? +(log.errorRate * 100).toFixed(4) : 0, latestError: log?.latestError?.message?.slice(0, 200) ?? "",
              };
            }), [
              { key: "serviceName", label: "Service" }, { key: "job", label: "Job" }, { key: "instance", label: "Instance" }, { key: "up", label: "Status" },
              { key: "cpuPct", label: "CPU %" }, { key: "heapPct", label: "Heap %" }, { key: "heapUsedBytes", label: "Heap used (B)" }, { key: "heapMaxBytes", label: "Heap max (B)" },
              { key: "errors", label: "ERROR (1h)" }, { key: "warns", label: "WARN (1h)" }, { key: "total", label: "Total (1h)" }, { key: "errorRatePct", label: "Error rate %" },
              { key: "latestError", label: "Latest ERROR (excerpt)" },
            ]));
            toast(`Exported ${filtered.length} services to CSV`);
          }}><Download size={14} className="block" />Export CSV</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 border-0 border-b border-solid border-border px-4 pb-3.5">
          <span title="Time window for the ERROR entries shown when a row is expanded">
            <Segmented size="xs" value={win} onChange={changeWindow} aria-label="Log window" options={WINDOWS.map((w) => ({ value: w, label: w }))} />
          </span>
          <Badge size="md" tone={isStale(promAt) ? "var(--warning)" : "var(--success)"}><Clock size={12} className="block" />Prometheus {ago(promAt)}</Badge>
          <Badge size="md" tone={isStale(elkAt) ? "var(--warning)" : "var(--success)"}><Clock size={12} className="block" />ELK logs {ago(elkAt)}</Badge>
          <Button variant="ghost" size="xs" onClick={() => {
            if (anyOpen) { setOpen(new Set()); return; }
            const withErrors = filtered.filter((r) => errOf(r) > 0);
            for (const r of withErrors) {
              const elk = logLookup(r.serviceName)?.service;
              const cached = details[r.serviceName];
              if (elk && (!cached || "error" in cached)) void fetchDetails(r.serviceName, elk, win);
            }
            setOpen(new Set(withErrors.map((r) => r.serviceName)));
          }}><ChevronDown size={12} className="block" />{anyOpen ? "Collapse all" : "Expand with errors"}</Button>
          <span className="ml-auto text-[12.5px] text-muted-foreground tnum">Showing {filtered.length} of {rows.length} services</span>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[780px]">
            <div className="grid h-[38px] items-center gap-3.5 border-0 border-b border-solid border-border bg-card-2 px-5 text-[12px] font-medium text-muted-foreground" style={{ gridTemplateColumns: COLS }}>
              <span />
              <SortHead k="name">Service</SortHead>
              <SortHead k="err" end>Errors (1h)</SortHead>
              <span>Status</span>
              <SortHead k="cpu">CPU</SortHead>
              <SortHead k="heap">Heap</SortHead>
            </div>
            {groups ? groups.map((g) => (
              <Fragment key={g.host}>
                <div className="flex h-9 items-center gap-2.5 border-0 border-b border-solid border-border bg-card-2 px-5 text-[12.5px]">
                  <span className="text-muted-foreground"><Server size={14} className="block" /></span>
                  <span className="font-mono font-medium">{g.host}</span>
                  <span className="text-muted-foreground">{g.services.length} service{g.services.length === 1 ? "" : "s"} · {g.errors ? `${num(g.errors)} errors` : "no errors"}</span>
                </div>
                {g.services.map(Row)}
              </Fragment>
            )) : filtered.map(Row)}
            {filtered.length === 0 && <EmptyState title="Nothing to show">{downOnly ? "No services are down right now." : "No services match these filters."}</EmptyState>}
          </div>
        </div>
        {logs.error && <div className="border-0 border-t border-solid border-border px-5 py-3 text-[12.5px] text-muted-foreground">Log data unavailable: {logs.error}</div>}
      </Card>
    </Screen>
  );
}

export default function SpringServices() {
  return <Suspense fallback={<ScreenSkeleton />}><Inner /></Suspense>;
}
