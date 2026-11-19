"use client";
import { useState } from "react";
import Link from "next/link";
import { Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { num } from "@/components/natasha/format";
import { EmptyState, ErrorNote, HeadRow, Skeleton } from "@/components/natasha/primitives";
import { useJson } from "@/components/useJson";
import { IssueList } from "@/components/screens/elasticsearch/IssueList";
import { latencyColor, ms } from "./types";

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
const ISSUES_SHOWN = 3;
const COLS = "28px minmax(320px,2.4fr) 80px 96px 84px 84px 72px";
const MYSQL_FAMILY = /mysql|mariadb/i;

function Statements({ instance }: { instance: Instance }) {
  const [order, setOrder] = useState<Order>("rows");
  const [allIssues, setAllIssues] = useState(false);
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
              {/* The statement text is in the table below at the same rank; the cards stay short. */}
              <IssueList issues={(allIssues ? ins.issues : ins.issues.slice(0, ISSUES_SHOWN)).map((i, n) => ({ ...i, title: `${n + 1}. ${i.title}`, evidence: i.digestText ? `${i.evidence} Statement: ${i.digestText.slice(0, 140)}${i.digestText.length > 140 ? "…" : ""}` : i.evidence }))} />
              {ins.issues.length > ISSUES_SHOWN && (
                <Button variant="ghost" size="xs" className="self-start" aria-expanded={allIssues} onClick={() => setAllIssues((v) => !v)}>
                  {allIssues ? `Show the top ${ISSUES_SHOWN} only` : `Show all ${ins.issues.length} findings`}
                </Button>
              )}
            </div>
          )}
          <div className="overflow-x-auto">
            <div className="min-w-[880px]">
              <HeadRow columns={COLS}>
                <span>#</span><span>Statement (values removed)</span><span className="text-right">Calls</span><span className="text-right">Rows / call</span>
                <span className="text-right">Avg</span><span className="text-right">Total</span><span className="text-right">No index</span>
              </HeadRow>
              {ins.queries.map((x) => (
                <div key={x.rank} className="grid items-start gap-3.5 border-0 border-b border-solid border-border px-5 py-3 text-[13px]" style={{ gridTemplateColumns: COLS }}>
                  <span className="text-muted-foreground tnum">{x.rank}</span>
                  <span className="line-clamp-3 break-all font-mono text-[11.5px] leading-[1.55] text-fg-2" title={x.digestText}>{x.digestText}</span>
                  <span className="text-right tnum">{num(x.countStar)}</span>
                  <span className="text-right tnum">{num(x.rowsExaminedPerCall)}</span>
                  <span className="text-right font-semibold tnum" style={{ color: latencyColor(x.avgLatencyMs) }}>{ms(x.avgLatencyMs)}</span>
                  <span className="text-right tnum" title={`${num(x.seconds)} s`}>{x.seconds >= 3600 ? `${num(x.seconds / 3600)} h` : x.seconds >= 100 ? `${num(x.seconds)} s` : `${x.seconds.toFixed(1)} s`}</span>
                  <span className="text-right tnum">{x.fullScanRatio != null ? `${Math.round(x.fullScanRatio * 100)}%` : "—"}</span>
                </div>
              ))}
              {!ins.queries.length && <EmptyState title="No statements recorded">MySQL has not recorded any statement statistics yet.</EmptyState>}
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
        <span>MySQL statement statistics. Totals are cumulative since each MySQL instance last restarted, so the time range above does not apply here.</span>
      </div>
      {instances.map((i) => <Statements key={`${i.region}/${i.id}`} instance={i} />)}
      {!instances.length && <Card><EmptyState title="No MySQL instances">The RDS inventory has no MySQL or MariaDB instances to analyse.</EmptyState></Card>}
    </div>
  );
}
