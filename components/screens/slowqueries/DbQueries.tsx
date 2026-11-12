"use client";
import { useState } from "react";
import Link from "next/link";
import { AlertOctagon, AlertTriangle, Database, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { num } from "@/components/natasha/format";
import { EmptyState, ErrorNote, HeadRow, Skeleton } from "@/components/natasha/primitives";
import { useJson } from "@/components/useJson";
import { tint } from "@/lib/utils";
import { latencyColor, ms, SEVERITY_COLOR } from "./types";

type Order = "rows" | "time" | "latency";
interface Instance { id: string; region: string; engine: string; engineVersion: string; instanceClass: string; status: string }
interface InventoryResp { inventory: { instances: Instance[] } }
interface TopQuery {
  rank: number; digestText: string; countStar: number; sumRowsExamined: number; seconds: number;
  rowsExaminedPerCall: number; avgLatencyMs: number; fullScanRatio: number | null;
}
interface Issue { severity: "critical" | "warning" | "info"; title: string; evidence: string; action: string; digestText?: string }
interface Insights { available: boolean; reason?: string; remedy?: string; fetchedAt: string; queries: TopQuery[]; issues: Issue[] }

const ORDERS: Array<{ value: Order; label: string }> = [
  { value: "rows", label: "Rows examined" }, { value: "time", label: "Total time" }, { value: "latency", label: "Average latency" },
];
const ISSUE_ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info };
const COLS = "28px minmax(320px,2.4fr) 80px 96px 84px 84px 72px";
const MYSQL_FAMILY = /mysql|mariadb/i;

function Statements({ instance }: { instance: Instance }) {
  const [order, setOrder] = useState<Order>("rows");
  const url = `/api/rds/${encodeURIComponent(instance.id)}/queries?region=${encodeURIComponent(instance.region)}&sort=${order}`;
  const { data, error, reload } = useJson<{ insights: Insights }>(url);
  const ins = data?.insights;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-[18px]">
        <div className="min-w-0">
          <Link href={`/rds/${encodeURIComponent(instance.id)}?region=${encodeURIComponent(instance.region)}`} className="inline-flex items-center gap-2 text-[15px] font-semibold text-foreground no-underline hover:underline">
            <span className="text-muted-foreground"><Database size={15} className="block" /></span>{instance.id}
          </Link>
          <div className="mt-[3px] text-[13px] text-muted-foreground">{instance.engine} {instance.engineVersion} · {instance.instanceClass} · {instance.region} · {instance.status}</div>
        </div>
        <Segmented value={order} onChange={setOrder} aria-label="Sort statements" options={ORDERS} />
      </div>
      {error && <div className="px-5 pb-5"><ErrorNote message={error} onRetry={reload} /></div>}
      {!error && !ins && <div className="flex flex-col gap-2 px-5 pb-5" aria-busy="true"><Skeleton className="h-[38px]" /><Skeleton className="h-[120px]" /></div>}
      {ins && !ins.available && (
        <div className="mx-5 mb-5 rounded-[10px] border border-dashed border-border-strong p-3.5 text-[13px] leading-[1.55]">
          <div className="font-semibold">Statement statistics not available</div>
          <div className="mt-0.5 text-fg-2">{ins.reason}</div>
          {ins.remedy && <div className="mt-2 text-[12.5px] text-muted-foreground">{ins.remedy}</div>}
        </div>
      )}
      {ins?.available && (
        <>
          {ins.issues.length > 0 && (
            <div className="flex flex-col gap-2.5 px-5 pb-4">
              {ins.issues.map((i, n) => {
                const color = SEVERITY_COLOR[i.severity], Icon = ISSUE_ICON[i.severity];
                return (
                  <div key={n} className="flex items-start gap-3 rounded-[10px] border border-solid p-3.5" style={{ borderColor: `color-mix(in oklab, ${color} 30%, var(--border))`, background: `color-mix(in oklab, ${color} 5%, var(--card))` }}>
                    <span className="pt-px" style={{ color }}><Icon size={14} className="block" /></span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-semibold">{i.title}</span>
                        <span className="inline-flex h-5 items-center rounded-[5px] px-1.5 text-[11px] font-semibold capitalize" style={{ color, background: tint(color) }}>{i.severity}</span>
                      </div>
                      <div className="mt-1 text-[13px] text-fg-2">{i.evidence}</div>
                      {i.digestText && <div className="mt-1.5 line-clamp-2 break-all font-mono text-[11.5px] text-muted-foreground">{i.digestText}</div>}
                      <div className="mt-1 text-[12.5px] text-muted-foreground">{i.action}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="overflow-x-auto">
            <div className="min-w-[880px]">
              <HeadRow columns={COLS}>
                <span>#</span><span>Statement digest</span><span className="text-right">Calls</span><span className="text-right">Rows / call</span>
                <span className="text-right">Avg</span><span className="text-right">Total</span><span className="text-right">No index</span>
              </HeadRow>
              {ins.queries.map((x) => (
                <div key={x.rank} className="grid items-start gap-3.5 border-0 border-b border-solid border-border px-5 py-3 text-[13px]" style={{ gridTemplateColumns: COLS }}>
                  <span className="text-muted-foreground tnum">{x.rank}</span>
                  <span className="line-clamp-3 break-all font-mono text-[11.5px] leading-[1.55] text-fg-2" title={x.digestText}>{x.digestText}</span>
                  <span className="text-right tnum">{num(x.countStar)}</span>
                  <span className="text-right tnum">{num(x.rowsExaminedPerCall)}</span>
                  <span className="text-right font-semibold tnum" style={{ color: latencyColor(x.avgLatencyMs) }}>{ms(x.avgLatencyMs)}</span>
                  <span className="text-right tnum">{x.seconds >= 100 ? num(x.seconds) : x.seconds.toFixed(1)} s</span>
                  <span className="text-right tnum">{x.fullScanRatio != null ? `${Math.round(x.fullScanRatio * 100)}%` : "—"}</span>
                </div>
              ))}
              {!ins.queries.length && <EmptyState title="No statement digests">performance_schema has not recorded any statements yet.</EmptyState>}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

export function DbQueries() {
  const { data, error, reload } = useJson<InventoryResp>("/api/rds");
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return <Skeleton className="h-[240px] rounded-[12px]" />;
  const instances = data.inventory.instances.filter((i) => MYSQL_FAMILY.test(i.engine));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
        <Badge size="md">performance_schema</Badge>
        <span>Statement totals are cumulative since each MySQL instance last restarted, so the time range above does not apply here.</span>
      </div>
      {instances.map((i) => <Statements key={`${i.region}/${i.id}`} instance={i} />)}
      {!instances.length && <Card><EmptyState title="No MySQL instances">The RDS inventory has no MySQL or MariaDB instances to analyse.</EmptyState></Card>}
    </div>
  );
}
