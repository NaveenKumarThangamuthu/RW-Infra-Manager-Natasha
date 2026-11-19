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
import { ago, isStale, istDateTime, num, usd } from "@/components/natasha/format";
import { Banner, Dot, EmptyState, ErrorNote, Kpi, KpiGrid, PageHeader, Screen, ScreenSkeleton } from "@/components/natasha/primitives";
import { useOnRefreshed, useShell } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { cn, tint } from "@/lib/utils";

type IncidentType = "EC2" | "GITHUB" | "SPRING" | "CLOUDWATCH" | "PROMETHEUS" | "SCAN";
type Severity = "CRIT" | "HIGH" | "WARN" | "INFO";
type Kind = "incident" | "rec";

interface Incident { id: string; type: IncidentType; severity: Severity; title: string; source: string; detail: string | null; detectedAt: string; href: string | null; count?: number }
/** `findings` holds the totals over every open critical and high finding; `incidents` lists only the largest groups. */
interface IncidentsResp { snapshotOldestAt: string | null; incidents: Incident[]; findings?: { CRIT: number; HIGH: number; groups: number; listed: number; windowDays: number } }
interface Rec { kind: string; severity: "INFO" | "WARN" | "CRIT"; message: string; targetType?: string | null; monthlyDeltaUsd?: number | null }
interface RecsResp { fetchedAt: string; analyses: Array<{ instanceId: string; name: string; type: string; recommendations: Rec[] }> }

