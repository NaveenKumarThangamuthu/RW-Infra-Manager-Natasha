"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorNote, HeadRow, Skeleton } from "@/components/natasha/primitives";
import { cn } from "@/lib/utils";
import { analyse, formatNumber, parseCsv } from "./csv";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 1000;
const SESSION_MSG = "Session expired — please sign in again.";

function useCsvText(url: string, skip: boolean) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    if (skip) return undefined;
    setText(null);
    setError(null);
    fetch(url)
      .then(async (r) => {
        if (r.status === 401 || r.redirected) throw new Error(SESSION_MSG);
        if (!r.ok) throw new Error(`Could not load this file (${r.status}).`);
        return r.text();
      })
      .then((t) => alive && setText(t))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [url, tick, skip]);

  return { text, error, reload };
}

export function CsvTable({ url, sizeBytes }: { url: string; sizeBytes: number }) {
  const tooLarge = sizeBytes > MAX_BYTES;
  const { text, error, reload } = useCsvText(url, tooLarge);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const parsed = useMemo(() => (text === null ? null : analyse(parseCsv(text))), [text]);

  const toggle = (i: number) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  if (tooLarge) return <EmptyState title="Too large to preview">Download the file to open it.</EmptyState>;
  if (error) return <div className="p-5"><ErrorNote message={error} onRetry={reload} /></div>;
  if (!parsed) return <div className="flex flex-col gap-2 p-5" aria-busy="true"><Skeleton className="h-[38px]" /><Skeleton className="h-[160px]" /></div>;
  if (parsed.header.length === 0) return <EmptyState title="This file is empty" />;

  const { header, body, numeric, long } = parsed;
  const shown = body.slice(0, MAX_ROWS);
  const columns = ["36px", ...header.map((_, i) => (long[i] ? "minmax(220px,3fr)" : numeric[i] ? "130px" : "minmax(120px,1fr)"))].join(" ");
  // 36px index column + 40px row padding + a 14px gap before each data column.
  const minWidth = 76 + header.reduce((s, _, i) => s + 14 + (long[i] ? 220 : numeric[i] ? 130 : 120), 0);

  return (
    <div>
      <div className="px-5 py-3 text-[12.5px] text-muted-foreground">
        {body.length} rows · {header.length} columns{body.length > MAX_ROWS ? " · showing the first 1,000" : ""}
        {long.some(Boolean) ? " · Select a row to show the full text." : ""}
      </div>
      <div className="overflow-x-auto">
        <div style={{ minWidth }}>
          <HeadRow columns={columns}>
            <span>#</span>
            {header.map((h, i) => <span key={i} className={cn("min-w-0 truncate", numeric[i] && "text-right")} title={h}>{h}</span>)}
          </HeadRow>
          {shown.map((row, r) => (
            <div key={r} className="grid items-start gap-3.5 border-0 border-b border-solid border-border px-5 py-3 text-[13px]" style={{ gridTemplateColumns: columns }}>
              <span className="tnum text-muted-foreground">{r + 1}</span>
              {row.map((cell, c) => {
                if (numeric[c]) return <span key={c} className="tnum text-right" title={cell}>{formatNumber(cell)}</span>;
                if (long[c]) {
                  const expanded = open.has(r);
                  return (
                    <button key={c} type="button" aria-expanded={expanded} onClick={() => toggle(r)}
                      className={cn("m-0 min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left font-mono text-[11.5px] leading-[1.55] text-fg-2 whitespace-pre-wrap break-words", !expanded && "line-clamp-4")}>
                      {cell}
                    </button>
                  );
                }
                return <span key={c} className="min-w-0 break-words">{cell}</span>;
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
