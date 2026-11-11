"use client";
import { useEffect, useMemo, useState } from "react";
import { Copy, Filter, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { num } from "@/components/natasha/format";
import { ErrorNote, PageHeader, Screen } from "@/components/natasha/primitives";
import { useShell } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { cn, tint } from "@/lib/utils";

type Sev = "SEVERE" | "ERROR" | "WARN" | "INFO" | "FINE" | "DEBUG" | "TRACE" | "OTHER";
interface Entry { timeMs: number; message: string; severity: Sev }
interface Resp { count: number; entries: Entry[] }

const LEVELS: Array<[Sev, string]> = [["SEVERE", "var(--danger)"], ["ERROR", "var(--orange)"], ["WARN", "var(--warning)"], ["INFO", "var(--info)"], ["FINE", "var(--c20)"]];
const WINDOWS = { "5m": [5, "5 min"], "15m": [15, "15 min"], "1h": [60, "hour"], "4h": [240, "4 hours"], "24h": [1440, "24 hours"] } as const;
type Win = keyof typeof WINDOWS;
const SEPARATOR = "1px 0 0 var(--border), 0 1px 0 var(--border)";
const REFRESH_SECONDS = 10;
const LOG_LIMIT = 500;
const QUERY = encodeURIComponent('{job="openas2"}');

const colorOf = (s: Sev) => LEVELS.find((l) => l[0] === s)?.[1] ?? "var(--muted-fg)";

export default function OpenAs2() {
  const { toast } = useShell();
  const [win, setWin] = useState<Win>("15m");
  const [level, setLevel] = useState<Sev | "all">("all");
  const [q, setQ] = useState("");
  const [auto, setAuto] = useState(true);
  const [sec, setSec] = useState(REFRESH_SECONDS);
  const { data, error, loading, reload } = useJson<Resp>(`/api/loki/query?query=${QUERY}&limit=${LOG_LIMIT}&minutes=${WINDOWS[win][0]}`);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => {
      setSec((s) => {
        if (s <= 1) { reload(); return REFRESH_SECONDS; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [auto, reload]);

  const entries = useMemo(() => [...(data?.entries ?? [])].sort((a, b) => b.timeMs - a.timeMs), [data]);
  const needle = q.trim().toLowerCase();
  const shown = entries.filter((e) => (level === "all" || e.severity === level) && (!needle || e.message.toLowerCase().includes(needle)));
  const count = (s: Sev) => entries.filter((e) => e.severity === s).length;

  return (
    <Screen label="OpenAS2 EDI">
      <PageHeader title="OpenAS2 · EDI" description={`AS2 EDI live logs via Loki job openas2 · ${num(entries.length)} lines in the last ${WINDOWS[win][1]}`} actions={<>
        <button type="button" aria-pressed={auto} onClick={() => { setAuto((v) => !v); setSec(REFRESH_SECONDS); }}
          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[8px] border border-solid px-3 text-[13px] font-medium text-foreground"
          style={{ borderColor: auto ? "color-mix(in oklab, var(--success) 40%, transparent)" : "var(--border)", background: auto ? tint("var(--success)", 10) : "var(--card)" }}>
          <span className="h-[7px] w-[7px] rounded-[7px]" style={{ background: auto ? "var(--success)" : "var(--muted-fg)" }} />{auto ? `Auto · ${REFRESH_SECONDS}s` : "Paused"}
        </button>
        <Button size="lg" onClick={() => { reload(); setSec(REFRESH_SECONDS); }}><RefreshCw size={14} className={cn("block", loading && "animate-nt-spin")} />Refresh</Button>
        <Button size="lg" onClick={() => {
          void navigator.clipboard?.writeText(shown.map((e) => e.message).join("\n")).catch(() => { /* clipboard blocked */ });
          toast(`Copied ${shown.length} lines`);
        }}><Copy size={14} className="block" />Copy</Button>
      </>} />
      {error && <ErrorNote message={error} onRetry={reload} />}
      <Card className="grid overflow-hidden grid-cols-[repeat(var(--k6,6),minmax(0,1fr))]">
        <LevelButton label="ALL" color="var(--fg-2)" n={entries.length} valueColor="var(--fg)" active={level === "all"} underline="var(--fg)" onClick={() => setLevel("all")} />
        {LEVELS.map(([s, c]) => {
          const n = count(s), on = level === s;
          return <LevelButton key={s} label={s} color={c} n={n} valueColor={n ? c : "var(--fg)"} active={on} tintBg underline={c} onClick={() => setLevel(on ? "all" : s)} />;
        })}
      </Card>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-border px-4 py-3.5">
          <div className="relative min-w-[220px] flex-[1_1_300px]">
            <span className="pointer-events-none absolute left-2.5 top-[9px] text-muted-foreground"><Filter size={14} className="block" /></span>
            <Input className="pl-8" placeholder="Filter · substring across every line…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Segmented value={win} onChange={setWin} aria-label="Window" options={(Object.keys(WINDOWS) as Win[]).map((w) => ({ value: w, label: w }))} />
          <span className="inline-flex h-8 items-center rounded-[8px] border border-solid border-border px-2.5 text-[12.5px] text-fg-2">Limit {LOG_LIMIT}</span>
        </div>
        <div className="flex flex-wrap justify-between gap-3 border-0 border-b border-solid border-border px-4 py-2.5 text-[12px] text-muted-foreground tnum">
          <span>Showing {num(shown.length)} of {num(entries.length)} lines · newest first</span>
          <span>{auto ? `Next refresh in ${sec}s` : "Auto-refresh paused"}</span>
        </div>
        <div className="flex max-h-[560px] flex-col overflow-y-auto bg-card-2">
          {shown.map((e, i) => {
            const c = colorOf(e.severity), warn = e.severity === "WARN";
            return (
              <div key={`${e.timeMs}-${i}`} className="grid grid-cols-[64px_58px_minmax(0,1fr)] items-baseline gap-3 border-0 border-b border-solid border-border px-4 py-2 font-mono text-[12px] leading-[1.6]" style={{ background: warn ? tint("var(--warning)", 6) : "transparent" }}>
                <span className="text-muted-foreground tnum">{new Date(e.timeMs).toISOString().slice(11, 19)}</span>
                <span><span className="inline-flex h-[19px] min-w-[46px] items-center justify-center rounded-[5px] px-1.5 text-[10.5px] font-semibold tracking-[.03em]" style={{ color: c, background: tint(c) }}>{e.severity}</span></span>
                <span className="break-all" style={{ color: warn ? "var(--warning)" : "var(--fg-2)" }}>{e.message}</span>
              </div>
            );
          })}
          {shown.length === 0 && <div className="px-5 py-11 text-center font-sans text-[13px] text-muted-foreground">{loading ? "Loading logs…" : "No lines match this filter."}</div>}
        </div>
      </Card>
    </Screen>
  );
}

function LevelButton({ label, color, n, valueColor, active, tintBg, underline, onClick }: { label: string; color: string; n: number; valueColor: string; active: boolean; tintBg?: boolean; underline: string; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className="flex min-w-0 cursor-pointer flex-col items-start gap-1.5 border-none px-5 pb-4 pt-3.5 text-left hover:bg-hover"
      style={{ background: active ? (tintBg ? tint(color, 8) : "var(--hover)") : "transparent", boxShadow: SEPARATOR + (active ? `, inset 0 -2px 0 ${underline}` : "") }}>
      <span className="inline-flex items-center gap-[7px] whitespace-nowrap text-[11.5px] font-semibold leading-5 tracking-[.04em] text-muted-foreground">
        <span className="h-[7px] w-[7px] rounded-[7px]" style={{ background: color }} />{label}
      </span>
      <span className="text-[24px] font-semibold leading-[30px] tracking-[-0.03em] tnum" style={{ color: valueColor }}>{num(n)}</span>
    </button>
  );
}
