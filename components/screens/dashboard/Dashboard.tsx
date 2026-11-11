"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/natasha/charts";
import { monthLabel, num, usd } from "@/components/natasha/format";
import { MonthPicker } from "@/components/natasha/MonthPicker";
import { Banner, Delta, ErrorNote, KpiGrid, PageHeader, Screen, ScreenSkeleton } from "@/components/natasha/primitives";
import { useOnRefreshed } from "@/components/shell/ShellContext";
import { useSummary } from "@/components/shell/useOps";
import { useJson } from "@/components/useJson";
import { useMonthParam, withMonth } from "@/components/useMonth";
import { CategoryDaily, CostSplit, MonthlyHistoryCard, TransferTrendCard } from "./CostCharts";
import { CostAnomalies, DailySpend, RecentActivity, TopTable } from "./ActivityCards";
import { HealthPanel } from "./HealthPanel";
import type { MonthlyTotalResp, SummaryResp } from "./types";

function greeting(h: number): string {
  if (h < 5) return "You're up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

function useGreeting() {
  const { data: session } = useSession();
  const email = session?.user?.email ?? "";
  const first = (session?.user?.name ?? email.split("@")[0] ?? "").split(/[\s.]/)[0] || "there";
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return {
    title: `${now ? greeting(now.getHours()) : "Welcome back"}, ${first.charAt(0).toUpperCase()}${first.slice(1)}`,
    date: now ? now.toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Kolkata" }).replace(/,/, ",") : " ",
  };
}

function DashKpi({ label, badge, value, footer, children }: { label: string; badge?: ReactNode; value: ReactNode; footer: ReactNode; children: ReactNode }) {
  return (
    <Card className="flex min-w-0 flex-col gap-2 px-5 pb-4 pt-[18px]">
      <div className="flex min-h-[22px] items-center justify-between gap-2">
        <span className="whitespace-nowrap text-[13px] font-medium text-muted-foreground">{label}</span>{badge}
      </div>
      <div className="text-[30px] font-semibold leading-[1.15] tracking-[-0.035em] tnum">{value}</div>
      <span className="text-[12.5px] text-muted-foreground">{footer}</span>
      <div className="mt-auto pt-2">{children}</div>
    </Card>
  );
}

function backtestError(series: number[]): number | null {
  const recent = series.slice(-6);
  if (recent.length < 3) return null;
  const errs: number[] = [];
  for (let i = 2; i < recent.length; i++) {
    const w = recent.slice(Math.max(0, i - 3), i);
    const f = w.reduce((a, b) => a + b, 0) / w.length;
    if (f > 0) errs.push(Math.abs(recent[i] - f) / f);
  }
  return errs.length ? (errs.reduce((a, b) => a + b, 0) / errs.length) * 100 : null;
}

function VarianceKpi({ monthly }: { monthly: MonthlyTotalResp | null }) {
  const vals = monthly?.series.map((p) => p.amount) ?? [];
  const err = backtestError(vals);
  const conf = err == null ? null : err > 25 ? "Low" : err > 12 ? "Medium" : "High";
  const color = conf === "Low" ? "var(--warning)" : conf === "Medium" ? "var(--info)" : "var(--success)";
  return (
    <DashKpi label="Forecast variance" value={err == null ? "—" : `±${err.toFixed(1)}%`}
      badge={conf ? <Badge tone={color}>{conf} confidence</Badge> : undefined}
      footer={err == null ? `Needs 3+ months — have ${vals.length}` : `Typical MoM · 3-MA back-test · ${Math.min(6, vals.length)} mo`}>
      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-3 gap-1">
          {["Low", "Medium", "High"].map((l) => <span key={l} className="h-1.5 rounded-[3px]" style={{ background: l === conf ? color : "var(--card-2)" }} />)}
        </div>
        <div className="grid grid-cols-3 gap-1 text-[11px] text-muted-foreground">
          {["Low", "Medium", "High"].map((l) => <span key={l} style={l === conf ? { color, fontWeight: 500 } : undefined}>{l}</span>)}
        </div>
      </div>
    </DashKpi>
  );
}

const TWO_UP = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] gap-4";