interface Row {
  key: string; kind: Kind; sev: Severity; title: string; source: string; cat: string; icon: LucideIcon;
  detail: string | null; at: string; href: string | null; target: string | null; delta: number | null;
  /** Findings this row stands for (repository rows are grouped by rule); 0 for everything else. */
  findings: number;
  instanceId: string | null;
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
const PAGE = 25;
const SEV_LABEL = Object.fromEntries(SEV.map((s) => [s.key, s.label])) as Record<Severity, string>;

function SevBadge({ sev }: { sev: Severity }) {
  return <span className="inline-flex h-[22px] items-center rounded-[6px] px-[7px] text-[11.5px] font-semibold tracking-[.03em]" style={{ color: SEV_COLOR[sev], background: tint(SEV_COLOR[sev]) }}>{SEV_LABEL[sev]}</span>;
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
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); }, [tab, sev, q]);

  useEffect(() => {
    try { setAcked(JSON.parse(localStorage.getItem(ACK_KEY) ?? "[]")); } catch { /* storage blocked or corrupt */ }
    if (new URLSearchParams(window.location.search).get("kind") === "rec") setTab("rec");
  }, []);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const i of inc.data?.incidents ?? []) {
      const m = TYPE_META[i.type] ?? { label: i.type, icon: AlertTriangle };
      out.push({ key: `i:${i.id}`, kind: "incident", sev: i.severity, title: i.title, source: i.source, cat: m.label, icon: m.icon, detail: i.detail, at: i.detectedAt, href: i.href, target: null, delta: null, findings: i.type === "GITHUB" ? i.count ?? 1 : 0, instanceId: null });
    }
    for (const a of recs.data?.analyses ?? []) {
      for (const r of a.recommendations) {
        if (r.kind === "ok") continue;
        const m = REC_META[r.kind] ?? { label: r.kind.replace(/-/g, " "), icon: AlertTriangle };
        out.push({
          key: `r:${a.instanceId}:${r.kind}:${r.targetType ?? ""}`, kind: "rec", sev: r.severity, title: r.message, source: `${a.name || a.instanceId} · ${a.type}`,
          cat: m.label, icon: m.icon, detail: null, at: recs.data?.fetchedAt ?? new Date().toISOString(), href: `/perf/ec2/${encodeURIComponent(a.instanceId)}`,
          target: r.targetType ?? null, delta: r.monthlyDeltaUsd ?? null, findings: 0, instanceId: a.instanceId,
        });
      }
    }
    return out
      .filter((r) => !acked.includes(r.key))
      // Within a severity, live service alerts come before the long list of repository findings.
      .sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev] || Number(a.findings > 0) - Number(b.findings > 0)
        || b.findings - a.findings || new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [inc.data, recs.data, acked]);

  // Findings are counted one by one from the server totals (which cover the groups not listed here),
  // so these numbers match the sidebar badge, Home and Repositories. Everything else counts per row.
  const counts = useMemo(() => {
    const c = { incident: 0, rec: 0, CRIT: 0, HIGH: 0, WARN: 0, INFO: 0, savings: 0, savers: 0, findings: 0, alerts: 0 };
    const best = new Map<string, number>();
    for (const r of rows) {
      if (r.findings > 0) continue;
      c[r.kind]++;
      c[r.sev]++;
      if (r.kind === "incident") c.alerts++;
      // An instance often has two alternative moves (t3a or t3): only the better one can be taken.
      if (r.instanceId && r.delta != null && r.delta < 0) best.set(r.instanceId, Math.max(best.get(r.instanceId) ?? 0, -r.delta));
    }
    best.forEach((v) => { c.savings += v; });
    c.savers = best.size;
    const totals = inc.data?.findings;
    const ackedFindings = { CRIT: 0, HIGH: 0 };
    for (const i of inc.data?.incidents ?? []) {
      if (i.type === "GITHUB" && acked.includes(`i:${i.id}`) && (i.severity === "CRIT" || i.severity === "HIGH")) ackedFindings[i.severity] += i.count ?? 1;
    }
    const crit = Math.max(0, (totals?.CRIT ?? 0) - ackedFindings.CRIT);
    const high = Math.max(0, (totals?.HIGH ?? 0) - ackedFindings.HIGH);
    c.CRIT += crit;
    c.HIGH += high;
    c.findings = crit + high;
    c.incident += c.findings;
    return { ...c, findingCrit: crit, findingHigh: high };
  }, [rows, inc.data, acked]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => (tab === "all" || r.kind === tab) && (!sev || r.sev === sev)
      && (!needle || `${r.title} ${r.source} ${r.cat} ${r.detail ?? ""} ${r.target ?? ""}`.toLowerCase().includes(needle)));
  }, [rows, tab, sev, q]);

  const header = (
    <PageHeader title="Alerts & Actions" description="Open incidents, repository findings and per-server recommendations in one list. Filter by kind, severity or source, and open a row for details."
      actions={<Button variant="primary" size="lg" className="px-3.5" disabled={refreshing} onClick={() => void refresh()}>
        <RefreshCw size={14} className={cn("block", refreshing && "animate-nt-spin")} />{refreshing ? "Refreshing…" : "Refresh all sources"}
      </Button>} />
  );

  if (!inc.data && !recs.data && !inc.error && !recs.error) return <ScreenSkeleton />;

  const total = counts.incident + counts.rec;
  const open = openKey ? rows.find((r) => r.key === openKey) ?? null : null;
  const oldest = inc.data?.snapshotOldestAt ?? null;
  const shown = filtered.slice(0, limit);
  const fin = inc.data?.findings;
  const moreGroups = fin ? fin.groups - fin.listed : 0;
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
      {oldest && (isStale(oldest) ? (
        <Banner tone="var(--warning)">
          <span className="text-warning"><Clock size={14} className="block" /></span>
          <span className="min-w-0 flex-[1_1_220px]">The oldest source was last updated <span className="font-semibold">{ago(oldest)}</span> · {istDateTime(oldest)}</span>
          <Badge tone="var(--warning)">Out of date</Badge>
        </Banner>
      ) : (
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Clock size={14} className="block shrink-0" />Data as of {istDateTime(oldest)} · refreshed twice a day
        </div>
      ))}
      <KpiGrid>
        <Kpi label="Open items" value={num(total)}>
          <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-[6px]">
            <span style={{ width: widthOf(counts.CRIT), background: "var(--danger)" }} />
            <span style={{ width: widthOf(counts.HIGH), background: "var(--orange)" }} />
            <span style={{ width: widthOf(counts.WARN), background: "var(--warning)" }} />
            <span className="flex-1" style={{ background: "var(--info)" }} />
          </div>
          <div className="flex flex-wrap gap-2.5 text-[12px] text-muted-foreground tnum">
            {SEV.map((x) => (
              <span key={x.key} className="inline-flex items-center gap-[5px]"><Dot color={x.color} />{num(counts[x.key])} {x.label.toLowerCase()}</span>
            ))}
          </div>
        </Kpi>
        <Kpi label="Incidents" value={num(counts.incident)} valueColor={counts.incident ? "var(--danger)" : "var(--success)"}
          footer={counts.findings > 0
            ? `${num(counts.findingCrit)} critical and ${num(counts.findingHigh)} high repository findings · ${num(counts.alerts)} service and scan alert${counts.alerts === 1 ? "" : "s"}`
            : "Services, alarms and repository scans"} />
        <Kpi label="Recommendations" value={num(counts.rec)} footer="Resizing, newer instance types and stopped servers" />
        <Kpi label="Potential savings" valueColor="var(--success)" footer={counts.savers ? `Best option for each of ${counts.savers} server${counts.savers === 1 ? "" : "s"}` : "No savings identified"}
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
                  <Dot color={s.color} size={7} />{s.label}<span className="text-muted-foreground tnum">{num(counts[s.key])}</span>
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
            {shown.map((r) => {
              const Icon = r.icon;
              return (
                <div key={r.key} role="button" tabIndex={0} onClick={() => setOpenKey(r.key)} onKeyDown={(e) => { if (e.key === "Enter") setOpenKey(r.key); }}
                  className={cn("grid cursor-pointer items-start gap-3.5 border-0 border-b border-solid border-border px-5 py-3.5 hover:bg-hover", openKey === r.key && "bg-hover")} style={{ gridTemplateColumns: COLS }}>
                  <div className="flex flex-col items-start gap-1.5">
                    <SevBadge sev={r.sev} />
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-fg-2"><span className="text-muted-foreground"><Icon size={14} className="block" /></span>{r.cat}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium leading-[1.45] text-wrap-pretty">
                      {r.title}{r.findings > 1 && <span className="ml-2 inline-flex h-[18px] items-center rounded-[5px] bg-card-2 px-1.5 align-middle text-[11.5px] font-semibold text-fg-2 tnum">× {num(r.findings)}</span>}
                    </div>
                    {r.detail && <div className="mt-[5px] max-h-[3.1em] overflow-hidden break-words font-mono text-[11.5px] leading-[1.55] text-muted-foreground">{r.detail}</div>}
                    {r.target && <div className="mt-[5px] text-[12px] text-muted-foreground">Target <span className="font-mono text-fg-2">{r.target}</span></div>}
                  </div>
                  <span className="break-all font-mono text-[12px] leading-[1.55] text-fg-2">{r.source}</span>
                  <span className="whitespace-nowrap text-[13px] font-semibold tnum" style={{ color: r.delta != null && r.delta < 0 ? "var(--success)" : r.delta != null ? "var(--danger)" : "var(--muted-fg)" }}>{impactText(r.delta)}</span>
                  <span className="whitespace-nowrap text-[12.5px] text-muted-foreground" title={istDateTime(r.at)}>{ago(r.at)}</span>
                  <span className="pt-[3px] text-subtle"><ChevronRight size={14} className="block" /></span>
                </div>
              );
            })}
            {filtered.length === 0 && (total === 0
              ? <EmptyState title="All clear">No open incidents or recommendations.</EmptyState>
              : <EmptyState title="No matches">No loaded items match these filters.</EmptyState>)}
          </div>
        </div>
        {filtered.length > shown.length && (
          <div className="flex justify-center border-0 border-b border-solid border-border px-5 py-3">
            <Button size="sm" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, filtered.length - shown.length)} more</Button>
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 px-5 py-3 text-[12.5px] text-muted-foreground">
          <span className="tnum">
            Showing {num(shown.length)} of {num(filtered.length)} rows
            {fin && fin.groups > 0 && tab !== "rec" && ` · ${num(fin.CRIT + fin.HIGH)} findings from the last ${fin.windowDays} days, grouped by repository and rule${moreGroups > 0 ? `; the largest ${num(fin.listed)} of ${num(fin.groups)} groups are listed` : ""}`}
          </span>
          <span>Sorted by severity: service alerts first, then the largest finding groups</span>
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
                      <div className="mb-2 text-[12px] font-medium text-muted-foreground">{open.cat === "Spring" ? "Latest error in the logs" : "Details"}</div>
                      <div className="whitespace-pre-wrap break-words rounded-[10px] border border-solid border-border bg-card-2 px-3.5 py-3 font-mono text-[12px] leading-[1.65] text-fg-2">{open.detail}</div>
                    </div>
                  )}
                  <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-3 text-[13px]">
                    <Field label="Source"><span className="break-all font-mono text-[12.5px]">{open.source}</span></Field>
                    <Field label="Category">{open.cat}</Field>
                    <Field label="Detected">{ago(open.at)} · {istDateTime(open.at)}</Field>
                    {open.findings > 0 && <Field label="Findings"><span className="font-medium tnum">{num(open.findings)}</span></Field>}
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
