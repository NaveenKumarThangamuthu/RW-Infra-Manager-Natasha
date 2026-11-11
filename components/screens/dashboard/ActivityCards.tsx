"use client";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, RefreshCw, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ago, MONTHS_SHORT, usd } from "@/components/natasha/format";
import { Delta, ErrorNote, IconWell, ShareBar } from "@/components/natasha/primitives";
import { useShell, useOnRefreshed } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { cn } from "@/lib/utils";
import type { DeltaItem } from "./types";

interface Anomaly { service: string; resourceId: string; latestDate: string; latestAmount: number; baselineMedian: number; spikeUsd: number; zScore: number; baselineDays: number }
interface AnomalyResp { threshold: { zScore: number; baselineDays: number }; anomalies: Anomaly[]; totalChecked: number }
interface ScansResp { jobs?: Array<{ repoFullName: string; status: string; startedAt: string; findingsCount: number }> }

const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

export function DailySpend({ trend, partial }: { trend: Array<{ date: string; amount: number }>; partial: boolean }) {
  const { refresh, refreshing } = useShell();
  const days = trend.slice(-14);
  const max = Math.max(...days.map((d) => d.amount), 0.0001);
  const last = days[days.length - 1];
  return (
    <Card className="flex flex-col">
      <CardHeader title="Daily spend"
        description={`Last ${days.length} days${partial && last ? ` · ${dayLabel(last.date)} is a partial day` : ""}`}
        actions={<Button size="sm" className="px-2.5 text-[12.5px]" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={14} className={cn("block", refreshing && "animate-nt-spin")} />Refresh</Button>} />
      <div className="flex min-h-[250px] flex-1 items-end justify-around gap-4 px-5 pb-[18px] pt-6" style={{ gap: days.length > 7 ? 6 : 16 }}>
        {days.map((d, i) => (
          <div key={d.date} className="flex min-w-0 max-w-24 flex-1 flex-col items-center gap-2">
            <span className="whitespace-nowrap text-[12.5px] font-medium tnum" style={days.length > 7 ? { fontSize: 10.5 } : undefined}>{usd(d.amount, days.length > 7 ? 0 : 2)}</span>
            <div className="w-full rounded-t-[6px] rounded-b-[3px]" style={{
              height: Math.max(4, Math.round((d.amount / max) * 160)),
              background: partial && i === days.length - 1 ? "color-mix(in oklab, var(--c20) 35%, transparent)" : "var(--c20)",
            }} />
            <span className="whitespace-nowrap text-[12px] text-muted-foreground" style={days.length > 7 ? { fontSize: 10.5 } : undefined}>{dayLabel(d.date)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function CostAnomalies() {
  const { data, error, reload } = useJson<AnomalyResp>("/api/cost/anomalies");
  useOnRefreshed(reload);
  const list = data?.anomalies ?? [];
  const latest = list.map((a) => a.latestDate).sort().pop();
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Cost anomalies" className="pb-3.5"
        description={data ? `${data.threshold.baselineDays}-day baseline · z ≥ ${data.threshold.zScore}σ${latest ? ` · latest data ${latest}` : ""}` : "Loading…"}
        actions={data && <span className="text-[12.5px] text-muted-foreground">{data.totalChecked} resources scanned</span>} />
      {error && <div className="px-5 pb-4"><ErrorNote message={error} onRetry={reload} /></div>}
      {data && list.length === 0 && <div className="border-0 border-t border-solid border-border px-5 py-6 text-[13px] text-muted-foreground">No anomalies detected — spend is within baseline.</div>}
      {list.map((a) => {
        const isInstance = a.resourceId.startsWith("i-");
        const multiple = a.baselineMedian > 0 ? ` (${(a.latestAmount / a.baselineMedian).toFixed(2)}×)` : "";
        return (
          <div key={`${a.service}:${a.resourceId}`} className="flex items-center gap-3.5 border-0 border-t border-solid border-border px-5 py-3.5">
            <IconWell color={a.spikeUsd >= 10 ? "var(--warning)" : "var(--info)"}><AlertTriangle size={14} className="block" /></IconWell>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-[5px] border border-solid border-border px-1.5 py-px text-[11.5px] font-medium text-muted-foreground">{a.service}</span>
                {isInstance ? (
                  <Link href={`/perf/ec2/${encodeURIComponent(a.resourceId)}`} className="inline-flex items-center gap-2 font-mono text-[13px] font-medium">
                    {a.resourceId}<span className="text-muted-foreground"><ArrowUpRight size={12} className="block" /></span>
                  </Link>
                ) : <span className="font-mono text-[13px] font-medium">{a.resourceId}</span>}
              </div>
              <div className="mt-1 text-[12.5px] text-muted-foreground tnum">{a.latestDate} · baseline {usd(a.baselineMedian)} → {usd(a.latestAmount)}{multiple}</div>
            </div>
            <div className="text-right">
              <div className="text-[14px] font-semibold text-danger tnum">+{usd(a.spikeUsd)}</div>
              <div className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">z = {a.zScore.toFixed(1)}</div>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

export function RecentActivity() {
  const { data: anomalies } = useJson<AnomalyResp>("/api/cost/anomalies");
  const { data: scans } = useJson<ScansResp>("/api/security/scans");
  const events = [
    ...(anomalies?.anomalies ?? []).slice(0, 3).map((a) => ({
      key: `a:${a.resourceId}:${a.latestDate}`, at: new Date(a.latestDate), color: a.spikeUsd >= 10 ? "var(--warning)" : "var(--info)",
      icon: <AlertTriangle size={12} className="block" />,
      text: <>Cost anomaly · {a.service} <span className="font-mono text-[12.5px]">{a.resourceId.slice(0, 24)}</span> — {usd(a.latestAmount)} on {a.latestDate}</>,
    })),
    ...(scans?.jobs ?? []).filter((j) => j.status === "success").slice(0, 3).map((j) => ({
      key: `s:${j.repoFullName}:${j.startedAt}`, at: new Date(j.startedAt), color: j.findingsCount > 0 ? "var(--warning)" : "var(--success)",
      icon: <ScanSearch size={12} className="block" />,
      text: <>Trivy scan · {j.repoFullName} — {j.findingsCount} finding{j.findingsCount === 1 ? "" : "s"}</>,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Recent activity" className="pb-3.5" description={`Latest anomalies and scans · ${events.length} event${events.length === 1 ? "" : "s"}`} />
      {events.length === 0 && <div className="border-0 border-t border-solid border-border px-5 py-6 text-[13px] text-muted-foreground">Nothing recent yet — cron refreshes at the next window.</div>}
      {events.map((e) => (
        <div key={e.key} className="flex items-center gap-3 border-0 border-t border-solid border-border px-5 py-3">
          <IconWell color={e.color} size={28}>{e.icon}</IconWell>
          <span className="min-w-0 flex-1 text-[13px] leading-[1.45]">{e.text}</span>
          <span className="whitespace-nowrap text-[12px] text-muted-foreground">{ago(e.at)}</span>
        </div>
      ))}
    </Card>
  );
}

export function TopTable({ title, description, nameLabel, rows, mono }: { title: string; description: string; nameLabel: string; rows: DeltaItem[]; mono?: boolean }) {
  const max = Math.max(...rows.map((r) => r.amount), 0.0001);
  const cols = `${mono ? "minmax(0,1.2fr)" : "minmax(0,1.7fr)"} minmax(60px,1fr) 78px 76px`;
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} description={description} className="pb-3" />
      <div className="-mb-px overflow-x-auto">
        <div className="min-w-[440px]">
          <div className="grid h-9 items-center gap-3 border-0 border-y border-solid border-border px-5 text-[12px] font-medium text-muted-foreground" style={{ gridTemplateColumns: cols }}>
            <span>{nameLabel}</span><span>Share</span><span className="text-right">Δ</span><span className="text-right">Cost</span>
          </div>
          {rows.map((x) => (
            <div key={x.key} className="grid min-h-11 items-center gap-3 border-0 border-b border-solid border-border px-5 text-[13px] hover:bg-hover" style={{ gridTemplateColumns: cols }}>
              <span className={cn("truncate", mono && "font-mono text-[12.5px]")}>{x.key}</span>
              <ShareBar pct={Math.max(0.8, (x.amount / max) * 100)} />
              <span className="justify-self-end"><Delta pct={x.deltaPct} size="xs" /></span>
              <span className="text-right font-medium tnum">{usd(x.amount)}</span>
            </div>
          ))}
          {rows.length === 0 && <div className="px-5 py-6 text-[13px] text-muted-foreground">No cost recorded yet.</div>}
        </div>
      </div>
    </Card>
  );
}
