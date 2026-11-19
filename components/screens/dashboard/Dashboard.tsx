"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/natasha/charts";
import { isStale, istDate, istDateTime, monthLabel, num, usd } from "@/components/natasha/format";
import { MonthPicker } from "@/components/natasha/MonthPicker";
import { Banner, Delta, ErrorNote, KpiGrid, PageHeader, Screen, ScreenSkeleton } from "@/components/natasha/primitives";
import { useOnRefreshed } from "@/components/shell/ShellContext";
import { useSummary } from "@/components/shell/useOps";
import { useJson } from "@/components/useJson";
import { useMonthParam, withMonth } from "@/components/useMonth";
import { CategoryDaily, CostSplit, MonthlyHistoryCard, TransferTrendCard } from "./CostCharts";
import { CostAnomalies, DailySpend, RecentActivity, TopTable } from "./ActivityCards";
import { HealthPanel } from "./HealthPanel";
import { periodText } from "./period";
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

/** Average month-over-month change across the last six finished months, as a percentage. */
function monthlySwing(full: number[]): { pct: number | null; months: number[] } {
  const months = full.slice(-7);
  const changes: number[] = [];
  for (let i = 1; i < months.length; i++) {
    if (months[i - 1] > 0) changes.push(Math.abs(months[i] - months[i - 1]) / months[i - 1]);
  }
  return { pct: changes.length >= 2 ? (changes.reduce((a, b) => a + b, 0) / changes.length) * 100 : null, months };
}

