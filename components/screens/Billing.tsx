"use client";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { TimeChart } from "@/components/natasha/charts";
import { monthLabel, shortService, usd } from "@/components/natasha/format";
import { MonthPicker } from "@/components/natasha/MonthPicker";
import { ErrorNote, Kpi, KpiGrid, PageHeader, Delta, Screen, ScreenSkeleton, ShareBar } from "@/components/natasha/primitives";
import { useOnRefreshed, useShell } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { useMonthParam, withMonth } from "@/components/useMonth";
import { downloadCsv, toCsv } from "@/components/csv";
import { cn } from "@/lib/utils";
import { periodDays, periodText } from "./dashboard/period";
import type { SummaryResp } from "./dashboard/types";

interface CostItem { key: string; amount: number; unit: string }
interface BillResp { range: { Start: string; End: string }; total: number; recordTotal: number; services: CostItem[]; byRecordType: CostItem[] }
interface MonthlyResp { series: Array<{ month: string; amount: number }> }
type BillTab = "all" | "charges" | "credits";

const COLS = "minmax(220px,1.6fr) minmax(120px,1fr) 64px 96px";

/** Plain names for Cost Explorer's record types. */
const RECORD_TYPES: Record<string, string> = {
  Usage: "Usage",
  Tax: "Tax",
  Credit: "Credits",
  Refund: "Refunds",
  Fee: "Fees",
  Support: "Support",
  DiscountedUsage: "Usage covered by Reserved Instances",
  RIFee: "Reserved Instance fees",
  SavingsPlanCoveredUsage: "Usage covered by Savings Plans",
  SavingsPlanNegation: "Savings Plan discount",
  SavingsPlanRecurringFee: "Savings Plan monthly fee",
  SavingsPlanUpfrontFee: "Savings Plan upfront fee",
  BundledDiscount: "Bundled discount",
  PrivateRateDiscount: "Private rate discount",
};
const recordLabel = (key: string) => RECORD_TYPES[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2");
/** Anything that prints as $0.00. */
const isZero = (amount: number) => Math.abs(amount) < 0.005;

export default function Billing() {
  const month = useMonthParam();
  const { toast } = useShell();
  const { data, error, reload } = useJson<BillResp>(withMonth("/api/cost/bill", month));
  const { data: monthly, reload: reloadMonthly } = useJson<MonthlyResp>("/api/cost/monthly-total");
  // Same source as Home, so the comparison with the previous month is identical on both pages.
  const { data: summary, reload: reloadSummary } = useJson<SummaryResp>(withMonth("/api/cost/summary", month));
  useOnRefreshed(() => { reload(); reloadMonthly(); reloadSummary(); });
  const [tab, setTab] = useState<BillTab>("all");
  const [q, setQ] = useState("");

  const services = useMemo(() => data?.services ?? [], [data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return services.filter((s) => (tab === "charges" ? s.amount > 0 : tab === "credits" ? s.amount < 0 : true) && (!needle || s.key.toLowerCase().includes(needle) || shortService(s.key).toLowerCase().includes(needle)));
  }, [services, tab, q]);

  const header = (
    <PageHeader maxWidth={720} title="Billing" description="Every service line for the month and the breakdown by charge type. This is the complete bill."
      actions={<>
        <MonthPicker />
        <Button variant="primary" size="lg" onClick={() => {
          downloadCsv("aws-bill.csv", toCsv(rows.map((r) => ({ service: r.key, amount: r.amount, unit: r.unit })), [
            { key: "service", label: "Service" }, { key: "amount", label: "Amount" }, { key: "unit", label: "Unit" },
          ]));
          toast(`Exported ${rows.length} line items to CSV`);
        }}><Download size={14} className="block" />Export CSV</Button>
      </>} />
  );

  if (error) return <Screen label="Billing">{header}<ErrorNote message={error} onRetry={reload} /></Screen>;
  if (!data) return <ScreenSkeleton />;

  const billKey = data.range.Start.slice(0, 7);
  const current = summary?.isCurrentMonth ?? !month;
  // The stored row for the running month lags the live bill, so the live total replaces it.
  const history = (monthly?.series ?? []).map((p) => (current && p.month === billKey ? { ...p, amount: data.total } : p));
  const vals = history.map((p) => p.amount);
  const full = history.map((p) => monthLabel(p.month));
  // Averages use finished months only: the running month would drag them down.
  const finished = history.filter((p) => !(current && p.month === billKey));
  const totalFull = finished.reduce((a, p) => a + p.amount, 0);
  const avgFull = finished.length ? totalFull / finished.length : 0;
  const prevVal = vals.length >= 2 ? vals[vals.length - 2] : 0;
  const latest = vals[vals.length - 1] ?? 0;
  const latestIsRunning = current && history[history.length - 1]?.month === billKey;
  const mom = prevVal > 0 && !latestIsRunning ? ((latest - prevVal) / prevVal) * 100 : null;
  // Previous month: a running month is compared with the same point of it, a finished month with all of it.
  const prev = summary?.prev;
  const prevShown = prev ? (current ? prev.sameDayTotal ?? prev.total : prev.total) : 0;
  const prevName = prev ? monthLabel(prev.month) : "";
  const days = periodDays(data.range);
  const charged = services.filter((s) => !isZero(s.amount)).length;
  const credits = services.filter((s) => s.amount <= -0.005).length;
  const positive = services.filter((s) => s.amount >= 0.005).length;
  const maxAbs = Math.max(1e-9, ...rows.map((r) => Math.abs(r.amount)));
  const shown = rows.reduce((a, r) => a + r.amount, 0);
  const momText = (i: number) => {
    if (i === 0 || vals[i - 1] === 0) return "First month in range";
    if (latestIsRunning && i === vals.length - 1) return "Month in progress";
    const p = ((vals[i] - vals[i - 1]) / vals[i - 1]) * 100;
    return `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}% vs ${full[i - 1]}`;
  };

  return (
    <Screen label="Billing">
      {header}
      <KpiGrid>
        <Kpi label={current ? "Bill so far" : "Total bill"} value={usd(data.total)} badge={prev && prevShown > 0 ? <Delta pct={prev.deltaPct} /> : undefined}
          footer={prev && prevShown > 0 ? `vs ${current ? `same point in ${prevName.slice(0, 3)}` : prevName} · ${usd(prevShown)}` : "No earlier month to compare with"} />
        <Kpi label="Service line items" value={services.length} footer={`${charged} with charges · ${services.length - charged} at $0.00`} />
        <Kpi label="Billing period" value={periodText(data.range, { year: false })}
          footer={`${data.range.Start.slice(0, 4)} · ${days} day${days === 1 ? "" : "s"}${current ? " so far" : ""}`} />
        <Kpi label="Monthly average" value={usd(avgFull)} footer={`${finished.length} full month${finished.length === 1 ? "" : "s"} · total ${usd(totalFull)}`} />
      </KpiGrid>
      <Card>
        <CardHeader title="12-month history" description="Monthly AWS bill · hover a month for the change" actions={
          <div className="flex flex-wrap gap-1.5">
            <Badge size="md" className="text-fg-2">Average {usd(avgFull)} a month</Badge>
            {latestIsRunning && <Badge size="md" className="text-fg-2">{full[full.length - 1]} so far {usd(latest)}</Badge>}
            {mom != null && <Badge size="md" tone={mom <= 0 ? "var(--success)" : "var(--danger)"}>Latest {usd(latest)} · {mom <= 0 ? "−" : "+"}{Math.abs(mom).toFixed(1)}% on the month before</Badge>}
          </div>} />
        <div className="p-5">
          <TimeChart labels={full.map((m) => m.slice(0, 3))} full={full} area height={240} ticks={12} extra={momText} empty="No monthly history yet."
            series={vals.length ? [{ name: "Bill", color: "var(--brand)", values: vals }] : []} />
        </div>
      </Card>
      <div className="flex flex-wrap items-start gap-4">
        <Card className="min-w-0 flex-[2_1_560px] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Services</h3>
              <div className="mt-[3px] text-[13px] text-muted-foreground tnum">{rows.length} of {services.length} line items · {usd(shown)} shown</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented value={tab} onChange={setTab} aria-label="Line item type" options={[
                { value: "all", label: "All", count: services.length },
                { value: "charges", label: "Charges", count: positive },
                { value: "credits", label: "Credits", count: credits },
              ]} />
              <SearchInput wrapperClassName="w-[220px] max-w-full" placeholder="Filter services…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              <div className="grid h-[38px] items-center gap-4 border-0 border-y border-solid border-border bg-card-2 px-5 text-[12px] font-medium text-muted-foreground" style={{ gridTemplateColumns: COLS }}>
                <span>Service</span><span>Share</span><span className="text-right">Of bill</span><span className="text-right">Cost</span>
              </div>
              {rows.map((r) => (
                <div key={r.key} className={cn("grid min-h-[42px] items-center gap-4 border-0 border-b border-solid border-border px-5 text-[13px] hover:bg-hover", isZero(r.amount) && "opacity-55")} style={{ gridTemplateColumns: COLS }}>
                  <span className="truncate" title={r.key}>{shortService(r.key)}</span>
                  <ShareBar pct={isZero(r.amount) ? 0 : Math.max(0.8, (Math.abs(r.amount) / maxAbs) * 100)} />
                  <span className="text-right text-[12.5px] text-muted-foreground tnum">
                    {isZero(r.amount) || data.total === 0 ? "—" : (r.amount / data.total) * 100 < 0.1 && r.amount > 0 ? "<0.1%" : `${((r.amount / data.total) * 100).toFixed(1)}%`}
                  </span>
                  <span className="text-right font-medium tnum">{usd(r.amount)}</span>
                </div>
              ))}
              {rows.length === 0 && (
                <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">
                  {tab === "credits" && !q.trim() ? "No credits or refunds this period." : `No services match “${q}”.`}
                </div>
              )}
              <div className="grid h-[46px] items-center gap-4 px-5 text-[13px] font-semibold" style={{ gridTemplateColumns: COLS }}>
                <span>Total shown</span><span /><span /><span className="text-right tnum">{usd(shown)}</span>
              </div>
            </div>
          </div>
          <div className="border-0 border-t border-solid border-border px-5 pb-4 pt-3 text-[12.5px] leading-[1.5] text-muted-foreground">
            Negative amounts are credits/refunds. With no filters this matches the AWS Billing console “Bills” page for the same period.
          </div>
        </Card>
        <Card className="min-w-0 flex-[1_1_300px]">
          <CardHeader title="By charge type" description="Adds up to the net total" className="pb-2 pt-4" />
          <div className="flex flex-col px-5 pb-4 pt-1 text-[13px]">
            {data.byRecordType.map((r) => (
              <div key={r.key} className={cn("flex justify-between gap-3 border-0 border-b border-solid border-border py-2.5", isZero(r.amount) && "text-muted-foreground")}>
                <span title={r.key}>{recordLabel(r.key)}</span>
                <span className={cn("tnum", !isZero(r.amount) && "font-medium", r.amount <= -0.005 && "text-success")}>{usd(r.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between gap-3 pb-0.5 pt-3.5 text-[14px] font-semibold"><span>Net total</span><span className="tnum">{usd(data.recordTotal)}</span></div>
          </div>
        </Card>
      </div>
    </Screen>
  );
}
