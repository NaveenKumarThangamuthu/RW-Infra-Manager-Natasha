"use client";
import { Suspense, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { CheckButton } from "@/components/natasha/CheckButton";
import { shortService, usd } from "@/components/natasha/format";
import { MonthPicker } from "@/components/natasha/MonthPicker";
import { ErrorNote, Kpi, KpiGrid, PageHeader, Screen, ScreenSkeleton } from "@/components/natasha/primitives";
import { useOnRefreshed } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { useMonthParam, withMonth } from "@/components/useMonth";
import { cn, tint } from "@/lib/utils";

interface RegionEntry { region: string; total: number; services: Array<{ service: string; cost: number }> }
interface RegionsResp { range: { Start: string; End: string }; total: number; regions: RegionEntry[] }

const TOP_COLS = 8;
const HEAT_GRID = `130px repeat(${TOP_COLS},minmax(96px,1fr))`;
const GROUP_GRID = "16px minmax(180px,1.4fr) minmax(100px,1fr) 56px 90px";
const EMPTY_CELL = "color-mix(in oklab, var(--fg) 2.5%, transparent)";

function Inner() {
  const month = useMonthParam();
  const { data, error, reload } = useJson<RegionsResp>(withMonth("/api/cost/regions", month));
  useOnRefreshed(reload);
  const [all, setAll] = useState(false);
  const [zeros, setZeros] = useState(false);
  const [q, setQ] = useState("");
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const regions = useMemo(() => [...(data?.regions ?? [])].sort((a, b) => b.total - a.total), [data]);
  const svcTotals = useMemo(() => {
    const m = new Map<string, { total: number; regions: number }>();
    for (const r of regions) for (const s of r.services) {
      const e = m.get(s.service) ?? { total: 0, regions: 0 };
      e.total += s.cost;
      if (s.cost > 0) e.regions++;
      m.set(s.service, e);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].total - a[1].total);
  }, [regions]);

  const header = (
    <PageHeader title="Regions" description="Region × service cost matrix — see where your bill concentrates geographically." actions={<MonthPicker />} />
  );
  if (error) return <Screen label="Regions">{header}<ErrorNote message={error} onRetry={reload} /></Screen>;
  if (!data) return <ScreenSkeleton />;

  const total = data.total;
  const cols = svcTotals.slice(0, TOP_COLS).map(([name]) => name);
  const cost = (r: RegionEntry, svc: string) => r.services.find((s) => s.service === svc)?.cost ?? null;
  const heatMax = Math.max(0.0001, ...regions.flatMap((r) => cols.map((c) => cost(r, c) ?? 0)));
  const withSpend = regions.filter((r) => cols.some((c) => (cost(r, c) ?? 0) > 0));
  const heatRows = all ? regions : withSpend;
  const spending = regions.filter((r) => r.total > 0).length;
  const top = regions[0];
  const topSvc = svcTotals[0];
  const needle = q.trim().toLowerCase();
  // Regions above 25% of the bill start open; the rest start collapsed so the long tail stays out of the way.
  const isOpen = (r: RegionEntry) => (toggled[r.region] ?? (total > 0 && r.total / total >= 0.25));
  const groups = regions.filter((r) => zeros || r.total > 0);
  const maxItem = Math.max(0.0001, ...regions.flatMap((r) => r.services.map((s) => s.cost)));

  return (
    <Screen label="Regions">
      {header}
      <KpiGrid>
        <Kpi label="Month-to-date" value={usd(total)} footer={`Across ${regions.length} regions`} />
        <Kpi label="Top region" value={<span className="font-mono text-[26px] tracking-[-0.02em]">{top?.region ?? "—"}</span>}
          footer={top && <span className="tnum">{usd(top.total)} · {total > 0 ? ((top.total / total) * 100).toFixed(1) : "0.0"}% of the bill</span>} />
        <Kpi label="Top service" value={topSvc ? shortService(topSvc[0]) : "—"} footer={topSvc && <span className="tnum">{usd(topSvc[1].total)} across {topSvc[1].regions} region{topSvc[1].regions === 1 ? "" : "s"}</span>} />
        <Kpi label="Regions with spend" value={<>{spending}<span className="text-[15px] font-medium tracking-normal text-muted-foreground"> / {regions.length}</span></>} footer={`${regions.length - spending} regions at $0.00`} />
      </KpiGrid>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3.5 pt-[18px]">
          <div>
            <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Region × service heatmap</h3>
            <div className="mt-[3px] text-[13px] text-muted-foreground tnum">
              {all ? `${regions.length} regions · top ${cols.length} services · ${usd(total)} MTD` : `Showing ${heatRows.length} of ${regions.length} regions with top-${cols.length} spend · ${usd(total)} MTD`}
            </div>
          </div>
          <CheckButton on={all} onClick={() => setAll((v) => !v)}>Show all {regions.length} regions</CheckButton>
        </div>
        <div className="overflow-x-auto px-5 pb-1">
          <div className="flex min-w-[980px] flex-col gap-[3px]">
            <div className="grid items-end gap-[3px] pb-1.5 text-[12px] font-medium text-muted-foreground" style={{ gridTemplateColumns: HEAT_GRID }}>
              <span>Region</span>
              {cols.map((c) => <span key={c} title={c} className="truncate px-2.5 text-right">{shortService(c)}</span>)}
            </div>
            {heatRows.map((r) => (
              <div key={r.region} className="grid items-stretch gap-[3px]" style={{ gridTemplateColumns: HEAT_GRID }}>
                <span className="flex items-center font-mono text-[12.5px] font-medium">{r.region}</span>
                {cols.map((c) => {
                  const v = cost(r, c);
                  return (
                    <span key={c} className="flex h-[38px] items-center justify-end rounded-[6px] px-2.5 text-[12.5px] font-medium tnum"
                      style={{
                        background: v != null && v > 0 ? tint("var(--brand)", Math.round(8 + 62 * Math.sqrt(v / heatMax))) : EMPTY_CELL,
                        color: v == null ? "var(--subtle-fg)" : v > 0 ? "var(--fg)" : "var(--muted-fg)",
                      }}>{v == null ? "—" : usd(v)}</span>
                  );
                })}
              </div>
            ))}
            <div className="mt-1.5 grid items-center gap-[3px] border-0 border-t border-solid border-border pt-2.5 text-[12.5px] font-semibold" style={{ gridTemplateColumns: HEAT_GRID }}>
              <span className="text-[12px] font-medium text-muted-foreground">Column total</span>
              {cols.map((c) => <span key={c} className="px-2.5 text-right tnum">{usd(regions.reduce((a, r) => a + (cost(r, c) ?? 0), 0))}</span>)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-5 pb-4 pt-3 text-[12px] text-muted-foreground">
          Low
          <span className="flex gap-[3px]">{[10, 24, 38, 54, 70].map((p) => <span key={p} className="h-2.5 w-[22px] rounded-[3px]" style={{ background: tint("var(--brand)", p) }} />)}</span>
          High concentration
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Region × service breakdown</h3>
            <div className="mt-[3px] text-[13px] text-muted-foreground">Month-to-date · share of the {usd(total)} bill · click a region to collapse it</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CheckButton on={zeros} onClick={() => setZeros((v) => !v)}>Include $0.00</CheckButton>
            <SearchInput wrapperClassName="w-[220px] max-w-full" placeholder="Service name…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="-mb-px overflow-x-auto">
          <div className="min-w-[560px]">
            {groups.map((g) => {
              const open = isOpen(g);
              const items = g.services.filter((x) => (zeros || x.cost > 0) && (!needle || x.service.toLowerCase().includes(needle))).sort((a, b) => b.cost - a.cost);
              const hidden = g.services.length - items.length;
              return (
                <div key={g.region}>
                  <button type="button" aria-expanded={open} onClick={() => setToggled((t) => ({ ...t, [g.region]: !open }))}
                    className="grid min-h-[46px] w-full cursor-pointer items-center gap-3.5 border-0 border-t border-solid border-border bg-card-2 px-5 text-left text-foreground hover:bg-hover" style={{ gridTemplateColumns: GROUP_GRID }}>
                    <span className={cn("grid place-items-center text-muted-foreground transition-transform duration-150", open && "rotate-90")}><ChevronRight size={14} className="block" /></span>
                    <span className="font-mono text-[13px] font-semibold">{g.region}</span>
                    <span className="block h-1.5 overflow-hidden rounded-[6px] bg-card"><span className="block h-full rounded-[6px] bg-brand" style={{ width: `${total > 0 ? Math.max(g.total > 0 ? 0.6 : 0, (g.total / total) * 100) : 0}%` }} /></span>
                    <span className="text-right text-[12px] text-muted-foreground tnum">{total > 0 ? ((g.total / total) * 100).toFixed(1) : "0.0"}%</span>
                    <span className="text-right text-[13.5px] font-semibold tnum">{usd(g.total)}</span>
                  </button>
                  {open && items.map((x) => (
                    <div key={x.service} className={cn("grid min-h-10 items-center gap-3.5 border-0 border-t border-solid border-border px-5 text-[13px] hover:bg-hover", !x.cost && "opacity-50")} style={{ gridTemplateColumns: GROUP_GRID }}>
                      <span />
                      <span className="min-w-0 truncate">{x.service}</span>
                      <span className="block h-[5px] overflow-hidden rounded-[5px] bg-card-2"><span className="block h-full rounded-[5px]" style={{ width: `${x.cost > 0 ? Math.max(0.6, (x.cost / maxItem) * 100) : 0}%`, background: tint("var(--brand)", 70) }} /></span>
                      <span className="text-right text-[12px] text-muted-foreground tnum">{x.cost > 0 && total > 0 ? ((x.cost / total) * 100 < 0.1 ? "<0.1%" : `${((x.cost / total) * 100).toFixed(1)}%`) : "—"}</span>
                      <span className="text-right font-medium tnum">{usd(x.cost)}</span>
                    </div>
                  ))}
                  {open && (items.length === 0 || (!zeros && hidden > 0 && !needle)) && (
                    <div className="border-0 border-t border-solid border-border py-3 pl-[50px] pr-5 text-[12.5px] text-muted-foreground">
                      {items.length === 0 ? (needle ? `No services match “${q}”.` : `All ${g.services.length} services are at $0.00.`) : `${hidden} more service${hidden === 1 ? "" : "s"} at $0.00`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </Screen>
  );
}

export default function Regions() {
  return <Suspense fallback={<ScreenSkeleton />}><Inner /></Suspense>;
}
