"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, BatteryLow, ChevronRight, Clock, Cloud, Cpu, ExternalLink, GitBranch, HardDrive,
  Pause, RefreshCw, Rocket, Scaling, ScanSearch, Server, Sprout, X, type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ago, ageMinutes, num, usd } from "@/components/natasha/format";
import { Banner, Dot, EmptyState, ErrorNote, Kpi, KpiGrid, PageHeader, Screen, ScreenSkeleton } from "@/components/natasha/primitives";
import { useOnRefreshed, useShell } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { cn, tint } from "@/lib/utils";

type IncidentType = "EC2" | "GITHUB" | "SPRING" | "CLOUDWATCH" | "PROMETHEUS" | "SCAN";
type Severity = "CRIT" | "HIGH" | "WARN" | "INFO";
type Kind = "incident" | "rec";

interface Incident { id: string; type: IncidentType; severity: Severity; title: string; source: string; detail: string | null; detectedAt: string; href: string | null }
interface IncidentsResp { snapshotOldestAt: string | null; incidents: Incident[] }
interface Rec { kind: string; severity: "INFO" | "WARN" | "CRIT"; message: string; targetType?: string | null; monthlyDeltaUsd?: number | null }
interface RecsResp { fetchedAt: string; analyses: Array<{ instanceId: string; name: string; type: string; recommendations: Rec[] }> }

interface Row {
  key: string; kind: Kind; sev: Severity; title: string; source: string; cat: string; icon: LucideIcon;
  detail: string | null; at: string; href: string | null; target: string | null; delta: number | null;
}

const SEV: Array<{ key: Severity; label: string; color: string }> = [
  { key: "CRIT", label: "Critical", color: "var(--danger)" },
  { key: "HIGH", label: "High", color: "var(--orange)" },
  { key: "WARN", label: "Warning", color: "var(--warning)" },
  { key: "INFO", label: "Info", color: "var(--info)" },
];
const SEV_COLOR = Object.fromEntries(SEV.map((s) => [s.key, s.color])) as Record<Severity, string>;
const SEV_RANK: Record<Severity, number> = { CRIT: 0, HIGH: 1, WARN: 2, INFO: 3 };

const TYPE_META: Record<IncidentType, { label: string; icon: LucideIcon }> = {
  EC2: { label: "EC2", icon: Server },
  GITHUB: { label: "GitHub", icon: GitBranch },
  SPRING: { label: "Spring", icon: Sprout },
  CLOUDWATCH: { label: "CloudWatch", icon: Cloud },
  PROMETHEUS: { label: "Prometheus", icon: Activity },
  SCAN: { label: "Scans", icon: ScanSearch },
};
const REC_META: Record<string, { label: string; icon: LucideIcon }> = {
  "cpu-upsize": { label: "CPU upsize", icon: ArrowUp },
  "cpu-downsize": { label: "CPU downsize", icon: ArrowDown },
  "rightsizing-downsize": { label: "Rightsize", icon: Scaling },
  "memory-pressure": { label: "Memory", icon: Cpu },
  "disk-full": { label: "Disk full", icon: HardDrive },
  "disk-near-full": { label: "Disk near full", icon: HardDrive },
  "credits-low": { label: "Credits low", icon: BatteryLow },
  modernize: { label: "Modernize", icon: Rocket },
  stopped: { label: "Stopped", icon: Pause },
  "analysis-error": { label: "Analysis error", icon: AlertTriangle },
};

const COLS = "118px minmax(260px,1fr) 190px 84px 72px 16px";
const ACK_KEY = "natasha-acked-alerts";

function SevBadge({ sev }: { sev: Severity }) {
  return <span className="inline-flex h-[22px] items-center rounded-[6px] px-[7px] text-[11.5px] font-semibold tracking-[.03em]" style={{ color: SEV_COLOR[sev], background: tint(SEV_COLOR[sev]) }}>{sev}</span>;
}

function impactText(delta: number | null): string {
  if (delta == null) return "—";
  return `${delta < 0 ? "−" : "+"}$${Math.abs(delta).toFixed(0)}/mo`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <><span className="text-muted-foreground">{label}</span><span className="min-w-0">{children}</span></>;
}