function SwingKpi({ fullMonths }: { fullMonths: number[] }) {
  const { pct, months } = monthlySwing(fullMonths);
  const compared = Math.max(0, months.length - 1);
  return (
    <DashKpi label="Month-to-month swing" value={pct == null ? "—" : `±${pct.toFixed(1)}%`}
      footer={pct == null ? "Needs at least three finished months" : `Average change over the last ${compared} full month${compared === 1 ? "" : "s"}`}>
      <Sparkline values={months} color="var(--info)" />
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

  const header = <PageHeader maxWidth={100000} eyebrow={hello.date} title={hello.title} actions={<MonthPicker />} />;

  if (error) return <Screen label="Dashboard">{header}<ErrorNote message={error} onRetry={reload} /></Screen>;
  if (!data) return <ScreenSkeleton />;

  const current = data.isCurrentMonth;
  const prevLabel = data.prev ? monthLabel(data.prev.month) : "";
  // The current month is compared with the same point of the previous one, never with a whole month.
  const versus = prevLabel ? (current ? `same point in ${prevLabel.slice(0, 3)}` : prevLabel) : "";
  const prevShown = data.prev ? (current ? data.prev.sameDayTotal ?? data.prev.total : data.prev.total) : 0;
  const projDelta = data.projectedMonth != null && data.prev && data.prev.total > 0
    ? ((data.projectedMonth - data.prev.total) / data.prev.total) * 100 : null;
  const partialDays = current ? data.partialDays ?? 0 : 0;
  const trend = data.trend.map((t) => t.amount);
  const completeTrend = partialDays ? trend.slice(0, -partialDays) : trend;
  let run = 0;
  const cumulative = trend.map((v) => (run += v));
  // The stored row for the running month lags the live figure, so the live total replaces it.
  const liveKey = data.range.Start.slice(0, 7);
  const monthlySeries = (monthly?.series ?? []).map((p) => (current && p.month === liveKey ? { ...p, amount: data.mtdTotal } : p));
  const fullMonths = monthlySeries.filter((p) => !(current && p.month === liveKey)).map((p) => p.amount);
  const forecastSpark = data.projectedMonth != null ? [...fullMonths.slice(-4), data.projectedMonth] : fullMonths.slice(-5);
  const f = ops?.github.findings;
  const crit = (f?.CRIT ?? 0) > 0;
  const high = (f?.HIGH ?? 0) > 0;
  const springErrors = ops && !isStale(ops.spring.lastLogsSnap) ? ops.spring.servicesWithErrors : 0;
  const lambdaStale = !ops || isStale(ops.lambda.lastSnap);
  const lambdaErrors = ops?.lambda.errors24h ?? 0;
  const topDescription = `${current ? "Month-to-date" : "Total for month"}${versus ? ` · change vs ${versus}` : ""}`;
  const asOfDay = (iso: string | null) => istDate(iso).replace(/ \d{4}$/, "");

  return (
    <Screen label="Dashboard">
      {header}
      {data.stale && (
        <Banner tone="var(--warning)">
          AWS session expired. Showing the last saved data{data.asOf ? ` from ${istDateTime(data.asOf)}` : ""}. The daily trend and the forecast need a live connection.
        </Banner>
      )}
      {ops && (crit || high || springErrors > 0 || (lambdaErrors > 0 && !lambdaStale)) && (
        <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-solid py-3 pl-4 pr-3.5"
          style={{ borderColor: "color-mix(in oklab, var(--danger) 30%, var(--border))", background: "color-mix(in oklab, var(--danger) 6%, var(--card))" }}>
          <span className="h-2 w-2 shrink-0 rounded-[8px] bg-danger animate-nt-pulse" />
          <span className="text-[14px] font-semibold">{crit ? "Critical attention needed" : "Attention needed"}</span>
          <div className="flex flex-wrap gap-1.5">
            {crit && <Badge tone="var(--danger)" className="px-2">{num(f!.CRIT)} critical findings</Badge>}
            {high && <Badge tone="var(--orange)" className="px-2">{num(f!.HIGH)} high findings</Badge>}
            {springErrors > 0 && <Badge tone="var(--warning)" className="px-2">{springErrors} service{springErrors === 1 ? "" : "s"} with errors</Badge>}
            {lambdaErrors > 0 && (lambdaStale
              ? <Badge className="px-2 text-fg-2">{num(lambdaErrors)} Lambda errors as of {asOfDay(ops.lambda.lastSnap)}</Badge>
              : <Badge tone="var(--warning)" className="px-2">{num(lambdaErrors)} Lambda errors in 24 h</Badge>)}
          </div>
          <Button asChild size="sm" className="ml-auto">
            <Link href="/incidents" className="no-underline">Review alerts<ArrowRight size={14} className="block" /></Link>
          </Button>
        </div>
      )}
      <KpiGrid>
        <DashKpi label={current ? "Month-to-date" : "Total for month"} value={usd(data.mtdTotal, 0)}
          badge={data.prev && prevShown > 0 ? <Delta pct={data.prev.deltaPct} /> : undefined}
          footer={data.prev && prevShown > 0 ? `vs ${versus} · ${usd(prevShown, 0)}` : " "}>
          <Sparkline values={cumulative} color="var(--success)" />
        </DashKpi>
        <DashKpi label="Run-rate forecast" value={data.projectedMonth != null ? usd(data.projectedMonth, 0) : "—"}
          badge={projDelta != null ? <Delta pct={projDelta} /> : undefined}
          footer={!current ? "Applies to the current month only" : data.projectedMonth == null ? "Needs a full day of spend"
            : `Month-end at the last 7 days' pace${data.prev && data.prev.total > 0 ? ` · ${prevLabel.slice(0, 3)} was ${usd(data.prev.total, 0)}` : ""}`}>
          <Sparkline values={forecastSpark} color={projDelta != null && projDelta > 0 ? "var(--danger)" : "var(--success)"} />
        </DashKpi>
        <DashKpi label="Average per day" value={usd(data.avgPerDay, 0)}
          badge={<Badge>{data.completeDays ?? completeTrend.length} full day{(data.completeDays ?? completeTrend.length) === 1 ? "" : "s"}</Badge>}
          footer={current ? `Last 7 full days · ${usd(data.last7, 0)}` : `Last 7 days · ${usd(data.last7, 0)}`}>
          <Sparkline values={completeTrend} color="var(--c20)" />
        </DashKpi>
        <SwingKpi fullMonths={fullMonths} />
      </KpiGrid>
      {ops && <HealthPanel s={ops} />}
      <CategoryDaily />
      <div className={TWO_UP}>
        <CostSplit />
        <DailySpend trend={data.trend} partialDays={partialDays} />
      </div>
      <div className={TWO_UP}>
        <CostAnomalies />
        <RecentActivity />
      </div>
      <div className={TWO_UP}>
        <TopTable title="Top services" nameLabel="Service" rows={data.topServices} description={topDescription} />
        <TopTable title="Top regions" nameLabel="Region" mono rows={data.topRegions} description={topDescription} />
      </div>
      <div className={TWO_UP}>
        <MonthlyHistoryCard data={monthly ? { series: monthlySeries } : null} />
        <TransferTrendCard />
      </div>
      <div className="text-[12.5px] text-muted-foreground">
        Period {periodText(data.range)} · AWS Cost Explorer
        {current && partialDays > 0 && ` · AWS is still reporting the last ${partialDays} days, so they are left out of the daily average and the forecast.`}
        {!current && " · Past month, so no forecast."}
      </div>
    </Screen>
  );
}
