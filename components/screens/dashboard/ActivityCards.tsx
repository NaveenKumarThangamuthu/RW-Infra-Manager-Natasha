"use client";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, ScanSearch } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { ago, dayLabel, shortService, usd } from "@/components/natasha/format";
import { Delta, ErrorNote, IconWell, ShareBar } from "@/components/natasha/primitives";
import { useOnRefreshed } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { cn } from "@/lib/utils";
import type { DeltaItem } from "./types";

interface Anomaly { service: string; resourceId: string; latestDate: string; latestAmount: number; baselineMedian: number; spikeUsd: number; zScore: number; baselineDays: number }
interface AnomalyResp { threshold: { zScore: number; baselineDays: number }; anomalies: Anomaly[]; totalChecked: number }
interface ScansResp { jobs?: Array<{ repoFullName: string; status: string; startedAt: string; findingsCount: number }> }

/** Bars use at most this share of the plot height, which leaves room for the amount above the tallest one. */
const BAR_MAX_PCT = 86;

export function DailySpend({ trend, partialDays }: { trend: Array<{ date: string; amount: number }>; partialDays: number }) {
  const days = trend.slice(-14);
  const max = Math.max(...days.map((d) => d.amount), 0.0001);
  const dense = days.length > 7;
  return (
    <Card className="flex flex-col">
      <CardHeader title="Daily spend"
        description={`Last ${days.length} days${partialDays > 0 ? ` · the last ${partialDays} are still being reported by AWS` : ""}`} />
      <div className="flex min-h-[250px] flex-1 items-stretch justify-around px-5 pb-[18px] pt-4" style={{ gap: dense ? 6 : 16 }}>
        {days.map((d, i) => {
          const pct = Math.max(1.5, (Math.max(0, d.amount) / max) * BAR_MAX_PCT);
          const fromEnd = days.length - 1 - i;
          // On a phone 14 labels do not fit side by side, so every second one is hidden.
          const thin = dense && fromEnd % 2 === 1 ? "max-[520px]:invisible" : "";
          return (
            <div key={d.date} className="flex min-w-0 max-w-24 flex-1 flex-col items-center gap-2">
              <div className="relative min-h-[150px] w-full flex-1">
                <span className={cn("absolute inset-x-0 whitespace-nowrap text-center text-[12.5px] font-medium tnum", thin)}
                  style={{ bottom: `calc(${pct}% + 6px)`, fontSize: dense ? 10.5 : undefined }}>{usd(d.amount, dense ? 0 : 2)}</span>
                <div className="absolute inset-x-0 bottom-0 rounded-t-[6px] rounded-b-[3px]" style={{
                  height: `${pct}%`,
                  background: fromEnd < partialDays ? "color-mix(in oklab, var(--c20) 35%, transparent)" : "var(--c20)",
                }} />
              </div>
              <span className={cn("whitespace-nowrap text-[12px] text-muted-foreground", thin)} style={dense ? { fontSize: 10.5 } : undefined}>{dayLabel(d.date)}</span>
            </div>
          );
        })}
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
        description={data ? `Servers costing well above their usual day over the last ${data.threshold.baselineDays} days${latest ? ` · latest full day ${dayLabel(latest)}` : ""}` : "Loading…"}
        actions={data && <span className="whitespace-nowrap text-[12.5px] text-muted-foreground">{data.totalChecked} resources checked</span>} />
      {error && <div className="px-5 pb-4"><ErrorNote message={error} onRetry={reload} /></div>}
      {data && list.length === 0 && <div className="border-0 border-t border-solid border-border px-5 py-6 text-[13px] text-muted-foreground">Nothing unusual. Every resource is close to its usual daily cost.</div>}
      {list.map((a) => {
        const isInstance = a.resourceId.startsWith("i-");
        const multiple = a.baselineMedian > 0 ? `${(a.latestAmount / a.baselineMedian).toFixed(1)}× usual` : "";
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
              <div className="mt-1 text-[12.5px] text-muted-foreground tnum">{dayLabel(a.latestDate)} · usually {usd(a.baselineMedian)} a day, now {usd(a.latestAmount)}</div>
            </div>
            <div className="text-right">
              <div className="text-[14px] font-semibold text-danger tnum">+{usd(a.spikeUsd)}</div>
              {multiple && <div className="mt-0.5 whitespace-nowrap text-[11.5px] text-muted-foreground tnum">{multiple}</div>}
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
      text: <>Cost anomaly · {a.service} <span className="font-mono text-[12.5px]">{a.resourceId.slice(0, 24)}</span> — {usd(a.latestAmount)} on {dayLabel(a.latestDate)}</>,
    })),
    ...(scans?.jobs ?? []).filter((j) => j.status === "success").slice(0, 3).map((j) => ({
      key: `s:${j.repoFullName}:${j.startedAt}`, at: new Date(j.startedAt), color: j.findingsCount > 0 ? "var(--warning)" : "var(--success)",
      icon: <ScanSearch size={12} className="block" />,
      text: <>Security scan · {j.repoFullName} — {j.findingsCount} finding{j.findingsCount === 1 ? "" : "s"}</>,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Recent activity" className="pb-3.5" description={`Latest anomalies and scans · ${events.length} event${events.length === 1 ? "" : "s"}`} />
      {events.length === 0 && <div className="border-0 border-t border-solid border-border px-5 py-6 text-[13px] text-muted-foreground">Nothing recent yet. This fills in after the next scheduled refresh.</div>}
      {events.map((e) => (
        <div key={e.key} className="flex items-center gap-3 border-0 border-t border-solid border-border px-5 py-3">
          <IconWell color={e.color} size={28}>{e.icon}</IconWell>
          <span className="min-w-0 flex-1 break-words text-[13px] leading-[1.45]">{e.text}</span>
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
            <span>{nameLabel}</span><span>Share</span><span className="text-right">Change</span><span className="text-right">Cost</span>
          </div>
          {rows.map((x) => (
            <div key={x.key} className="grid min-h-11 items-center gap-3 border-0 border-b border-solid border-border px-5 text-[13px] hover:bg-hover" style={{ gridTemplateColumns: cols }}>
              <span className={cn("truncate", mono && "font-mono text-[12.5px]")} title={x.key}>{mono ? x.key : shortService(x.key)}</span>
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