export default function Dashboard() {
  const month = useMonthParam();
  const hello = useGreeting();
  const { data, error, reload } = useJson<SummaryResp>(withMonth("/api/cost/summary", month));
  const { data: monthly, reload: reloadMonthly } = useJson<MonthlyTotalResp>("/api/cost/monthly-total");
  const { data: ops } = useSummary();
  useOnRefreshed(() => { reload(); reloadMonthly(); });

  const header = (
    <PageHeader maxWidth={100000} eyebrow={hello.date} title={hello.title}
      description="Infra at a glance — GitHub security, Spring services, Lambda — and your AWS spend below."
      actions={<MonthPicker />} />
  );

  if (error) return <Screen label="Dashboard">{header}<ErrorNote message={error} onRetry={reload} /></Screen>;
  if (!data) return <ScreenSkeleton />;

  const prevLabel = data.prev ? monthLabel(data.prev.month) : "";
  const projDelta = data.projectedMonth != null && data.prev && data.prev.total > 0
    ? ((data.projectedMonth - data.prev.total) / data.prev.total) * 100 : null;
  const trend = data.trend.map((t) => t.amount);
  let run = 0;
  const cumulative = trend.map((v) => (run += v));
  const monthlyVals = monthly?.series.map((p) => p.amount) ?? [];
  const forecastSpark = data.projectedMonth != null ? [...monthlyVals.slice(-5, -1), data.projectedMonth] : monthlyVals.slice(-5);
  const f = ops?.github.findings;
  const crit = (f?.CRIT ?? 0) > 0;

  return (
    <Screen label="Dashboard">
      {header}
      {data.stale && (
        <Banner tone="var(--warning)">
          AWS session expired — showing the last saved data{data.asOf ? ` from ${new Date(data.asOf).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST` : ""}. Daily trend and forecast need a live connection.
        </Banner>
      )}
      {ops && (crit || ops.spring.servicesWithErrors > 0 || ops.lambda.errors24h > 0) && (
        <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-solid py-3 pl-4 pr-3.5"
          style={{ borderColor: "color-mix(in oklab, var(--danger) 30%, var(--border))", background: "color-mix(in oklab, var(--danger) 6%, var(--card))" }}>
          <span className="h-2 w-2 shrink-0 rounded-[8px] bg-danger animate-nt-pulse" />
          <span className="text-[14px] font-semibold">{crit ? "Critical attention needed" : "Attention needed"}</span>
          <div className="flex flex-wrap gap-1.5">
            {crit && <Badge tone="var(--danger)" className="px-2">{num(f!.CRIT)} CRIT findings</Badge>}
            {(f?.HIGH ?? 0) > 0 && <Badge tone="var(--orange)" className="px-2">{num(f!.HIGH)} HIGH findings</Badge>}
            {ops.spring.servicesWithErrors > 0 && <Badge tone="var(--warning)" className="px-2">{ops.spring.servicesWithErrors} services with errors</Badge>}
            {ops.lambda.errors24h > 0 && <Badge tone="var(--warning)" className="px-2">{num(ops.lambda.errors24h)} Lambda errors (24h)</Badge>}
          </div>
          <Button asChild size="sm" className="ml-auto">
            <Link href="/incidents" className="no-underline">Review alerts<ArrowRight size={14} className="block" /></Link>
          </Button>
        </div>
      )}
      <KpiGrid>
        <DashKpi label={data.isCurrentMonth ? "Month-to-date" : "Total for month"} value={usd(data.mtdTotal)}
          badge={data.prev ? <Delta pct={data.prev.deltaPct} /> : undefined}
          footer={data.prev ? `vs ${prevLabel} · ${usd(data.prev.total)}` : " "}>
          <Sparkline values={cumulative} color="var(--success)" />
        </DashKpi>
        <DashKpi label="Month-end forecast" value={data.projectedMonth != null ? usd(data.projectedMonth) : "—"}
          badge={projDelta != null ? <Delta pct={projDelta} /> : undefined}
          footer={data.prev ? `Projected total vs ${prevLabel}` : "Projected total"}>
          <Sparkline values={forecastSpark} color="var(--danger)" />
        </DashKpi>
        <DashKpi label="Average per day" value={usd(data.avgPerDay)}
          badge={<Badge>{trend.length} days</Badge>} footer={`Last 7 days · ${usd(data.last7)}`}>
          <Sparkline values={trend} color="var(--c20)" />
        </DashKpi>
        <VarianceKpi monthly={monthly} />
      </KpiGrid>
      {ops && <HealthPanel s={ops} />}
      <CategoryDaily />
      <div className={TWO_UP}>
        <CostSplit />
        <DailySpend trend={data.trend} partial={data.isCurrentMonth} />
      </div>
      <div className={TWO_UP}>
        <CostAnomalies />
        <RecentActivity />
      </div>
      <div className={TWO_UP}>
        <TopTable title="Top services" nameLabel="Service" rows={data.topServices} description={`Month-to-date${prevLabel ? ` · Δ vs ${prevLabel}` : ""}`} />
        <TopTable title="Top regions" nameLabel="Region" mono rows={data.topRegions} description={`Month-to-date${prevLabel ? ` · Δ vs ${prevLabel}` : ""}`} />
      </div>
      <div className={TWO_UP}>
        <MonthlyHistoryCard data={monthly} />
        <TransferTrendCard />
      </div>
      <div className="text-[12.5px] text-muted-foreground">
        Period <span className="font-mono">{data.range.Start} → {data.range.End}</span> · AWS Cost Explorer
        {data.isCurrentMonth && data.forecastRest == null && " · Forecast unavailable — Cost Explorer needs more history."}
        {!data.isCurrentMonth && " · Past month — forecast does not apply."}
      </div>
    </Screen>
  );
}
