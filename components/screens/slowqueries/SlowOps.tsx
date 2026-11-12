"use client";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { num } from "@/components/natasha/format";
import { EmptyState, HeadRow } from "@/components/natasha/primitives";
import { latencyColor, ms, type LogsResp } from "./types";

const COLS = "minmax(280px,2fr) minmax(200px,1.2fr) 76px 80px 80px 80px";

export function SlowOps({ data }: { data: LogsResp }) {
  const [q, setQ] = useState("");
  const { rows, sampled, error } = data.operations;
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? rows.filter((r) => `${r.operation} ${r.service}`.toLowerCase().includes(needle)) : rows;
  }, [rows, q]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3" title="Timed operations"
        description={error
          ? `Sample unavailable: ${error}`
          : <>Parsed from <span className="font-medium text-fg-2">[TIMING] … took</span> and <span className="font-medium text-fg-2">Duration: … sec</span> log lines. Percentiles are over the sample, not every call.</>}
        actions={<Badge size="md" tone="var(--info)">sampled, {num(sampled)} lines</Badge>} />
      <div className="px-4 pb-3">
        <SearchInput wrapperClassName="max-w-[320px]" placeholder="Search operation or service…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          <HeadRow columns={COLS}>
            <span>Operation</span><span>Service</span><span className="text-right">Samples</span>
            <span className="text-right">p50</span><span className="text-right">p95</span><span className="text-right">Max</span>
          </HeadRow>
          {filtered.map((r) => (
            <div key={`${r.service}|${r.operation}`} className="grid items-center gap-3.5 border-0 border-b border-solid border-border px-5 py-3 text-[13px]" style={{ gridTemplateColumns: COLS }}>
              <span className="break-words font-mono text-[12px]">{r.operation}</span>
              <span className="truncate font-mono text-[12px] text-muted-foreground">{r.service}</span>
              <span className="text-right tnum">{num(r.n)}</span>
              <span className="text-right tnum">{ms(r.p50)}</span>
              <span className="text-right font-semibold tnum" style={{ color: latencyColor(r.p95) }}>{ms(r.p95)}</span>
              <span className="text-right tnum" style={{ color: latencyColor(r.max) }}>{ms(r.max)}</span>
            </div>
          ))}
          {filtered.length === 0 && (rows.length
            ? <EmptyState title="No matches">No operations match this search.</EmptyState>
            : <EmptyState title="No timed operations">No timing lines were found in this window.</EmptyState>)}
        </div>
      </div>
      <div className="px-5 py-3 text-[12.5px] text-muted-foreground">Sorted by p95, slowest first · p95 over 1 s is amber, over 3 s red</div>
    </Card>
  );
}
