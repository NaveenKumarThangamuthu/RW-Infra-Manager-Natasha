"use client";
import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { num } from "@/components/natasha/format";
import { EmptyState, HeadRow, ShareBar } from "@/components/natasha/primitives";
import { cn } from "@/lib/utils";
import { dur, istParts, type SlowLogOk, type SlowShape } from "./types";

const IDX_COLS = "minmax(200px,1.6fr) 80px minmax(120px,1fr) 80px 80px";
const PAT_COLS = "minmax(160px,1fr) minmax(280px,2.4fr) 80px 76px 76px minmax(120px,0.9fr)";
const SLOW_COLS = "136px minmax(180px,1.6fr) 76px minmax(110px,1fr) 64px";
const ROW = "grid items-center gap-3.5 border-0 border-b border-solid border-border px-5 py-3 text-[13px]";
const LEVEL_COLOR: Record<string, string> = { WARN: "var(--warning)", INFO: "var(--info)", DEBUG: "var(--muted-fg)" };
const FLAG_COLOR: Record<string, string> = { "deep paging": "var(--danger)", "heavy aggregation": "var(--orange)", script: "var(--orange)" };

function Scroll({ min, children }: { min: number; children: ReactNode }) {
  return <div className="overflow-x-auto"><div style={{ minWidth: min }}>{children}</div></div>;
}
/** "10000+ hits" → "10,000+ hits" */
const hits = (s: string | null) => (s ? s.replace(/\d{4,}/g, (d) => num(Number(d))) : "—");
const istTime = (iso: string) => { const p = istParts(new Date(iso).getTime()); return `${p.dd}, ${p.hm}`; };

function PatternSheet({ shape, onClose }: { shape: SlowShape | null; onClose: () => void }) {
  return (
    <Sheet open={!!shape} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-[min(640px,calc(100vw-16px))]">
        {shape && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-border px-4 py-3.5">
              <SheetTitle className="m-0 text-[15px] font-semibold">Query pattern</SheetTitle>
              <Badge className="font-mono text-fg-2">{shape.index}</Badge>
              <SheetClose title="Close" className="ml-auto inline-grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-[8px] border-none bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground"><X size={16} className="block" /></SheetClose>
            </div>
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5 text-[12.5px]">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground tnum">
                <span>{num(shape.count)} in sample</span><span>median {dur(shape.medianMs)}</span><span>slowest {dur(shape.maxMs)}</span>
                {shape.sizes.length > 0 && <span>size {shape.sizes.join(", ")}</span>}
                {shape.froms.length > 0 && <span>from {shape.froms.join(", ")}</span>}
                <span>last {istTime(shape.lastSeen)} IST</span>
              </div>
              {shape.flags.length > 0 && <div className="flex flex-wrap gap-1.5">{shape.flags.map((f) => <Badge key={f} size="xs" tone={FLAG_COLOR[f] ?? "var(--warning)"}>{f}</Badge>)}</div>}
              <div className="text-muted-foreground">One example with every value replaced by ?:</div>
              <pre className="m-0 whitespace-pre-wrap break-all rounded-[10px] border border-solid border-border bg-card-2 p-3 font-mono text-[11.5px] leading-[1.6] text-fg-2">{pretty(shape.example)}</pre>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function pretty(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

export function SlowLogTables({ d }: { d: SlowLogOk }) {
  const [open, setOpen] = useState<SlowShape | null>(null);
  const anySampled = d.byIndex.some((b) => b.sampled);
  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="pb-3" title="By index" description={anySampled ? "Counts are exact. Timings marked * come from the slowest sampled searches." : "Exact counts and timings for the window."} />
        <Scroll min={620}>
          <HeadRow columns={IDX_COLS}><span>Index</span><span className="text-right">Searches</span><span>Share</span><span className="text-right">Slow (p95)</span><span className="text-right">Slowest</span></HeadRow>
          {d.byIndex.map((b) => (
            <div key={b.index} className={ROW} style={{ gridTemplateColumns: IDX_COLS }}>
              <span className="truncate font-mono text-[12.5px]" title={b.index}>{b.index}</span>
              <span className="text-right font-semibold tnum">{num(b.count)}</span>
              <ShareBar pct={d.total ? (b.count / d.total) * 100 : 0} color="var(--warning)" />
              <span className="text-right tnum">{dur(b.p95Ms)}{b.sampled ? "*" : ""}</span>
              <span className="text-right tnum">{dur(b.maxMs)}{b.sampled ? "*" : ""}</span>
            </div>
          ))}
          {!d.byIndex.length && <EmptyState title="No indices" />}
        </Scroll>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-3" title="Query patterns" description={`Grouped from the ${num(d.sampleSize)} slowest searches in this window, values removed. Click a pattern for the full text.`} />
        <Scroll min={980}>
          <HeadRow columns={PAT_COLS}><span>Index</span><span>Pattern</span><span className="text-right">In sample</span><span className="text-right">Median</span><span className="text-right">Slowest</span><span>Flags</span></HeadRow>
          {d.shapes.map((s, i) => (
            <div key={i} role="button" tabIndex={0} onClick={() => setOpen(s)} onKeyDown={(e) => { if (e.key === "Enter") setOpen(s); }}
              className={cn(ROW, "cursor-pointer items-start hover:bg-hover")} style={{ gridTemplateColumns: PAT_COLS }}>
              <span className="truncate font-mono text-[12px]" title={s.index}>{s.index}</span>
              <span className="line-clamp-2 break-all font-mono text-[11.5px] leading-[1.55] text-fg-2" title={s.shape}>{s.shape}</span>
              <span className="text-right font-semibold tnum">{num(s.count)}</span>
              <span className="text-right tnum">{dur(s.medianMs)}</span>
              <span className="text-right tnum">{dur(s.maxMs)}</span>
              <div className="flex min-w-0 flex-wrap gap-1">{s.flags.map((f) => <Badge key={f} size="xs" tone={FLAG_COLOR[f] ?? "var(--warning)"}>{f}</Badge>)}</div>
            </div>
          ))}
          {!d.shapes.length && <EmptyState title="No patterns">No sampled searches could be grouped.</EmptyState>}
        </Scroll>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-3" title="Slowest searches" description={`The ${Math.min(d.slowest.length, 25)} slowest in this window · times in IST`} />
        <Scroll min={600}>
          <HeadRow columns={SLOW_COLS}><span>Time (IST)</span><span>Index</span><span className="text-right">Took</span><span>Hits</span><span>Level</span></HeadRow>
          {d.slowest.map((r, i) => (
            <div key={i} className={ROW} style={{ gridTemplateColumns: SLOW_COLS }} title={r.shape}>
              <span className="tnum text-fg-2">{istTime(r.at)}</span>
              <span className="truncate font-mono text-[12.5px]">{r.index}</span>
              <span className="text-right font-semibold tnum">{dur(r.tookMs)}</span>
              <span className="truncate text-[12.5px] text-fg-2 tnum">{hits(r.totalHits)}</span>
              <span className="text-[12px] font-semibold" style={{ color: LEVEL_COLOR[r.level ?? ""] ?? "var(--muted-fg)" }}>{r.level ?? "—"}</span>
            </div>
          ))}
        </Scroll>
      </Card>
      <PatternSheet shape={open} onClose={() => setOpen(null)} />
    </>
  );
}
