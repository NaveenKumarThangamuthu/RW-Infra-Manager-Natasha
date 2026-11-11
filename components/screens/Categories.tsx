"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Download, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { downloadCsv, toCsv } from "@/components/csv";
import { BarChart } from "@/components/natasha/charts";
import { CATEGORY_META, MONTHS_SHORT, usd } from "@/components/natasha/format";
import { Delta, EmptyState, ErrorNote, Kpi, KpiGrid, PageHeader, Screen, Skeleton } from "@/components/natasha/primitives";
import { useOnRefreshed, useShell } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { cn } from "@/lib/utils";

interface RosterRow { matchKey: string; label: string; region: string; instanceType: string; services: string; cost14d: number; compute: number; dataTransfer: number; ebs: number; eip: number }
interface Resp {
  category: string; currentMonth: string; prevMonth: string;
  summary: {
    serverCount: number; total14d: number;
    monthly: { current: number; previous: number; deltaPct: number | null };
    budget: { projection: number; budget: number | null; pctConsumed: number | null; status: "ok" | "warn" | "over" | "unset"; deltaPctVsBudget: number | null };
    monthProgress: { dayOfMonth: number; daysInMonth: number };
  };
  roster: RosterRow[];
  trend: Array<{ date: string; amount: number }>;
  snapshotAt: string | null;
}

