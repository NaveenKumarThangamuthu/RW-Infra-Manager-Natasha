"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Donut, TimeChart } from "@/components/natasha/charts";
import { ago, CATEGORY_META, MONTHS_SHORT, monthLabel, usd } from "@/components/natasha/format";
import { ErrorNote, Skeleton } from "@/components/natasha/primitives";
import { useJson } from "@/components/useJson";
import { useOnRefreshed } from "@/components/shell/ShellContext";
import { cn } from "@/lib/utils";
import type { MonthlyTotalResp } from "./types";

interface DailyByCategoryResp { categories: string[]; series: Array<{ date: string; [k: string]: string | number }>; totals: Record<string, number>; grandTotal: number; since: string }
const RANGES = ["7", "14", "30", "60", "90"] as const;
type Range = (typeof RANGES)[number];

const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

export function CategoryDaily() {
  const [range, setRange] = useState<Range>("30");
  const [off, setOff] = useState<Record<string, boolean>>({ Infra: true, Dev: true, Shared: true, "Not using": true, Other: true });
  const { data, error, reload } = useJson<DailyByCategoryResp>(`/api/cost/daily-by-category?days=${range}`);
  useOnRefreshed(reload);
  const dates = data?.series.map((r) => r.date as string) ?? [];
  const series = CATEGORY_META.filter((c) => !off[c.key]).map((c) => ({
    name: c.key, color: c.color, values: data?.series.map((r) => Number(r[c.key] ?? 0)) ?? [],
  }));
  return (
    <Card>
      <CardHeader title="Daily spend by category" descriptionClassName="tnum"
        description={data ? `${dates.length} days · from ${data.since} · total ${usd(data.grandTotal)}` : "Loading…"}
        actions={<Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r, label: `${r}d` }))} aria-label="Date range" />} />
      <div className="flex flex-wrap gap-1.5 px-5 pt-3.5">
        {CATEGORY_META.map((c) => (
          <button key={c.key} type="button" onClick={() => setOff((o) => ({ ...o, [c.key]: !o[c.key] }))} aria-pressed={!off[c.key]}
            className={cn("inline-flex h-7 cursor-pointer items-center gap-[7px] rounded-[7px] border border-solid border-border px-2.5 text-[12.5px] text-foreground hover:border-border-strong", off[c.key] ? "bg-transparent opacity-50" : "bg-card")}>
            <span className="h-2 w-2 rounded-[2px]" style={{ background: c.color }} />{c.key}
            <span className="text-muted-foreground tnum">{usd(data?.totals[c.key] ?? 0)}</span>
          </button>
        ))}
      </div>
      <div className="px-5 pb-[18px] pt-4">
        {error ? <ErrorNote message={error} onRetry={reload} />
          : !data ? <Skeleton className="h-[284px]" />
            : <TimeChart labels={dates.map(dayLabel)} full={dates.map((d) => new Date(`${d}T00:00:00Z`).toUTCString().slice(0, 16))} series={series} height={260} ticks={8} empty={dates.length ? "Select a category to plot." : "No daily cost history yet."} />}
      </div>
    </Card>
  );
}

interface TagSplitResp { snapshotAt: string | null; buckets: Array<{ category: string; amount: number }>; projectionFactor: number }

export function CostSplit() {
  const router = useRouter();
  const [view, setView] = useState<"14d" | "mo">("14d");
  const { data, error, reload } = useJson<TagSplitResp>("/api/cost/tag-split");
  useOnRefreshed(reload);
  const factor = view === "mo" ? (data?.projectionFactor ?? 1) : 1;
  const segs = CATEGORY_META.map((c) => ({ name: c.key, color: c.color, blurb: c.blurb, v: (data?.buckets.find((b) => b.category === c.key)?.amount ?? 0) * factor }));
  const total = segs.reduce((a, b) => a + Math.max(0, b.v), 0);
  return (
    <Card>
      <CardHeader title="Cost split by category" description={`EC2 spend by tag · snapshot ${ago(data?.snapshotAt)}`}
        actions={<Segmented value={view} onChange={setView} options={[{ value: "14d", label: "Last 14 days" }, { value: "mo", label: "Expected /mo" }]} aria-label="Split period" />} />
      <div className="flex flex-wrap items-center justify-center gap-6 p-5">
        {error ? <div className="w-full"><ErrorNote message={error} onRetry={reload} /></div> : !data ? <Skeleton className="h-[176px] w-full" /> : (
          <>
            <Donut segments={segs} total={total} label={usd(total)} sub={view === "mo" ? "EC2 by tag · expected /mo" : "EC2 by tag · 14 days"} />
            <div className="flex min-w-[240px] flex-1 flex-col">
              {segs.map((s) => (
                <button key={s.name} type="button" onClick={() => router.push(`/tag/${encodeURIComponent(s.name)}`)}
                  className="grid cursor-pointer grid-cols-[10px_minmax(0,1fr)_50px_80px] items-center gap-2.5 rounded-[7px] border-none bg-transparent px-2 py-[7px] text-left text-foreground hover:bg-hover">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{s.name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{s.blurb}</span>
                  </span>
                  <span className="text-right text-[12.5px] text-muted-foreground tnum">{s.v > 0 && total > 0 ? `${((s.v / total) * 100).toFixed(1)}%` : "—"}</span>
                  <span className="text-right text-[13px] font-medium tnum">{usd(s.v)}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

export function MonthlyHistoryCard({ data }: { data: MonthlyTotalResp | null }) {
  const series = data?.series ?? [];
  const vals = useMemo(() => series.map((p) => p.amount), [series]);
  const full = series.map((p) => monthLabel(p.month));
  const mom = (i: number) => {
    if (i === 0 || vals[i - 1] === 0) return "First month in range";
    const p = ((vals[i] - vals[i - 1]) / vals[i - 1]) * 100;
    return `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}% vs ${full[i - 1]}`;
  };
  return (
    <Card>
      <CardHeader title="Total cost · last 12 months" description="Monthly AWS total" />
      <div className="px-5 py-[18px]">
        {data ? <TimeChart labels={full.map((m) => m.slice(0, 3))} full={full} series={[{ name: "Total cost", color: "var(--c20)", values: vals }]} height={200} ticks={6} extra={mom} empty="No monthly history yet." />
          : <Skeleton className="h-[224px]" />}
      </div>
    </Card>
  );
}

interface DtTrendResp { series: Array<{ month: string; public: number; private: number }> }

export function TransferTrendCard() {
  const { data, error, reload } = useJson<DtTrendResp>("/api/cost/datatransfer-trend");
  useOnRefreshed(reload);
  const s = data?.series ?? [];
  const full = s.map((p) => monthLabel(p.month));
  return (
    <Card>
      <CardHeader title="Data transfer · public vs private" description="Last 12 months" actions={
        <div className="flex gap-3 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-cinfra" />Public · egress / IPv4</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-cshared" />Private · intra-AWS / cross-AZ</span>
        </div>} />
      <div className="px-5 py-[18px]">
        {error ? <ErrorNote message={error} onRetry={reload} /> : !data ? <Skeleton className="h-[224px]" /> : (
          <TimeChart labels={full.map((m) => m.slice(0, 3))} full={full} height={200} ticks={6} empty="No data-transfer history yet."
            series={[{ name: "Public", color: "var(--cinfra)", values: s.map((p) => p.public) }, { name: "Private", color: "var(--cshared)", values: s.map((p) => p.private) }]} />
        )}
      </div>
    </Card>
  );
}
