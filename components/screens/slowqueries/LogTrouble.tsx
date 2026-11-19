"use client";
import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { TimeChart } from "@/components/natasha/charts";
import { ago, compact, istDateTime, num } from "@/components/natasha/format";
import { Dot, EmptyState, HeadRow, ShareBar } from "@/components/natasha/primitives";
import { cn, tint } from "@/lib/utils";
import { istLabels, KIND_COLOR, KIND_HINT, STATEMENT_KIND, type Kind, type LogsResp, type SampleTarget } from "./types";

const KIND_COLS = "minmax(220px,1.4fr) 84px minmax(120px,1fr) minmax(180px,1fr) 16px";
const SVC_COLS = "minmax(220px,1.2fr) 84px minmax(240px,1.6fr) 16px";
const STMT_COLS = "minmax(320px,2.2fr) minmax(140px,1fr) minmax(180px,1.2fr) 70px minmax(150px,1fr) 80px";
const TGT_COLS = "64px minmax(240px,1fr) 70px minmax(180px,1fr)";
const ROW = "grid items-center gap-3.5 border-0 border-b border-solid border-border px-5 py-3 text-[13px]";

function Scroll({ min, children }: { min: number; children: React.ReactNode }) {
  return <div className="overflow-x-auto"><div style={{ minWidth: min }}>{children}</div></div>;
}

function PartialBadge({ error }: { error?: string }) {
  return <Badge size="xs" tone="var(--warning)" title={error ?? "The count query timed out; the real number is at least this."}>partial</Badge>;
}

