"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Dot, ErrorNote } from "@/components/natasha/primitives";
import { istDateTime, istTime, num } from "@/components/natasha/format";
import { cn, tint } from "@/lib/utils";
import { dedupeEntries, type DetailState, type DetailWindow, type LogDetailsResp } from "./data";

const WINDOWS: DetailWindow[] = ["15m", "1h", "6h", "24h"];

interface LokiEntry { timeMs: number; message: string; severity: string }
interface LokiResp { ok: boolean; count: number; entries: LokiEntry[]; error?: string }
type LokiWindow = "5m" | "15m" | "60m";

const SEV_COLOR: Record<string, string> = { ERROR: "var(--danger)", WARN: "var(--warning)", WARNING: "var(--warning)", INFO: "var(--info)" };

function LiveTail({ serviceName }: { serviceName: string }) {
  const [win, setWin] = useState<LokiWindow>("15m");
  const [data, setData] = useState<LokiResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Loki filename labels are lowercased and dash-separated: "rw-purchasing-service".
  const pattern = serviceName.toLowerCase().replace(/[_\s]/g, "-");
  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const query = `{job="rw_services", filename=~".*/${pattern}/.*"}`;
      const r = await fetch(`/api/loki/query?query=${encodeURIComponent(query)}&limit=200&minutes=${parseInt(win, 10)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the live log");
    } finally {
      setBusy(false);
    }
  }, [pattern, win]);

  useEffect(() => { void load(); }, [load]);
  const entries = data?.entries.slice(0, 100) ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-[10px] border border-solid border-border bg-card px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Dot color={err ? "var(--danger)" : "var(--success)"} size={7} />
        <span className="text-[13px] font-semibold">Live logs</span>
        <span className="text-[12px] text-muted-foreground">Last {win} · times in IST</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Segmented size="xs" value={win} onChange={setWin} className="rounded-[8px] [&>button]:h-[22px] [&>button]:rounded-[5px] [&>button]:px-2"
            options={(["5m", "15m", "60m"] as const).map((k) => ({ value: k, label: k }))} aria-label="Tail window" />
          <button type="button" onClick={() => void load()} title="Refresh tail" className="inline-grid h-7 w-7 cursor-pointer place-items-center rounded-[7px] border border-solid border-border bg-card text-fg-2 hover:bg-hover">
            <RefreshCw size={14} className={cn("block", busy && "animate-nt-spin")} />
          </button>
        </div>
      </div>
      {err && <ErrorNote message={err} />}
      {entries.length > 0 && (
        <div className="flex max-h-[320px] flex-col gap-px overflow-y-auto rounded-[8px] border border-solid border-border bg-border">
          {entries.map((e, i) => (
            <div key={i} className="grid grid-cols-[84px_44px_minmax(0,1fr)] items-baseline gap-2.5 bg-card-2 px-3 py-1.5 font-mono text-[11.5px] leading-[1.55]">
              <span className="text-muted-foreground tnum">{istTime(new Date(e.timeMs))}</span>
              <span className="font-medium" style={{ color: SEV_COLOR[e.severity.toUpperCase()] ?? "var(--muted-fg)" }}>{e.severity.toUpperCase().slice(0, 5)}</span>
              <span className="min-w-0 truncate text-fg-2" title={e.message}>{e.message}</span>
            </div>
          ))}
        </div>
      )}
      {data && !err && entries.length === 0 && (
        <div className="text-[12.5px] leading-[1.5] text-muted-foreground">No live log lines for this service in this window.</div>
      )}
      {!data && !err && <div className="text-[12.5px] text-muted-foreground">Loading tail…</div>}
    </div>
  );
}

export function ServiceDetail({ name, hasElk, detail, window, onWindow }: { name: string; hasElk: boolean; detail: DetailState | undefined; window: DetailWindow; onWindow: (w: DetailWindow) => void }) {
  const loading = hasElk && (!detail || "loading" in detail);
  const failed = detail && "error" in detail ? detail.error : null;
  const resp = detail && "entries" in detail ? (detail as LogDetailsResp) : null;
  const buckets = resp ? dedupeEntries(resp.entries) : [];
  return (
    <div className="flex flex-col gap-3 border-0 border-b border-solid border-border bg-hover pb-5 pl-[54px] pr-5 pt-1.5">
      {!hasElk && (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-solid px-3.5 py-3"
          style={{ borderColor: "color-mix(in oklab, var(--warning) 30%, var(--border))", background: "color-mix(in oklab, var(--warning) 6%, var(--card))" }}>
          <span className="pt-0.5 text-warning"><AlertTriangle size={14} className="block" /></span>
          <div className="min-w-0 text-[13px] leading-[1.55]">
            <div className="font-semibold">No application logs matched to this service</div>
            <div className="mt-0.5 text-fg-2 text-wrap-pretty">Health monitoring reports “{name}”, but the log store has no service with the same name, so error counts are not shown for it. The service may log under a different name or may not be shipping its logs.</div>
          </div>
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] gap-3.5">
        {hasElk && (
          <div className="min-w-0 rounded-[10px] border border-solid border-border bg-card px-4 py-3.5">
            <div className="mb-1 flex flex-wrap items-baseline gap-2">
              <span className="text-[13px] font-semibold">Recent ERROR entries</span>
              <span className="text-[12px] text-muted-foreground">Application logs · grouped by pattern</span>
              <Segmented size="xs" value={window} onChange={onWindow} aria-label="Error window" className="ml-auto rounded-[8px] [&>button]:h-[22px] [&>button]:rounded-[5px] [&>button]:px-2"
                options={WINDOWS.map((w) => ({ value: w, label: w }))} />
            </div>
            {loading && <div className="pb-0.5 pt-3 text-[12.5px] text-muted-foreground">Loading ERROR entries…</div>}
            {failed && <div className="pt-2.5"><ErrorNote message={failed} /></div>}
            {resp && buckets.length === 0 && <div className="pb-0.5 pt-3 text-[12.5px] text-muted-foreground">No ERROR entries in the last {window}.</div>}
            {buckets.slice(0, 12).map((b) => (
              <div key={b.key} className="flex items-start gap-2.5 pb-0.5 pt-2.5">
                <span className="inline-flex h-5 shrink-0 items-center rounded-[5px] px-1.5 text-[11px] font-semibold text-danger tnum" style={{ background: tint("var(--danger)") }}>×{num(b.count)}</span>
                <div className="min-w-0">
                  <div className="break-words font-mono text-[11.5px] leading-[1.6] text-fg-2">{b.sample.message.slice(0, 800)}</div>
                  <div className="mt-1 text-[11.5px] text-muted-foreground">
                    {b.lastAt ? `Last seen ${istDateTime(b.lastAt)}` : "Last seen unknown"}{b.hosts.length ? ` · ${b.hosts.join(" · ")}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <LiveTail serviceName={name} />
      </div>
    </div>
  );
}
