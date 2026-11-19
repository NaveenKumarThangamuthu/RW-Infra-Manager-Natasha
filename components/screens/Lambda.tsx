"use client";
import { Fragment, useMemo, useState } from "react";
import { ChevronRight, Clock, ExternalLink, List, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { CheckButton } from "@/components/natasha/CheckButton";
import { ago, ageMinutes, dayLabel, istDate, istDateTime, istTime, num, usd } from "@/components/natasha/format";
import { Banner, Dot, ErrorNote, PageHeader, Screen, ScreenSkeleton, ShareBar, StatStrip } from "@/components/natasha/primitives";
import { useOnRefreshed, useShell } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { cn, tint } from "@/lib/utils";

interface Fn { arn: string; name: string; runtime: string; memoryMb: number; lastModified: string | null; invocations24h: number; errors24h: number; errorRate: number }
interface OhioResp { fetchedAt: string | null; region: string; functions: Fn[] }
interface Prov { usageType: string; category: string; cost: number }
interface CostResp { range: { Start: string; End: string }; total: number; provisioning: Prov[] }
interface LogEvent { at: string | null; stream: string | null; message: string }

const COLS = "16px minmax(260px,1.8fr) 96px 72px 160px 86px 90px 150px";
/** Cost Explorer end dates are exclusive: show the last day that is included. */
const lastDay = (end: string) => new Date(Date.parse(`${end}T00:00:00Z`) - 86_400_000).toISOString();
/** "19 Nov" in IST. */
const istDay = (iso: string) => istDate(iso).replace(/ \d{4}$/, "");
const STALE_MINUTES = 30;

function usageBuckets(items: Prov[]) {
  const sum = (t: RegExp) => items.filter((p) => t.test(`${p.category} ${p.usageType}`)).reduce((a, p) => a + p.cost, 0);
  const duration = sum(/duration|gb-?s|lambda-gb|provisioned/i);
  const requests = sum(/request/i);
  const total = items.reduce((a, p) => a + p.cost, 0);
  return [
    { label: "Duration (GB-s)", color: "var(--c30)", v: duration },
    { label: "Requests", color: "var(--c20)", v: requests },
    { label: "Other", color: "var(--cother)", v: Math.max(0, total - duration - requests) },
  ];
}

function Logs({ name }: { name: string }) {
  const { data, error, loading } = useJson<{ events: LogEvent[] }>(`/api/perf/lambda/logs?function=${encodeURIComponent(name)}&hours=1&limit=50`);
  if (loading) return <div className="w-full text-[12.5px] text-muted-foreground">Loading CloudWatch Logs…</div>;
  if (error) return <div className="w-full"><ErrorNote message={error} /></div>;
  const events = data?.events ?? [];
  if (!events.length) return <div className="w-full text-[12.5px] text-muted-foreground">No log events in the last hour.</div>;
  return (
    <div className="flex max-h-[280px] w-full flex-col gap-px overflow-y-auto rounded-[8px] border border-solid border-border bg-border">
      <div className="bg-card-2 px-3 py-1.5 text-[11.5px] text-muted-foreground">Last hour · times in IST · addresses, ids and quoted values removed</div>
      {events.map((e, i) => (
        <div key={i} className="grid grid-cols-[124px_minmax(0,1fr)] items-baseline gap-2.5 bg-card-2 px-3 py-1.5 font-mono text-[11.5px] leading-[1.55]">
          <span className="whitespace-nowrap text-muted-foreground tnum">{e.at ? `${istDay(e.at)}, ${istTime(e.at)}` : "—"}</span>
          <span className="min-w-0 break-words text-fg-2">{e.message}</span>
        </div>
      ))}
    </div>
  );
}

export default function Lambda() {
  const { refresh, refreshing } = useShell();
  const ohio = useJson<OhioResp>("/api/perf/lambda");
  const cost = useJson<CostResp>("/api/cost/lambda");
  useOnRefreshed(() => { ohio.reload(); cost.reload(); });
  const [q, setQ] = useState("");
  const [errOnly, setErrOnly] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [logsOpen, setLogsOpen] = useState<Record<string, boolean>>({});

  const fns = useMemo(() => [...(ohio.data?.functions ?? [])].sort((a, b) => b.invocations24h - a.invocations24h), [ohio.data]);
  const header = (
    <PageHeader title="Lambda" description="Ohio (us-east-2) functions from CloudWatch: invocations and errors for the 24 hours before the last refresh, plus cost by usage type for the last 14 days."
      actions={<Button variant="primary" size="lg" className="px-3.5" disabled={refreshing} onClick={() => void refresh(["lambda-ohio"])}>
        <RefreshCw size={14} className={cn("block", refreshing && "animate-nt-spin")} />Refresh Lambdas
      </Button>} />
  );
  if (ohio.error) return <Screen label="Lambda">{header}<ErrorNote message={ohio.error} onRetry={ohio.reload} /></Screen>;
  if (!ohio.data) return <ScreenSkeleton />;

  const totalInv = fns.reduce((a, f) => a + f.invocations24h, 0);
  const totalErr = fns.reduce((a, f) => a + f.errors24h, 0);
  const invoked = fns.filter((f) => f.invocations24h > 0).length;
  const erroring = fns.filter((f) => f.errors24h > 0).length;
  const maxInv = Math.max(1, fns[0]?.invocations24h ?? 1);
  const needle = q.trim().toLowerCase();
  const list = fns.filter((f) => (!errOnly || f.errors24h > 0) && (!needle || f.name.toLowerCase().includes(needle)));
  const fetched = ohio.data.fetchedAt;
  const fetchedAge = ageMinutes(fetched);
  const buckets = usageBuckets(cost.data?.provisioning ?? []);
  const costTotal = cost.data?.total ?? 0;
  const region = ohio.data.region || "us-east-2";
  const stale = !!fetched && fetchedAge != null && fetchedAge > STALE_MINUTES;
  // When the snapshot is old, every "24h" label says which 24 hours it covers.
  const day = !stale || !fetched ? "24h" : fetchedAge! >= 1440 ? `24h to ${istDay(fetched)}` : `24h to ${istTime(fetched).slice(0, 5)}`;

  return (
    <Screen label="Lambda">
      {header}
      {stale && (
        <Banner tone="var(--warning)">
          <span className="text-warning"><Clock size={14} className="block" /></span>
          <span className="min-w-0 flex-[1_1_220px]">Function counts are from the last successful refresh, <span className="font-semibold">{istDateTime(fetched)}</span>. They are not current.</span>
          <Badge tone="var(--warning)">Stale · last successful refresh {ago(fetched)}</Badge>
        </Banner>
      )}
      <StatStrip items={[
        { label: "Functions", value: num(fns.length), sub: <span className="font-mono">{region}</span> },
        { label: `Invocations · ${day}`, value: num(totalInv), sub: `${invoked} functions invoked` },
        { label: `Errors · ${day}`, value: num(totalErr), color: totalErr ? "var(--danger)" : "var(--success)", sub: `${totalInv ? ((totalErr / totalInv) * 100).toFixed(2) : "0.00"}% of invocations` },
        { label: "Erroring functions", value: num(erroring), color: erroring ? "var(--danger)" : "var(--success)", sub: `of ${fns.length} functions` },
        { label: "Cost · 14 days", value: usd(costTotal), sub: cost.data ? `${dayLabel(cost.data.range.Start)} – ${dayLabel(lastDay(cost.data.range.End))}` : "—" },
      ]} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-4">
        <Card>
          <CardHeader title="Cost by usage type" description="Requests · duration · provisioned concurrency" className="pb-1.5"
            actions={<Badge size="md" className="text-fg-2">{usd(costTotal)} · 14 days</Badge>} />
          <div className="flex flex-col gap-4 px-5 pb-5 pt-3.5">
            {cost.error && <ErrorNote message={cost.error} onRetry={cost.reload} />}
            {buckets.map((b) => (
              <div key={b.label} className="flex flex-col gap-[7px]">
                <div className={cn("flex justify-between gap-3 text-[13px]", !b.v && "text-muted-foreground")}>
                  <span className="inline-flex items-center gap-2"><Dot color={b.color} size={8} />{b.label}</span>
                  <span className={cn("tnum", b.v > 0 && "font-semibold")}>{usd(b.v)}</span>
                </div>
                <span className="block h-2 overflow-hidden rounded-[8px] bg-card-2"><span className="block h-full rounded-[8px]" style={{ width: `${costTotal > 0 ? (b.v / costTotal) * 100 : 0}%`, background: b.color }} /></span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Top functions by invocations" description={`${day} · share of ${num(totalInv)}`} className="pb-1.5" />
          <div className="flex flex-col gap-3 px-5 pb-5 pt-3.5">
            {fns.slice(0, 5).map((f) => (
              <div key={f.arn} className="grid grid-cols-[minmax(0,1fr)_64px] items-center gap-3">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="truncate text-[12.5px]">{f.name}</span>
                  <ShareBar pct={totalInv ? (f.invocations24h / totalInv) * 100 : 0} />
                </div>
                <span className="text-right text-[13px] font-medium tnum">{num(f.invocations24h)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Functions · Ohio ({region})</h3>
            <div className="mt-[3px] text-[13px] text-muted-foreground">{`CloudWatch invocation and error counts · ${day} · open a row for logs`}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CheckButton on={errOnly} onClick={() => setErrOnly((v) => !v)}>With errors only</CheckButton>
            <SearchInput wrapperClassName="w-60 max-w-full" placeholder="Function name…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[1000px]">
            <div className="grid h-[38px] items-center gap-3.5 border-0 border-y border-solid border-border bg-card-2 px-5 text-[12px] font-medium text-muted-foreground" style={{ gridTemplateColumns: COLS }}>
              <span /><span>Function</span><span>Runtime</span><span>Memory</span><span>Invocations · {day}</span><span className="text-right">Errors</span><span>Error rate</span><span>Last modified</span>
            </div>
            {list.map((f) => {
              const isOpen = !!open[f.arn];
              const rate = f.invocations24h ? (f.errors24h / f.invocations24h) * 100 : 0;
              const rateColor = rate >= 50 ? "var(--danger)" : "var(--warning)";
              const errColor = f.errors24h ? "var(--danger)" : "var(--subtle-fg)";
              return (
                <Fragment key={f.arn}>
                  <div role="button" tabIndex={0} onClick={() => setOpen((o) => ({ ...o, [f.arn]: !isOpen }))} onKeyDown={(e) => { if (e.key === "Enter") setOpen((o) => ({ ...o, [f.arn]: !isOpen })); }}
                    className={cn("grid min-h-[46px] cursor-pointer items-center gap-3.5 border-0 border-b border-solid border-border px-5 text-[13px] hover:bg-hover", isOpen && "bg-hover", !f.invocations24h && "opacity-60")} style={{ gridTemplateColumns: COLS }}>
                    <span className={cn("text-muted-foreground transition-transform duration-150", isOpen && "rotate-90")}><ChevronRight size={14} className="block" /></span>
                    <span className="truncate font-medium">{f.name}</span>
                    <span><span className="rounded-[5px] border border-solid border-border px-1.5 py-0.5 font-mono text-[11.5px] text-fg-2">{f.runtime}</span></span>
                    <span className="text-[12.5px] text-fg-2 tnum">{f.memoryMb} MB</span>
                    <div className="flex items-center gap-2">
                      <span className="w-14 text-right tnum">{num(f.invocations24h)}</span>
                      <span className="block h-[5px] flex-1 overflow-hidden rounded-[5px] bg-card-2"><span className="block h-full rounded-[5px] bg-brand" style={{ width: `${f.invocations24h ? Math.max(1, (f.invocations24h / maxInv) * 100) : 0}%` }} /></span>
                    </div>
                    <span className="text-right font-semibold tnum" style={{ color: errColor }}>{num(f.errors24h)}</span>
                    <span>
                      {f.errors24h ? <Badge tone={rateColor}>{rate.toFixed(2)}%</Badge> : <span className="inline-flex h-[22px] items-center px-[7px] text-[12px] font-medium text-subtle">—</span>}
                    </span>
                    <span className="whitespace-nowrap text-[12.5px] text-muted-foreground">{f.lastModified ? istDate(f.lastModified) : "—"}</span>
                  </div>
                  {isOpen && (
                    <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-border bg-hover pb-4 pl-[50px] pr-5 pt-3">
                      <div className="flex flex-wrap gap-5 text-[12.5px]">
                        <span><span className="text-muted-foreground">Invocations </span><span className="font-medium tnum">{num(f.invocations24h)}</span></span>
                        <span><span className="text-muted-foreground">Errors </span><span className="font-medium tnum" style={{ color: errColor }}>{num(f.errors24h)}</span></span>
                        <span><span className="text-muted-foreground">Runtime </span><span className="font-mono">{f.runtime}</span></span>
                        <span><span className="text-muted-foreground">Memory </span>{f.memoryMb} MB</span>
                      </div>
                      <div className="ml-auto flex gap-2">
                        <Button size="sm" className="px-2.5 text-[12.5px]" aria-expanded={!!logsOpen[f.arn]} onClick={() => setLogsOpen((o) => ({ ...o, [f.arn]: !o[f.arn] }))}><List size={12} className="block" />CloudWatch Logs</Button>
                        <Button asChild size="sm" className="px-2.5 text-[12.5px]">
                          <a className="no-underline" target="_blank" rel="noreferrer" href={`https://${region}.console.aws.amazon.com/lambda/home?region=${region}#/functions/${encodeURIComponent(f.name)}`}><ExternalLink size={12} className="block" />AWS console</a>
                        </Button>
                      </div>
                      {logsOpen[f.arn] && <Logs name={f.name} />}
                    </div>
                  )}
                </Fragment>
              );
            })}
            {list.length === 0 && <div className="px-5 py-12 text-center text-[13px] text-muted-foreground">No functions match the current filters.</div>}
          </div>
        </div>
        <div className="px-5 pb-3.5 pt-3 text-[12.5px] text-muted-foreground tnum">Showing {list.length} of {fns.length} functions</div>
      </Card>
    </Screen>
  );
}
