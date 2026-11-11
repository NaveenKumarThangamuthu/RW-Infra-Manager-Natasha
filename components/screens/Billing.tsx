"use client";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { TimeChart } from "@/components/natasha/charts";
import { MONTHS_SHORT, monthLabel, usd } from "@/components/natasha/format";
import { MonthPicker } from "@/components/natasha/MonthPicker";
import { ErrorNote, Kpi, KpiGrid, PageHeader, Delta, Screen, ScreenSkeleton, ShareBar } from "@/components/natasha/primitives";
import { useOnRefreshed, useShell } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { useMonthParam, withMonth } from "@/components/useMonth";
import { downloadCsv, toCsv } from "@/components/csv";
import { cn } from "@/lib/utils";

interface CostItem { key: string; amount: number; unit: string }
interface BillResp { range: { Start: string; End: string }; total: number; recordTotal: number; services: CostItem[]; byRecordType: CostItem[] }
interface MonthlyResp { series: Array<{ month: string; amount: number }> }
type BillTab = "all" | "charges" | "credits";

const COLS = "minmax(220px,1.6fr) minmax(120px,1fr) 64px 96px";

function periodLabel(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const mon = MONTHS_SHORT[s.getUTCMonth()];
  return s.getUTCMonth() === e.getUTCMonth() ? `${mon} ${s.getUTCDate()} – ${e.getUTCDate()}` : `${mon} ${s.getUTCDate()} – ${MONTHS_SHORT[e.getUTCMonth()]} ${e.getUTCDate()}`;
}

export default function Billing() {
  const month = useMonthParam();
  const { toast } = useShell();
  const { data, error, reload } = useJson<BillResp>(withMonth("/api/cost/bill", month));
  const { data: monthly, reload: reloadMonthly } = useJson<MonthlyResp>("/api/cost/monthly-total");
  useOnRefreshed(() => { reload(); reloadMonthly(); });
  const [tab, setTab] = useState<BillTab>("all");
  const [q, setQ] = useState("");

  const services = useMemo(() => data?.services ?? [], [data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return services.filter((s) => (tab === "charges" ? s.amount > 0 : tab === "credits" ? s.amount < 0 : true) && (!needle || s.key.toLowerCase().includes(needle)));
  }, [services, tab, q]);

  const header = (
    <PageHeader maxWidth={720} title="Billing" description="Every service line for the month plus the record-type breakdown — the complete bill, nothing truncated."
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

  const history = monthly?.series ?? [];
  const vals = history.map((p) => p.amount);
  const full = history.map((p) => monthLabel(p.month));
  const total12 = vals.reduce((a, b) => a + b, 0);
  const avg12 = vals.length ? total12 / vals.length : 0;
  const prevVal = vals.length >= 2 ? vals[vals.length - 2] : 0;
  const latest = vals[vals.length - 1] ?? 0;
  const mom = prevVal > 0 ? ((latest - prevVal) / prevVal) * 100 : null;
  const billDelta = prevVal > 0 ? ((data.total - prevVal) / prevVal) * 100 : null;
  const charged = services.filter((s) => s.amount !== 0).length;
  const credits = services.filter((s) => s.amount < 0).length;
  const positive = services.filter((s) => s.amount > 0).length;
  const maxAbs = Math.max(1e-9, ...rows.map((r) => Math.abs(r.amount)));
  const shown = rows.reduce((a, r) => a + r.amount, 0);
  const momText = (i: number) => {
    if (i === 0 || vals[i - 1] === 0) return "First month in range";
    const p = ((vals[i] - vals[i - 1]) / vals[i - 1]) * 100;
    return `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}% vs ${full[i - 1]}`;
  };

  return (
    <Screen label="Billing">
      {header}
      <KpiGrid>
        <Kpi label="Total bill" value={usd(data.total)} badge={billDelta != null && <Delta pct={billDelta} />}
          footer={prevVal > 0 ? `vs ${full[full.length - 2]} · ${usd(prevVal)}` : " "} />
        <Kpi label="Service line items" value={services.length} footer={`${charged} with charges · ${services.length - charged} at $0.00`} />
        <Kpi label="Billing period" value={periodLabel(data.range.Start, data.range.End)}
          footer={<span className="font-mono">{data.range.Start} → {data.range.End}</span>} />
        <Kpi label="12-month average" value={usd(avg12)} footer={`Total ${usd(total12)} · per month`} />
      </KpiGrid>
      <Card>
        <CardHeader title="12-month history" description="Monthly AWS bill · hover a month for the change" actions={
          <div className="flex flex-wrap gap-1.5">
            <Badge size="md" className="text-fg-2">Total {usd(total12)}</Badge>
            <Badge size="md" className="text-fg-2">Avg {usd(avg12)}/mo</Badge>
            {mom != null && <Badge size="md" tone={mom <= 0 ? "var(--success)" : "var(--danger)"}>Latest {usd(latest)} · {mom <= 0 ? "−" : "+"}{Math.abs(mom).toFixed(1)}% MoM</Badge>}
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
                <div key={r.key} className={cn("grid min-h-[42px] items-center gap-4 border-0 border-b border-solid border-border px-5 text-[13px] hover:bg-hover", r.amount === 0 && "opacity-55")} style={{ gridTemplateColumns: COLS }}>
                  <span className="truncate">{r.key}</span>
                  <ShareBar pct={r.amount === 0 ? 0 : Math.max(0.8, (Math.abs(r.amount) / maxAbs) * 100)} />
                  <span className="text-right text-[12.5px] text-muted-foreground tnum">
                    {r.amount === 0 || data.total === 0 ? "—" : (r.amount / data.total) * 100 < 0.1 && r.amount > 0 ? "<0.1%" : `${((r.amount / data.total) * 100).toFixed(1)}%`}
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
          <CardHeader title="By record type" description="Reconciles to the net total" className="pb-2 pt-4" />
          <div className="flex flex-col px-5 pb-4 pt-1 text-[13px]">
            {data.byRecordType.map((r) => (
              <div key={r.key} className={cn("flex justify-between gap-3 border-0 border-b border-solid border-border py-2.5", r.amount === 0 && "text-muted-foreground")}>
                <span>{r.key}</span>
                <span className={cn("tnum", r.amount !== 0 && "font-medium", r.amount < 0 && "text-success")}>{usd(r.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between gap-3 pb-0.5 pt-3.5 text-[14px] font-semibold"><span>Net total</span><span className="tnum">{usd(data.recordTotal)}</span></div>
          </div>
        </Card>
      </div>
    </Screen>
  );
}
