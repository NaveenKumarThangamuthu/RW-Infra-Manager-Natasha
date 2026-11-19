"use client";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ago, istDateTime, num } from "@/components/natasha/format";
import { Dot, EmptyState, ErrorNote, Skeleton } from "@/components/natasha/primitives";
import { useJson } from "@/components/useJson";
import { KIND_COLOR, KIND_HINT, RANGE_LABEL, type KindResult, type Range, type SampleTarget, type SamplesResp } from "./types";

const LEVEL_COLOR: Record<string, string> = { ERROR: "var(--danger)", WARN: "var(--warning)", INFO: "var(--info)" };

function Body({ target, range }: { target: SampleTarget; range: Range }) {
  const qs = new URLSearchParams({ kind: target.kind, range });
  if (target.service) qs.set("service", target.service);
  const { data, error, reload } = useJson<SamplesResp>(`/api/slow-queries/samples?${qs.toString()}`);

  if (error) return <div className="p-5"><ErrorNote message={error} onRetry={reload} /></div>;
  if (!data) {
    return (
      <div className="flex flex-col gap-3 p-5" aria-busy="true">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px]" />)}
      </div>
    );
  }
  if (!data.entries.length) return <EmptyState title="No lines in this window">Nothing matched in the {RANGE_LABEL[range]}.</EmptyState>;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 p-5">
        {data.entries.map((e, i) => (
          <div key={i} className="rounded-[10px] border border-solid border-border bg-card-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-0 border-b border-solid border-border px-3 py-2 text-[12px]">
              {e.level && <span className="font-semibold" style={{ color: LEVEL_COLOR[e.level] ?? "var(--muted-fg)" }}>{e.level}</span>}
              {/* A re-shipped line keeps its original (server clock) time; everything else shows when it arrived, in IST. */}
              <span className="font-mono text-fg-2" title={e.loggedAt ? `Logged ${e.loggedAt} on the server clock` : undefined}>{e.reingested && e.loggedAt ? `${e.loggedAt} server time` : e.at ? istDateTime(e.at) : e.loggedAt ?? "—"}</span>
              {e.reingested && <Badge size="xs" tone="var(--warning)" title={`Arrived in the log store ${ago(e.at)}, long after it was logged`}>re-sent</Badge>}
              <span className="ml-auto truncate font-mono text-muted-foreground">{e.service}{e.host ? ` · ${e.host}` : ""}</span>
            </div>
            {e.logger && <div className="truncate px-3 pt-2 font-mono text-[11.5px] text-muted-foreground">{e.logger}</div>}
            <div className="whitespace-pre-wrap break-words px-3 pb-2.5 pt-1.5 font-mono text-[12px] leading-[1.6] text-fg-2">{e.message}</div>
          </div>
        ))}
      </div>
      <div className="mt-auto border-0 border-t border-solid border-border px-5 py-3 text-[12.5px] text-muted-foreground tnum">
        Newest {data.entries.length} of {num(data.total)} lines · emails, IPs, quoted values and DTO dumps removed
      </div>
    </div>
  );
}

export function SampleSheet({ target, range, kinds, onClose }: {
  target: SampleTarget | null; range: Range; kinds: KindResult[]; onClose: () => void;
}) {
  const meta = target ? kinds.find((k) => k.key === target.kind) : null;
  return (
    <Sheet open={!!target} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-[min(640px,calc(100vw-16px))]">
        {target && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-border px-4 py-3.5">
              <Dot color={KIND_COLOR[target.kind]} size={8} />
              <SheetTitle className="m-0 text-[15px] font-semibold">{meta?.label ?? target.kind}</SheetTitle>
              <Badge>{range}</Badge>
              {target.service && <Badge className="font-mono text-fg-2">{target.service}</Badge>}
              <SheetClose title="Close" className="ml-auto inline-grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-[8px] border-none bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground"><X size={16} className="block" /></SheetClose>
            </div>
            <div className="border-0 border-b border-solid border-border px-5 py-2.5 text-[12.5px] text-muted-foreground">
              Sample log lines{KIND_HINT[target.kind] ? ` · ${KIND_HINT[target.kind]}` : ""}
            </div>
            <Body key={`${target.kind}:${target.service ?? ""}:${range}`} target={target} range={range} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
