"use client";
import { Fragment, Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowRight, Check, ChevronRight, Clock, Download, ExternalLink, Minus, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { downloadCsv, toCsv } from "@/components/csv";
import Ec2InstanceDetail from "@/components/Ec2InstanceDetail";
import { CheckButton } from "@/components/natasha/CheckButton";
import { ago, CATEGORY_META, isStale, usd } from "@/components/natasha/format";
import { MonthPicker } from "@/components/natasha/MonthPicker";
import { Banner, Dot, EmptyState, ErrorNote, Kpi, KpiGrid, PageHeader, Screen, ScreenSkeleton, ShareBar } from "@/components/natasha/primitives";
import { useOnRefreshed, useShell } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { useMonthParam } from "@/components/useMonth";
import { cn, tint } from "@/lib/utils";

interface AllocRow {
  instanceId: string; name: string; region: string; type: string; state: string; category: string; publicIp: string; privateIp: string; vpcId: string;
  compute: number; dataTransfer: number; ebs: number; eip: number; other: number; total: number; unit: string;
}
interface AllocResp {
  month?: string | null; range14: { Start: string; End: string }; monthRange: { Start: string; End: string };
  totals: { compute: number; dataTransfer: number; ebs: number; eip: number; unattributedEc2Other: number; total: number };
  rows: AllocRow[]; monthEc2Total: number; stale?: boolean; asOf?: string;
}
interface Health { instanceId: string; systemCheck: string; instanceCheck: string; overallOk: boolean }
interface HealthResp { fetchedAt: string; instances: Health[] }
interface IssueBucket { incidents: number; recommendations: number }

const COLS = "16px minmax(230px,1.6fr) 92px 86px 110px 96px 88px 118px 84px";
const COMP_COLS = "minmax(0,1fr) minmax(48px,1.4fr) 52px 84px";
const TAG_COLOR: Record<string, string> = { ...Object.fromEntries(CATEGORY_META.map((c) => [c.key, c.color])), Unmapped: "var(--danger)", "Credits/Savings": "var(--info)" };
const colorOf = (c: string) => TAG_COLOR[c] ?? "var(--cother)";
const TAG_OPTIONS = CATEGORY_META.map((c) => c.key);
const KV = "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 rounded-[10px] border border-solid border-border bg-card px-3.5 py-3 text-[12.5px]";

function Inner() {
  const month = useMonthParam();
  const { refresh, refreshing, toast } = useShell();
  const [view, setView] = useState<"month" | "14d">("month");
  const alloc = useJson<AllocResp>(`/api/cost/allocation?mode=${view}${month ? `&month=${month}` : ""}`);
  const health = useJson<HealthResp>("/api/perf/ec2");
  const { data: issues } = useJson<{ ec2: Record<string, IssueBucket> }>("/api/issues/summary");
  useOnRefreshed(() => { alloc.reload(); health.reload(); });

  const [tag, setTag] = useState("all");
  const [q, setQ] = useState("");
  const [problems, setProblems] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [metrics, setMetrics] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Cost Explorer calls are billable, so the other period only loads once a row is opened.
  const [otherRows, setOtherRows] = useState<Record<string, number> | null>(null);

  const healthBy = useMemo(() => new Map((health.data?.instances ?? []).map((h) => [h.instanceId, h])), [health.data]);
  const rows = useMemo(() => alloc.data?.rows ?? [], [alloc.data]);
  const needle = q.trim().toLowerCase();
  const list = useMemo(() => rows
    .filter((r) => (tag === "all" || r.category === tag)
      && (!problems || (healthBy.get(r.instanceId) && !healthBy.get(r.instanceId)!.overallOk))
      && (!needle || `${r.name} ${r.instanceId} ${r.privateIp} ${r.publicIp} ${r.vpcId}`.toLowerCase().includes(needle)))
    .sort((a, b) => b.total - a.total), [rows, tag, problems, needle, healthBy]);

  const loadOther = () => {
    if (otherRows) return;
    const other = view === "month" ? "14d" : "month";
    fetch(`/api/cost/allocation?mode=${other}${month ? `&month=${month}` : ""}`).then((r) => (r.ok ? r.json() : null)).then((j: AllocResp | null) => {
      if (j) setOtherRows(Object.fromEntries(j.rows.map((r) => [r.instanceId, r.total])));
    }).catch(() => { /* the row just shows a dash for the other period */ });
  };

  async function saveTag(row: AllocRow, category: string) {
    setSaving(row.instanceId);
    setSaveError(null);
    try {
      const r = await fetch("/api/tags/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchKey: row.instanceId, category,
          label: row.name !== "(unknown / terminated)" ? row.name : undefined,
          region: row.region !== "-" ? row.region : undefined,
          instanceType: row.type !== "-" ? row.type : undefined,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Save failed");
      toast(`Tagged ${row.name} as ${category}`);
      alloc.reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  const header = (
    <PageHeader title="EC2 servers" description="Cost and health per instance — inline tags, AWS status checks and per-server metrics in one table. Resource-level cost covers the last 14 days." actions={<MonthPicker />} />
  );
  if (alloc.error) return <Screen label="EC2 servers">{header}<ErrorNote message={alloc.error} onRetry={alloc.reload} /></Screen>;
  if (!alloc.data) return <ScreenSkeleton />;

  const data = alloc.data;
  const mLabel = data.month ?? data.monthRange.Start.slice(0, 7);
  const mtd = view === "month";
  const sum = (c: string) => list.filter((r) => r.category === c).reduce((a, r) => a + r.total, 0);
  const shownTotal = list.reduce((a, r) => a + r.total, 0);
  const tags = ["all", ...Array.from(new Set(rows.map((r) => r.category))).sort((a, b) => {
    const i = (x: string) => { const n = TAG_OPTIONS.indexOf(x); return n < 0 ? 99 : n; };
    return i(a) - i(b);
  })];
  const comps = [["Compute (instance-hours)", data.totals.compute], ["EBS storage", data.totals.ebs], ["Elastic IP / Public IPv4", data.totals.eip], ["Data transfer", data.totals.dataTransfer]] as const;
  const compMax = Math.max(0.0001, ...comps.map((c) => c[1]));
  const healthAt = health.data?.fetchedAt ?? null;

  return (
    <Screen label="EC2 servers">
      {header}
      {data.stale && <Banner tone="var(--warning)">AWS session expired — showing the last saved snapshot{data.asOf ? ` from ${new Date(data.asOf).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST` : ""}. Live IP, VPC and state are hidden until you re-login.</Banner>}
      {saveError && <ErrorNote message={saveError} />}
      <KpiGrid>
        {(["2.0", "3.0", "Infra"] as const).map((c) => (
          <Kpi key={c} label={<span className="flex items-center gap-2"><Dot color={colorOf(c)} size={8} />{c}</span>} value={usd(sum(c))} footer="Tagged spend" />
        ))}
        <Kpi label={mtd ? "Total · month-to-date" : "Total · last 14 days"} value={usd(shownTotal)} footer={`${list.length} instances`} />
      </KpiGrid>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Cost + health per server</h3>
              <Badge tone={isStale(healthAt) ? "var(--warning)" : "var(--success)"} className="gap-[5px]"><Clock size={12} className="block" />{ago(healthAt)}</Badge>
            </div>
            <div className="mt-[3px] text-[13px] text-muted-foreground">{mtd ? `Showing current-month spend (${mLabel}) — actual month-to-date per instance.` : "Showing the last 14 days — resource-level cost data per instance."}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={view} onChange={(v) => { setView(v); setOtherRows(null); }} aria-label="Period" options={[{ value: "month", label: "Current month" }, { value: "14d", label: "Last 14 days" }]} />
            <Button size="sm" className="h-8 px-2.5 text-[12.5px]" onClick={() => {
              downloadCsv(`ec2-${mtd ? "month" : "14d"}.csv`, toCsv(list, [
                { key: "instanceId", label: "Instance ID" }, { key: "name", label: "Name" }, { key: "category", label: "Category" }, { key: "region", label: "Region" },
                { key: "vpcId", label: "VPC" }, { key: "type", label: "Type" }, { key: "state", label: "State" }, { key: "publicIp", label: "Public IP" }, { key: "privateIp", label: "Private IP" },
                { key: "compute", label: "Compute ($)" }, { key: "dataTransfer", label: "Data Transfer ($)" }, { key: "ebs", label: "EBS ($)" }, { key: "eip", label: "EIP ($)" }, { key: "total", label: "Total ($)" },
              ]));
              toast(`Exported ${list.length} servers to CSV`);
            }}><Download size={14} className="block" />Export CSV</Button>
            <Button variant="primary" size="sm" className="h-8 text-[12.5px]" disabled={refreshing} onClick={() => void refresh(["ec2-health"])}>
              <RefreshCw size={14} className={cn("block", refreshing && "animate-nt-spin")} />Refresh health
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-5 pb-3.5">
          <SearchInput wrapperClassName="min-w-[200px] flex-[0_1_280px]" placeholder="Name, instance id, VPC…" value={q} onChange={(e) => setQ(e.target.value)} />
          {tags.map((t) => {
            const c = t === "all" ? null : colorOf(t), on = tag === t, mix = c ?? "var(--fg)";
            return (
              <button key={t} type="button" aria-pressed={on} onClick={() => setTag(t)}
                className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-solid px-2.5 text-[12.5px] font-medium text-fg-2 hover:border-border-strong"
                style={{ borderColor: on ? `color-mix(in oklab, ${mix} 45%, transparent)` : "var(--border)", background: on ? tint(mix, 12) : "transparent" }}>
                <Dot color={c ?? "var(--fg-2)"} size={7} />{t === "all" ? "All" : t}
                <span className="text-muted-foreground tnum">{t === "all" ? rows.length : rows.filter((r) => r.category === t).length}</span>
              </button>
            );
          })}
          <CheckButton on={problems} onClick={() => setProblems((v) => !v)}>Problems only</CheckButton>
          <span className="ml-auto text-[12.5px] text-muted-foreground tnum">Showing {list.length} of {rows.length}</span>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[1060px]">
            <div className="grid h-[38px] items-center gap-3.5 border-0 border-y border-solid border-border bg-card-2 px-5 text-[12px] font-medium text-muted-foreground" style={{ gridTemplateColumns: COLS }}>
              <span /><span>Server</span><span>Tag</span><span>Region</span><span>VPC</span><span>Type</span><span>State</span><span>Status checks</span><span className="text-right">{mtd ? "MTD" : "14 days"}</span>
            </div>
            {list.map((r) => {
              const isOpen = !!open[r.instanceId];
              const h = healthBy.get(r.instanceId);
              const run = r.state === "running";
              const issue = issues?.ec2?.[r.instanceId];
              const alerts = (issue?.incidents ?? 0) + (issue?.recommendations ?? 0);
              const failed = !!h && !h.overallOk;
              const chkColor = !run ? "var(--muted-fg)" : failed ? "var(--danger)" : h ? "var(--success)" : "var(--muted-fg)";
              const passed = h ? [h.systemCheck, h.instanceCheck].filter((c) => c === "ok").length : 0;
              const tc = colorOf(r.category);
              const stColor = run ? "var(--success)" : "var(--muted-fg)";
              const other = otherRows?.[r.instanceId];
              const toggle = () => { if (!isOpen) loadOther(); setOpen((o) => ({ ...o, [r.instanceId]: !isOpen })); };
              return (
                <Fragment key={r.instanceId}>
                  <div role="button" tabIndex={0} onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter") toggle(); }}
                    className={cn("grid min-h-[54px] cursor-pointer items-center gap-3.5 border-0 border-b border-solid border-border px-5 py-1.5 text-[13px] hover:bg-hover", isOpen && "bg-hover")} style={{ gridTemplateColumns: COLS }}>
                    <span className={cn("text-muted-foreground transition-transform duration-150", isOpen && "rotate-90")}><ChevronRight size={14} className="block" /></span>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-medium">{r.name}</span>
                        {alerts > 0 && <span className="inline-flex h-[18px] shrink-0 items-center gap-[3px] rounded-[5px] px-[5px] text-[11px] font-semibold text-warning" style={{ background: tint("var(--warning)") }}><AlertTriangle size={12} className="block" />{alerts}</span>}
                      </div>
                      <div className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">{r.instanceId}</div>
                    </div>
                    <span><span className="inline-flex h-[22px] items-center gap-[5px] rounded-[6px] px-[7px] text-[12px] font-medium text-fg-2" style={{ background: tint(tc, 12) }}><Dot color={tc} />{r.category}</span></span>
                    {[r.region, r.vpcId, r.type].map((v, i) => <span key={i} className="truncate font-mono text-[12px] text-fg-2">{v}</span>)}
                    <span>
                      <span className="inline-flex h-[22px] items-center gap-[5px] rounded-[6px] px-[7px] text-[12px] font-medium" style={{ color: stColor, background: run ? tint("var(--success)") : "var(--card-2)" }}><Dot color={stColor} />{r.state}</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: chkColor }}>
                      {!run || !h ? <Minus size={12} className="block" /> : failed ? <X size={12} className="block" /> : <Check size={12} className="block" />}
                      {!run ? "Not running" : !h ? "No data" : `${passed}/2 passed`}
                    </span>
                    <span className="text-right font-semibold tnum">{usd(r.total)}</span>
                  </div>
                  {isOpen && (
                    <div className="flex flex-col gap-3 border-0 border-b border-solid border-border bg-hover pb-[18px] pl-[50px] pr-5 pt-1.5">
                      {alerts > 0 && (
                        <Banner tone="var(--warning)">
                          <span className="text-warning"><AlertTriangle size={14} className="block" /></span>
                          <span>{alerts} open alert{alerts === 1 ? "" : "s"} on this server</span>
                          <Button asChild size="xs" className="ml-auto rounded-[7px]"><Link href="/incidents" className="no-underline">Open Alerts &amp; Actions<ArrowRight size={12} className="block" /></Link></Button>
                        </Banner>
                      )}
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
                        <div className={KV}>
                          <span className="text-muted-foreground">Instance</span><span className="truncate text-right font-mono">{r.instanceId}</span>
                          <span className="text-muted-foreground">Type</span><span className="text-right font-mono">{r.type}</span>
                          <span className="text-muted-foreground">VPC</span><span className="truncate text-right font-mono">{r.vpcId}</span>
                        </div>
                        <div className={KV}>
                          <span className="text-muted-foreground">System check</span><span className="text-right" style={{ color: h?.systemCheck === "ok" ? "var(--success)" : chkColor }}>{run ? (h?.systemCheck ?? "—") : "—"}</span>
                          <span className="text-muted-foreground">Instance check</span><span className="text-right" style={{ color: h?.instanceCheck === "ok" ? "var(--success)" : chkColor }}>{run ? (h?.instanceCheck ?? "—") : "—"}</span>
                          <span className="text-muted-foreground">State</span><span className="text-right">{r.state}</span>
                        </div>
                        <div className={KV}>
                          <span className="text-muted-foreground">Month-to-date</span><span className="text-right tnum">{mtd ? usd(r.total) : other != null ? usd(other) : "—"}</span>
                          <span className="text-muted-foreground">Last 14 days</span><span className="text-right tnum">{!mtd ? usd(r.total) : other != null ? usd(other) : "—"}</span>
                          <span className="text-muted-foreground">Tag</span>
                          <span className="text-right">
                            <select aria-label={`Tag for ${r.name}`} value={TAG_OPTIONS.includes(r.category) ? r.category : "Other"} disabled={saving === r.instanceId} onChange={(e) => void saveTag(r, e.target.value)}
                              className="cursor-pointer border-none bg-transparent p-0 text-right text-[12.5px] text-foreground outline-none">
                              {TAG_OPTIONS.map((c) => <option key={c} value={c} className="bg-popover">{c}</option>)}
                            </select>
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" className="px-2.5 text-[12.5px]" aria-expanded={!!metrics[r.instanceId]} onClick={() => setMetrics((m) => ({ ...m, [r.instanceId]: !m[r.instanceId] }))}><Activity size={12} className="block" />{metrics[r.instanceId] ? "Hide metrics" : "View metrics"}</Button>
                        <Button asChild size="sm" className="px-2.5 text-[12.5px]">
                          <a className="no-underline" target="_blank" rel="noreferrer" href={`https://${r.region}.console.aws.amazon.com/ec2/home?region=${r.region}#InstanceDetails:instanceId=${r.instanceId}`}><ExternalLink size={12} className="block" />Open in AWS console</a>
                        </Button>
                      </div>
                      {metrics[r.instanceId] && (
                        <Ec2InstanceDetail instanceId={r.instanceId} name={r.name} region={r.region} publicIp={r.publicIp || null} privateIp={r.privateIp || null}
                          onClose={() => setMetrics((m) => ({ ...m, [r.instanceId]: false }))} />
                      )}
                    </div>
                  )}
                </Fragment>
              );
            })}
            {list.length === 0 && <EmptyState title="No servers match">Try clearing the tag filter or search.</EmptyState>}
          </div>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="px-5 pb-2.5 pt-[18px]">
          <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Overall server cost · {mtd ? `${mLabel} MTD` : "last 14 days"}</h3>
          <div className="mt-[3px] text-[13px] text-muted-foreground">Instance-linked spend by component</div>
        </div>
        <div className="flex flex-col px-5">
          {comps.map(([name, v]) => (
            <div key={name} className="grid min-h-11 items-center gap-4 border-0 border-b border-solid border-border text-[13px]" style={{ gridTemplateColumns: COMP_COLS }}>
              <span>{name}</span>
              <ShareBar pct={(v / compMax) * 100} />
              <span className="text-right text-[12.5px] text-muted-foreground tnum">{data.totals.total > 0 ? ((v / data.totals.total) * 100).toFixed(1) : "0.0"}%</span>
              <span className="text-right font-medium tnum">{usd(v)}</span>
            </div>
          ))}
          <div className="grid min-h-12 items-center gap-4 text-[14px] font-semibold" style={{ gridTemplateColumns: COMP_COLS }}>
            <span>All servers total</span><span /><span /><span className="text-right tnum">{usd(data.totals.total)}</span>
          </div>
        </div>
        <div className="border-0 border-t border-solid border-border px-5 pb-4 pt-3 text-[12.5px] leading-[1.5] text-muted-foreground">
          Full EC2 cost for {data.monthRange.Start.slice(0, 7)} (Compute + EC2-Other from Cost Explorer): <span className="font-semibold text-foreground">{usd(data.monthEc2Total)}</span>. Unattributed EC2-Other (no instance link): {usd(data.totals.unattributedEc2Other)}.
        </div>
      </Card>
    </Screen>
  );
}

export default function Servers() {
  return <Suspense fallback={<ScreenSkeleton />}><Inner /></Suspense>;
}
