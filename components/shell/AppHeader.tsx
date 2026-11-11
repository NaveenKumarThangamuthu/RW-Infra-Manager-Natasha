"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Download, Loader2, Menu, Moon, PanelLeft, RefreshCw, Search, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useJson } from "@/components/useJson";
import { ago, ageMinutes } from "@/components/natasha/format";
import { cn } from "@/lib/utils";
import { useOnRefreshed, useShell } from "./ShellContext";
import { useSummary } from "./useOps";

const SNAP_LABELS: Array<[string, string]> = [
  ["spring-health", "Spring health"], ["spring-logs", "ELK logs"], ["ec2-health", "EC2"], ["ec2-volumes", "Volumes"],
  ["cloudwatch-alarms", "CloudWatch"], ["prom-alerts", "Prometheus"], ["recommendations", "Recommendations"], ["lambda-ohio", "Lambda"],
];
const STALE_MIN = 36 * 60;

function FreshnessPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { refreshing, refresh } = useShell();
  const { data: summary } = useSummary();
  const { data: status } = useJson<{ lastRefreshAt: string | null; lastRunLabel: string | null }>("/api/refresh/status");
  const rows: Array<{ name: string; at: string | null }> = [
    { name: "Cron refresh", at: summary?.ops.cronLastAt ?? null },
    ...SNAP_LABELS.map(([k, name]) => ({ name, at: summary?.ops.snapshots[k]?.capturedAt ?? null })),
    { name: "Billing backfill", at: summary?.ops.backfillLastAt ?? null },
  ];
  return (
    <>
      <div className="text-[13.5px] font-semibold">Data freshness</div>
      <div className="mt-0.5 text-[12px] leading-[1.5] text-muted-foreground">
        {status?.lastRefreshAt
          ? `Last refreshed ${new Date(status.lastRefreshAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true })} IST${status.lastRunLabel ? ` · ${status.lastRunLabel}` : ""}`
          : "No refresh recorded yet"}
      </div>
      <div className="mt-2.5 flex flex-col">
        {rows.map((x) => {
          const m = ageMinutes(x.at);
          return (
            <div key={x.name} className="flex justify-between gap-3 border-0 border-t border-solid border-border py-1.5 text-[12.5px]">
              <span className="text-muted-foreground">{x.name}</span>
              <span className={cn("font-medium tnum", m == null || m > STALE_MIN ? "text-warning" : "text-fg-2")}>{ago(x.at)}</span>
            </div>
          );
        })}
      </div>
      <Button variant="outline" size="sm" className="mt-2.5 h-8 w-full" disabled={refreshing} onClick={() => void refresh()}>
        <RefreshCw size={14} className={cn("block", refreshing && "animate-nt-spin")} />
        {refreshing ? "Refreshing…" : "Refresh all sources"}
      </Button>
      <Button variant="ghost" size="sm" className="mt-1.5 h-8 w-full" onClick={() => { onClose(); router.push("/cron"); }}>Open cron jobs</Button>
    </>
  );
}

function usePdfExport() {
  const { toast } = useShell();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    toast("Rendering PDF — this can take ~10s");
    try {
      const resp = await fetch("/api/export/pdf");
      if (!resp.ok) throw new Error(await resp.text());
      const url = URL.createObjectURL(await resp.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `natasha-dashboard-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
    } catch (err) {
      toast(`PDF export failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

export function AppHeader({ title, mobile, onToggleSidebar }: { title: string; mobile: boolean; onToggleSidebar: () => void }) {
  const { resolvedTheme, setTheme, setCmdOpen } = useShell();
  const { data: status, reload } = useJson<{ lastRefreshAt: string | null }>("/api/refresh/status");
  useOnRefreshed(reload);
  const [fresh, setFresh] = useState(false);
  const pdf = usePdfExport();
  const syncMin = ageMinutes(status?.lastRefreshAt);
  const syncColor = syncMin == null || syncMin > STALE_MIN ? "bg-warning" : "bg-success";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-0 border-b border-solid border-border bg-background pl-3.5 pr-3">
      <button type="button" onClick={onToggleSidebar} title="Toggle sidebar (Ctrl+B)" className="inline-grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-[8px] border-none bg-transparent text-fg-2 hover:bg-hover">
        {mobile ? <Menu size={16} className="block" /> : <PanelLeft size={16} className="block" />}
      </button>
      {!mobile && <span className="mx-1 h-4 w-px shrink-0 bg-border" />}
      <div className="flex min-w-0 items-center gap-1.5 text-[13.5px]">
        {!mobile && (
          <>
            <span className="text-muted-foreground">Natasha</span>
            <span className="text-subtle"><ChevronRight size={14} className="block" /></span>
          </>
        )}
        <span className="truncate font-medium">{title}</span>
      </div>
      <div className="flex-1" />
      {mobile && (
        <button type="button" onClick={() => setCmdOpen(true)} title="Search" className="inline-grid h-[34px] w-[34px] shrink-0 cursor-pointer place-items-center rounded-[8px] border border-solid border-border bg-card text-fg-2">
          <Search size={16} className="block" />
        </button>
      )}
      {!mobile && (
        <button type="button" onClick={() => setCmdOpen(true)} className="flex h-[34px] min-w-10 flex-[0_1_280px] cursor-pointer items-center gap-2 rounded-[8px] border border-solid border-border bg-card pl-2.5 pr-2 text-[13px] text-muted-foreground hover:border-border-strong">
          <Search size={14} className="block shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">Search or jump to…</span>
          <kbd className="rounded-[5px] border border-solid border-border bg-card-2 px-1.5 py-px font-mono text-[11px] text-muted-foreground">⌘K</kbd>
        </button>
      )}
      <Popover open={fresh} onOpenChange={setFresh}>
        <PopoverTrigger asChild>
          {mobile ? (
            <button type="button" title="Data freshness" className="inline-grid h-[34px] w-[34px] shrink-0 cursor-pointer place-items-center rounded-[8px] border border-solid border-border bg-card">
              <span className={cn("h-2 w-2 rounded-[8px]", syncColor)} />
            </button>
          ) : (
            <button type="button" className="inline-flex h-[34px] cursor-pointer items-center gap-[7px] whitespace-nowrap rounded-[8px] border border-solid border-border bg-card px-2.5 text-[13px] font-medium text-foreground hover:bg-hover">
              <span className={cn("h-[7px] w-[7px] rounded-[7px]", syncColor)} />
              {status ? `Synced ${ago(status.lastRefreshAt)}` : "Syncing…"}
              <span className="text-muted-foreground"><ChevronDown size={14} className="block" /></span>
            </button>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-[min(300px,calc(100vw-16px))] p-3.5"><FreshnessPanel onClose={() => setFresh(false)} /></PopoverContent>
      </Popover>
      <button type="button" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} title="Toggle theme" className="inline-grid h-[34px] w-[34px] shrink-0 cursor-pointer place-items-center rounded-[8px] border border-solid border-border bg-card text-fg-2 hover:bg-hover">
        {resolvedTheme === "dark" ? <Sun size={16} className="block" /> : <Moon size={16} className="block" />}
      </button>
      {!mobile && (
        <Button variant="outline" size="md" onClick={() => void pdf.run()} aria-busy={pdf.busy} title={pdf.busy ? "Rendering PDF — this can take ~10s" : "Download dashboard as PDF"}>
          {pdf.busy ? <Loader2 size={14} className="block animate-nt-spin" /> : <Download size={14} className="block" />}PDF
        </Button>
      )}
    </header>
  );
}