const COLS = "minmax(250px,1.8fr) 84px 84px minmax(110px,1fr) 72px 60px 60px 60px 84px";
const dLabel = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`; };

function Tabs({ active }: { active: string }) {
  return (
    <div className="flex max-w-full flex-wrap gap-0.5 self-start rounded-[10px] bg-card-2 p-[3px]">
      {CATEGORY_META.map((c) => {
        const on = c.key === active;
        return (
          <Link key={c.key} href={`/tag/${encodeURIComponent(c.key)}`}
            className={cn("inline-flex h-[30px] items-center gap-[7px] rounded-[7px] px-3 text-[13px] font-medium no-underline", on ? "bg-tab text-foreground shadow-[0_1px_2px_rgba(0,0,0,.14)]" : "text-muted-foreground")}>
            <span className="h-2 w-2 rounded-[8px]" style={{ background: c.color }} />{c.key}
          </Link>
        );
      })}
    </div>
  );
}

export default function Categories() {
  const params = useParams<{ category: string }>();
  const category = decodeURIComponent(params.category);
  const { toast } = useShell();
  const { data, error, reload } = useJson<Resp>(`/api/cost/by-tag/${encodeURIComponent(category)}`);
  useOnRefreshed(reload);
  useEffect(() => { document.title = `${category} — Natasha Infra Manager`; }, [category]);

  const color = CATEGORY_META.find((c) => c.key === category)?.color ?? "var(--brand)";
  const roster = data?.roster ?? [];
  const max = Math.max(1, ...roster.map((r) => r.cost14d));
  const trend = data?.trend ?? [];
  const regions = Array.from(new Set(roster.map((r) => r.region).filter(Boolean)));
  const budget = data?.summary.budget;

  return (
    <Screen label="Categories">
      <PageHeader title="Categories"
        description={<span className="tnum">{data ? `${data.category} · ${data.summary.serverCount} server${data.summary.serverCount === 1 ? "" : "s"} · 14-day spend ${usd(data.summary.total14d)} · current month ${usd(data.summary.monthly.current)}` : category}</span>}
        actions={<>
          <Button asChild size="lg"><Link href="/ec2" className="no-underline"><Server size={14} className="block" />Open in EC2</Link></Button>
          <Button variant="primary" size="lg" disabled={!roster.length} onClick={() => {
            downloadCsv(`tag-${category}-roster.csv`, toCsv(roster, [
              { key: "matchKey", label: "Instance ID" }, { key: "label", label: "Label" }, { key: "region", label: "Region" }, { key: "instanceType", label: "Type" },
              { key: "services", label: "Services" }, { key: "compute", label: "Compute (14d $)" }, { key: "dataTransfer", label: "Data Transfer (14d $)" },
              { key: "ebs", label: "EBS (14d $)" }, { key: "eip", label: "EIP (14d $)" }, { key: "cost14d", label: "Total 14d $" },
            ]));
            toast(`Exported ${roster.length} instances to CSV`);
          }}><Download size={14} className="block" />Export CSV</Button>
        </>} />
      <Tabs active={category} />
      {error && <ErrorNote message={error} onRetry={reload} />}
      {!data && !error && <KpiGrid>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[120px] rounded-[12px]" />)}</KpiGrid>}
      {data && (
        <>
          <KpiGrid>
            <Kpi label="Current month" value={usd(data.summary.monthly.current)} badge={<Delta pct={data.summary.monthly.deltaPct} />} footer={`vs ${data.prevMonth} · ${usd(data.summary.monthly.previous)}`} />
            <Kpi label="14-day spend" value={usd(data.summary.total14d)} footer={`Across ${roster.length} instance${roster.length === 1 ? "" : "s"}`} />
            <Kpi label="Servers in this category" value={data.summary.serverCount} footer={<span className="font-mono">{regions.join(" · ") || "—"}</span>} />
            <Kpi label="Average cost per server" value={usd(data.summary.total14d / Math.max(1, roster.length))} footer="Last 14 days" />
          </KpiGrid>
          {budget?.budget != null && (
            <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
              <div>
                <div className="text-[13px] font-medium text-muted-foreground">Monthly budget</div>
                <div className="mt-0.5 text-[20px] font-semibold tracking-[-0.02em] tnum">{usd(budget.budget)}<span className="text-[13px] font-medium tracking-normal text-muted-foreground"> / mo</span></div>
              </div>
              <div className="relative h-1.5 min-w-[200px] flex-1 rounded-[6px] bg-card-2">
                <div className="h-full rounded-[6px]" style={{ width: `${Math.min(100, budget.pctConsumed ?? 0)}%`, background: budget.status === "over" ? "var(--danger)" : budget.status === "warn" ? "var(--warning)" : "var(--success)" }} />
                <div className="absolute -top-1 h-3.5 w-px bg-border-strong" title={`Day ${data.summary.monthProgress.dayOfMonth} of ${data.summary.monthProgress.daysInMonth}`} style={{ left: `${(data.summary.monthProgress.dayOfMonth / data.summary.monthProgress.daysInMonth) * 100}%` }} />
              </div>
              <div className="flex gap-6 text-[12.5px] text-muted-foreground">
                <span>Consumed <span className="font-medium text-foreground tnum">{(budget.pctConsumed ?? 0).toFixed(1)}%</span></span>
                <span>Projected <span className="font-medium text-foreground tnum">{usd(budget.projection)}</span></span>
              </div>
            </Card>
          )}
          {roster.length === 0 && trend.length === 0 ? (
            <Card className="border-dashed border-border-strong"><EmptyState title={`No snapshot for ${category}`}>No instances are tagged {category} yet. Assign tags from the EC2 screen.</EmptyState></Card>
          ) : (
            <>
              <Card>
                <CardHeader title={`Daily spend · last ${trend.length} days`}
                  description={`${trend.length ? `${dLabel(trend[0].date)} – ${dLabel(trend[trend.length - 1].date)} · ` : ""}hover a day for the amount`}
                  actions={<Badge size="md" className="text-fg-2"><span className="h-[7px] w-[7px] rounded-[7px]" style={{ background: color }} />{category} only</Badge>} />
                <div className="p-5">
                  <BarChart labels={trend.map((t) => dLabel(t.date))} full={trend.map((t) => new Date(`${t.date}T00:00:00Z`).toUTCString().slice(0, 16))} values={trend.map((t) => t.amount)} color={color} height={220} />
                </div>
              </Card>
              <Card className="overflow-hidden">
                <CardHeader title="Instances" description="Sorted by 14-day cost · compute, data transfer, EBS and Elastic IP" className="pb-3.5" />
                <div className="overflow-x-auto">
                  <div className="min-w-[1000px]">
                    <div className="grid h-[38px] items-center gap-3.5 border-0 border-y border-solid border-border bg-card-2 px-5 text-[12px] font-medium text-muted-foreground" style={{ gridTemplateColumns: COLS }}>
                      <span>Instance</span><span>Type</span><span>Region</span><span>14-day share</span>
                      <span className="text-right">Compute</span><span className="text-right">DT</span><span className="text-right">EBS</span><span className="text-right">EIP</span><span className="text-right">Total 14d</span>
                    </div>
                    {roster.map((r) => (
                      <div key={r.matchKey} className={cn("grid min-h-[52px] items-center gap-3.5 border-0 border-b border-solid border-border px-5 py-1.5 text-[13px] hover:bg-hover", r.cost14d === 0 && "opacity-55")} style={{ gridTemplateColumns: COLS }}>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{r.label || "—"}</div>
                          <div className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">{r.matchKey}</div>
                        </div>
                        <span className="font-mono text-[12px] text-fg-2">{r.instanceType || "—"}</span>
                        <span className="font-mono text-[12px] text-fg-2">{r.region || "—"}</span>
                        <span className="block h-1.5 overflow-hidden rounded-[6px] bg-card-2"><span className="block h-full rounded-[6px]" style={{ width: `${(r.cost14d / max) * 100}%`, background: color }} /></span>
                        {[r.compute, r.dataTransfer, r.ebs, r.eip].map((v, i) => <span key={i} className="text-right text-fg-2 tnum">{usd(v)}</span>)}
                        <span className="text-right font-semibold tnum">{usd(r.cost14d)}</span>
                      </div>
                    ))}
                    <div className="grid h-[46px] items-center gap-3.5 px-5 text-[13px] font-semibold" style={{ gridTemplateColumns: COLS }}>
                      <span>{roster.length} instances</span><span /><span /><span /><span /><span /><span /><span />
                      <span className="text-right tnum">{usd(data.summary.total14d)}</span>
                    </div>
                  </div>
                </div>
                {data.snapshotAt && (
                  <div className="border-0 border-t border-solid border-border px-5 pb-4 pt-3 text-[12.5px] text-muted-foreground">
                    Per-instance costs from the snapshot taken {new Date(data.snapshotAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })} IST.
                  </div>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