export function LogTrouble({ data, onOpen }: { data: LogsResp; onOpen: (t: SampleTarget) => void }) {
  const { labels, full } = useMemo(() => istLabels(data.buckets), [data.buckets]);
  const grand = data.kinds.reduce((n, k) => n + k.total, 0);
  const withLines = data.kinds.filter((k) => k.total > 0);
  // On one linear axis a kind under 1% of the largest is a flat line at zero, so it is listed instead of drawn.
  const largest = Math.max(0, ...withLines.map((k) => k.total));
  const plotted = withLines.filter((k) => k.total >= largest * 0.01);
  const tooSmall = withLines.filter((k) => k.total < largest * 0.01);
  const label = (k: Kind) => data.kinds.find((x) => x.key === k)?.label ?? k;

  const services = useMemo(() => {
    const m = new Map<string, { service: string; total: number; kinds: Array<{ key: Kind; count: number }> }>();
    for (const k of data.kinds) {
      for (const s of k.services) {
        const row = m.get(s.service) ?? { service: s.service, total: 0, kinds: [] };
        row.total += s.count;
        row.kinds.push({ key: k.key, count: s.count });
        m.set(s.service, row);
      }
    }
    return Array.from(m.values()).map((r) => ({ ...r, kinds: r.kinds.sort((a, b) => b.count - a.count) })).sort((a, b) => b.total - a.total);
  }, [data.kinds]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="pb-4">
        <CardHeader title="Trouble over time" description={`Matching log lines per ${data.range === "1h" ? "5 minutes" : data.range === "6h" ? "30 minutes" : "hour"} · times in IST`} />
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-5 pb-3 pt-3 text-[12px] text-muted-foreground">
          {plotted.map((k) => <span key={k.key} className="inline-flex items-center gap-1.5"><Dot color={KIND_COLOR[k.key]} size={8} />{k.label}</span>)}
        </div>
        <div className="px-4">
          <TimeChart labels={labels} full={full} height={200} area strokeWidth={1.75} fmt={num} axisFmt={compact} axisWidth={40} ticks={6} smooth={false}
            empty="No matching lines in this window." series={plotted.map((k) => ({ name: k.label, color: KIND_COLOR[k.key], values: k.trend }))} />
        </div>
        {tooSmall.length > 0 && (
          <div className="px-5 pt-3 text-[12px] text-muted-foreground">
            Too small to draw at this scale (under 1% of the largest): {tooSmall.map((k) => `${k.label} ${num(k.total)}`).join(" · ")}. Their counts are in the table below.
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-3" title="By kind" description="Exact counts for the window. Click a row for sample lines." />
        <Scroll min={700}>
          <HeadRow columns={KIND_COLS}><span>Kind</span><span className="text-right">Lines</span><span>Share</span><span>Top service</span><span /></HeadRow>
          {data.kinds.map((k) => {
            const top = k.services[0];
            return (
              <div key={k.key} role="button" tabIndex={0} onClick={() => onOpen({ kind: k.key, service: null })} onKeyDown={(e) => { if (e.key === "Enter") onOpen({ kind: k.key, service: null }); }}
                className={cn(ROW, "cursor-pointer hover:bg-hover", !k.total && !k.partial && "text-muted-foreground")} style={{ gridTemplateColumns: KIND_COLS }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><Dot color={KIND_COLOR[k.key]} size={8} /><span className="font-medium">{k.label}</span>{k.partial && <PartialBadge error={k.error} />}</div>
                  {KIND_HINT[k.key] && <div className="mt-0.5 pl-4 text-[12px] text-muted-foreground">{KIND_HINT[k.key]}</div>}
                </div>
                <span className="text-right font-semibold tnum">{k.total ? num(k.total) : "0"}</span>
                <ShareBar pct={grand ? (k.total / grand) * 100 : 0} color={KIND_COLOR[k.key]} />
                <span className="truncate font-mono text-[12px] text-fg-2">{top ? `${top.service} · ${num(top.count)}` : "—"}</span>
                <span className="text-subtle"><ChevronRight size={14} className="block" /></span>
              </div>
            );
          })}
        </Scroll>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-3" title="By service" description="Lines per service across all kinds (top 12 services per kind)." />
        <Scroll min={640}>
          <HeadRow columns={SVC_COLS}><span>Service</span><span className="text-right">Lines</span><span>Kinds</span><span /></HeadRow>
          {services.map((s) => (
            <div key={s.service} role="button" tabIndex={0} onClick={() => onOpen({ kind: s.kinds[0].key, service: s.service })} onKeyDown={(e) => { if (e.key === "Enter") onOpen({ kind: s.kinds[0].key, service: s.service }); }}
              className={cn(ROW, "cursor-pointer hover:bg-hover")} style={{ gridTemplateColumns: SVC_COLS }}>
              <span className="truncate font-mono text-[12.5px]">{s.service}</span>
              <span className="text-right font-semibold tnum">{num(s.total)}</span>
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {s.kinds.slice(0, 3).map((k) => <Badge key={k.key} size="xs" tone={KIND_COLOR[k.key]}>{label(k.key)} · {compact(k.count)}</Badge>)}
              </div>
              <span className="text-subtle"><ChevronRight size={14} className="block" /></span>
            </div>
          ))}
          {!services.length && <EmptyState title="No services">No matching lines in this window.</EmptyState>}
        </Scroll>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-3" title="Failed statements"
          description={data.statements.error ? `Sample unavailable: ${data.statements.error}` : `Grouped from the newest ${num(data.statements.sampled)} failed-statement lines (a sample, not totals).`} />
        <Scroll min={1040}>
          <HeadRow columns={STMT_COLS}><span>Statement</span><span>Table</span><span>Reason</span><span className="text-right">In sample</span><span>Services</span><span>Last seen</span></HeadRow>
          {data.statements.groups.map((g, i) => {
            const meta = STATEMENT_KIND[g.kind];
            const target = { kind: meta.kind, service: g.services.length === 1 ? g.services[0] : null };
            return (
              <div key={i} role="button" tabIndex={0} onClick={() => onOpen(target)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(target); }}
                className={cn(ROW, "cursor-pointer items-start hover:bg-hover")} style={{ gridTemplateColumns: STMT_COLS }}>
                <div className="min-w-0">
                  <div className="line-clamp-2 break-all font-mono text-[11.5px] leading-[1.55] text-fg-2" title={g.statement}>{g.statement}</div>
                  <span className="mt-1 inline-flex h-5 items-center rounded-[5px] px-1.5 text-[11px] font-semibold" style={{ color: meta.color, background: tint(meta.color) }}>{meta.label}</span>
                </div>
                <span className="break-all font-mono text-[12px]">{g.table ?? "—"}</span>
                <span className="line-clamp-3 text-[12.5px] text-fg-2" title={g.reason}>{g.reason || "—"}</span>
                <span className="text-right font-semibold tnum">{num(g.count)}</span>
                <span className="break-all font-mono text-[11.5px] text-muted-foreground">{g.services.join(", ")}</span>
                <span className="text-[12.5px] text-muted-foreground" title={g.lastAt ? istDateTime(g.lastAt) : undefined}>{ago(g.lastAt)}</span>
              </div>
            );
          })}
          {!data.statements.groups.length && <EmptyState title="No failed statements">No statements were rejected by MySQL in this window.</EmptyState>}
        </Scroll>
      </Card>

      {data.timeoutTargets.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3" title="Service call timeouts by target" description="From the newest service-call timeout lines (sampled). These are HTTP calls between services." />
          <Scroll min={620}>
            <HeadRow columns={TGT_COLS}><span>Method</span><span>Path</span><span className="text-right">In sample</span><span>Callers</span></HeadRow>
            {data.timeoutTargets.map((t) => (
              <div key={`${t.method} ${t.path}`} className={ROW} style={{ gridTemplateColumns: TGT_COLS }}>
                <Badge size="xs" tone="var(--info)" className="justify-self-start">{t.method}</Badge>
                <span className="break-all font-mono text-[12px]">{t.path}</span>
                <span className="text-right font-semibold tnum">{num(t.count)}</span>
                <span className="break-all font-mono text-[11.5px] text-muted-foreground">{t.services.join(", ")}</span>
              </div>
            ))}
          </Scroll>
        </Card>
      )}
    </div>
  );
}