export default function Alerts() {
  const router = useRouter();
  const { refresh, refreshing, toast } = useShell();
  const inc = useJson<IncidentsResp>("/api/incidents");
  const recs = useJson<RecsResp>("/api/perf/recommendations");
  useOnRefreshed(() => { inc.reload(); recs.reload(); });

  const [tab, setTab] = useState<Kind | "all">("all");
  const [sev, setSev] = useState<Severity | "">("");
  const [q, setQ] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [acked, setAcked] = useState<string[]>([]);

  useEffect(() => {
    try { setAcked(JSON.parse(localStorage.getItem(ACK_KEY) ?? "[]")); } catch { /* storage blocked or corrupt */ }
    if (new URLSearchParams(window.location.search).get("kind") === "rec") setTab("rec");
  }, []);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const i of inc.data?.incidents ?? []) {
      const m = TYPE_META[i.type] ?? { label: i.type, icon: AlertTriangle };
      out.push({ key: `i:${i.id}`, kind: "incident", sev: i.severity, title: i.title, source: i.source, cat: m.label, icon: m.icon, detail: i.detail, at: i.detectedAt, href: i.href, target: null, delta: null });
    }
    for (const a of recs.data?.analyses ?? []) {
      for (const r of a.recommendations) {
        if (r.kind === "ok") continue;
        const m = REC_META[r.kind] ?? { label: r.kind.replace(/-/g, " "), icon: AlertTriangle };
        out.push({
          key: `r:${a.instanceId}:${r.kind}:${r.targetType ?? ""}`, kind: "rec", sev: r.severity, title: r.message, source: `${a.name || a.instanceId} · ${a.type}`,
          cat: m.label, icon: m.icon, detail: null, at: recs.data?.fetchedAt ?? new Date().toISOString(), href: `/perf/ec2/${encodeURIComponent(a.instanceId)}`,
          target: r.targetType ?? null, delta: r.monthlyDeltaUsd ?? null,
        });
      }
    }
    return out
      .filter((r) => !acked.includes(r.key))
      .sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev] || new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [inc.data, recs.data, acked]);

  const counts = useMemo(() => {
    const c = { incident: 0, rec: 0, CRIT: 0, HIGH: 0, WARN: 0, INFO: 0, savings: 0 };
    for (const r of rows) {
      c[r.kind]++;
      c[r.sev]++;
      if (r.delta != null && r.delta < 0) c.savings += -r.delta;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => (tab === "all" || r.kind === tab) && (!sev || r.sev === sev)
      && (!needle || `${r.title} ${r.source} ${r.cat} ${r.detail ?? ""} ${r.target ?? ""}`.toLowerCase().includes(needle)));
  }, [rows, tab, sev, q]);

  const header = (
    <PageHeader title="Alerts & Actions" description="Unified feed of open incidents plus per-instance recommendations. Filter by kind, severity, or source; open any row for details and actions."
      actions={<Button variant="primary" size="lg" className="px-3.5" disabled={refreshing} onClick={() => void refresh()}>
        <RefreshCw size={14} className={cn("block", refreshing && "animate-nt-spin")} />{refreshing ? "Refreshing…" : "Refresh all sources"}
      </Button>} />
  );

  if (!inc.data && !recs.data && !inc.error && !recs.error) return <ScreenSkeleton />;

  const total = rows.length;
  const open = openKey ? rows.find((r) => r.key === openKey) ?? null : null;
  const oldest = inc.data?.snapshotOldestAt ?? null;
  const oldestMin = ageMinutes(oldest);
  const widthOf = (n: number) => (total ? `${(n / total) * 100}%` : "0%");

  const acknowledge = (key: string) => {
    const next = [...acked, key];
    setAcked(next);
    setOpenKey(null);
    try { localStorage.setItem(ACK_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
    toast("Acknowledged in this browser");
  };

  return (
    <Screen label="Alerts and Actions">
      {header}
      {(inc.error || recs.error) && <ErrorNote message={inc.error ?? recs.error ?? ""} onRetry={() => { inc.reload(); recs.reload(); }} />}
      {oldest && oldestMin != null && oldestMin > 30 && (
        <Banner tone="var(--warning)">
          <span className="text-warning"><Clock size={14} className="block" /></span>
          <span className="min-w-0 flex-[1_1_220px]">Oldest external snapshot <span className="font-semibold">{ago(oldest)}</span> · {new Date(oldest).toLocaleString()}</span>
          <Badge tone="var(--warning)">Stale · over 30 min</Badge>
        </Banner>
      )}
      <KpiGrid>
        <Kpi label="Open items" value={num(total)}>
          <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-[6px]">
            <span style={{ width: widthOf(counts.CRIT), background: "var(--danger)" }} />
            <span style={{ width: widthOf(counts.HIGH), background: "var(--orange)" }} />
            <span style={{ width: widthOf(counts.WARN), background: "var(--warning)" }} />
            <span className="flex-1" style={{ background: "var(--info)" }} />
          </div>
          <div className="flex flex-wrap gap-2.5 text-[12px] text-muted-foreground tnum">
            {([["CRIT", "Crit"], ["HIGH", "High"], ["WARN", "Warn"], ["INFO", "Info"]] as const).map(([k, l]) => (
              <span key={k} className="inline-flex items-center gap-[5px]"><Dot color={SEV_COLOR[k]} />{counts[k]} {l}</span>
            ))}
          </div>
        </Kpi>
        <Kpi label="Incidents" value={num(counts.incident)} valueColor={counts.incident ? "var(--danger)" : "var(--success)"} footer="Spring, Prometheus, CloudWatch and scans" />
        <Kpi label="Recommendations" value={num(counts.rec)} footer="Rightsizing, modernize and stopped instances" />
        <Kpi label="Potential savings" valueColor="var(--success)" footer="If every recommendation ships"
          value={<>{usd(counts.savings, 0)}<span className="text-[15px] font-medium tracking-normal text-muted-foreground">/mo</span></>} />
      </KpiGrid>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 border-0 border-b border-solid border-border px-4 py-3.5">
          <Segmented size="md" value={tab} onChange={setTab} aria-label="Kind" options={[
            { value: "all", label: "All", count: total },
            { value: "incident", label: "Incidents", count: counts.incident },
            { value: "rec", label: "Recommendations", count: counts.rec },
          ]} />
          <SearchInput wrapperClassName="min-w-[200px] flex-[0_1_300px]" placeholder="Search title, source, category…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="ml-auto flex flex-wrap gap-1.5">
            {SEV.map((s) => {
              const on = sev === s.key;
              return (
                <button key={s.key} type="button" aria-pressed={on} onClick={() => setSev(on ? "" : s.key)}
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-dashed px-2.5 text-[12.5px] font-medium text-foreground hover:border-border-strong"
                  style={{ borderColor: on ? `color-mix(in oklab, ${s.color} 45%, transparent)` : "var(--border)", background: on ? tint(s.color) : "transparent" }}>
                  <Dot color={s.color} size={7} />{s.label}<span className="text-muted-foreground tnum">{counts[s.key]}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <div className="grid h-[38px] items-center gap-3.5 border-0 border-b border-solid border-border bg-card-2 px-5 text-[12px] font-medium text-muted-foreground" style={{ gridTemplateColumns: COLS }}>
              <span>Severity</span><span>What</span><span>Source</span><span>Impact</span><span>Detected</span><span />
            </div>
            {filtered.map((r) => {
              const Icon = r.icon;
              return (
                <div key={r.key} role="button" tabIndex={0} onClick={() => setOpenKey(r.key)} onKeyDown={(e) => { if (e.key === "Enter") setOpenKey(r.key); }}
                  className={cn("grid cursor-pointer items-start gap-3.5 border-0 border-b border-solid border-border px-5 py-3.5 hover:bg-hover", openKey === r.key && "bg-hover")} style={{ gridTemplateColumns: COLS }}>
                  <div className="flex flex-col items-start gap-1.5">
                    <SevBadge sev={r.sev} />
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-fg-2"><span className="text-muted-foreground"><Icon size={14} className="block" /></span>{r.cat}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium leading-[1.45] text-wrap-pretty">{r.title}</div>
                    {r.detail && <div className="mt-[5px] max-h-[3.1em] overflow-hidden break-words font-mono text-[11.5px] leading-[1.55] text-muted-foreground">{r.detail}</div>}
                    {r.target && <div className="mt-[5px] text-[12px] text-muted-foreground">Target <span className="font-mono text-fg-2">{r.target}</span></div>}
                  </div>
                  <span className="break-all font-mono text-[12px] leading-[1.55] text-fg-2">{r.source}</span>
                  <span className="whitespace-nowrap text-[13px] font-semibold tnum" style={{ color: r.delta != null && r.delta < 0 ? "var(--success)" : r.delta != null ? "var(--danger)" : "var(--muted-fg)" }}>{impactText(r.delta)}</span>
                  <span className="whitespace-nowrap text-[12.5px] text-muted-foreground" title={new Date(r.at).toLocaleString()}>{ago(r.at)}</span>
                  <span className="pt-[3px] text-subtle"><ChevronRight size={14} className="block" /></span>
                </div>
              );
            })}
            {filtered.length === 0 && (total === 0
              ? <EmptyState title="All clear">No open incidents or recommendations.</EmptyState>
              : <EmptyState title="No matches">No loaded items match these filters.</EmptyState>)}
          </div>
        </div>
        <div className="flex justify-between gap-3 px-5 py-3 text-[12.5px] text-muted-foreground">
          <span className="tnum">Showing {filtered.length} of {tab === "all" ? total : counts[tab]}</span><span>Sorted by severity, then newest</span>
        </div>
      </Card>
      <Sheet open={!!open} onOpenChange={(v) => { if (!v) setOpenKey(null); }}>
        <SheetContent>
          {open && (() => {
            const Icon = open.icon;
            return (
              <>
                <div className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-border px-4 py-3.5">
                  <SevBadge sev={open.sev} />
                  <Badge className="text-fg-2">{open.kind === "incident" ? "Incident" : "Recommendation"}</Badge>
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-2"><span className="text-muted-foreground"><Icon size={14} className="block" /></span>{open.cat}</span>
                  <SheetClose title="Close" className="ml-auto inline-grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-[8px] border-none bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground"><X size={16} className="block" /></SheetClose>
                </div>
                <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
                  <SheetTitle className="m-0 text-[18px] font-semibold leading-[1.4] tracking-[-0.015em] text-wrap-pretty">{open.title}</SheetTitle>
                  {open.detail && (
                    <div>
                      <div className="mb-2 text-[12px] font-medium text-muted-foreground">Latest log entry</div>
                      <div className="whitespace-pre-wrap break-words rounded-[10px] border border-solid border-border bg-card-2 px-3.5 py-3 font-mono text-[12px] leading-[1.65] text-fg-2">{open.detail}</div>
                    </div>
                  )}
                  <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-3 text-[13px]">
                    <Field label="Source"><span className="break-all font-mono text-[12.5px]">{open.source}</span></Field>
                    <Field label="Category">{open.cat}</Field>
                    <Field label="Detected">{ago(open.at)}</Field>
                    <Field label="Impact"><span className="font-medium tnum">{impactText(open.delta)}</span></Field>
                    {open.target && <Field label="Target type"><span className="font-mono text-[12.5px]">{open.target}</span></Field>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 border-0 border-t border-solid border-border px-4 py-3.5">
                  {open.href && (
                    <Button variant="primary" className="px-3.5" onClick={() => {
                      if (/^https?:/.test(open.href!)) window.open(open.href!, "_blank", "noopener");
                      else router.push(open.href!);
                    }}><ExternalLink size={14} className="block" />{open.kind === "incident" ? "Open source" : "Open instance"}</Button>
                  )}
                  <Button variant="ghost" className="ml-auto" onClick={() => acknowledge(open.key)}>Acknowledge</Button>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </Screen>
  );
}
