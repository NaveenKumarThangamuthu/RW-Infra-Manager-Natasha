"use client";
import { useMemo, useState } from "react";
import { Clock, ExternalLink, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { ago } from "@/components/natasha/format";
import { Dot, ErrorNote, PageHeader, Screen, ScreenSkeleton } from "@/components/natasha/primitives";
import { useShell } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { cn, tint } from "@/lib/utils";

type Severity = "expired" | "crit" | "warn" | "healthy" | "unknown";
interface CertRow { id: number; distributor: string; filename: string; driveFileId: string; owner: string; subject: string; notAfter: string; daysLeft: number; severity: Severity; errorMessage: string | null }
interface Kpis { total: number; expired: number; crit: number; warn: number; healthy: number; unknown: number; lastScan: string | null }
interface Resp { kpis: Kpis; items: CertRow[]; byDistributor: Record<string, CertRow[]> }
type Filter = "all" | "partner" | "rw" | "soon";

const COLS = "150px minmax(200px,1.2fr) 80px minmax(200px,1.2fr) 96px 150px 84px 40px";
const SEV: Record<Severity, { label: string; color: string }> = {
  expired: { label: "Expired", color: "var(--danger)" }, crit: { label: "Critical", color: "var(--orange)" }, warn: { label: "Expiring", color: "var(--warning)" },
  healthy: { label: "Healthy", color: "var(--success)" }, unknown: { label: "Unknown", color: "var(--muted-fg)" },
};
const SEV_ORDER: Severity[] = ["expired", "crit", "warn", "unknown", "healthy"];
const PALETTE = ["#ec4899", "#db2777", "#6366f1", "#06b6d4", "#eab308", "#0891b2", "#8b5cf6", "#e11d48", "#4f46e5", "#a855f7"];
const MAX_BAR_DAYS = 2100;
const isRw = (c: CertRow) => c.owner.toUpperCase() === "RW" || c.owner.toLowerCase() === "ours";
const dateOnly = (iso: string) => iso.slice(0, 10);
const driveUrl = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;

function code(name: string): string {
  const parts = name.split(/[-_\s]+/).filter(Boolean);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    return (parts[0][0] + (/^\d/.test(last) ? last[0] : parts[1][0])).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}
const worst = (rows: CertRow[]) => SEV_ORDER.find((s) => rows.some((r) => r.severity === s)) ?? "unknown";

export default function Certificates() {
  const { toast } = useShell();
  const { data, error, reload } = useJson<Resp>("/api/certificates");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [dist, setDist] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => [...(data?.items ?? [])].sort((a, b) => a.daysLeft - b.daysLeft), [data]);
  const distNames = useMemo(() => Object.keys(data?.byDistributor ?? {}).sort(), [data]);
  const needle = q.trim().toLowerCase();
  const matches = (c: CertRow, f: Filter) => f === "all" || (f === "partner" && !isRw(c)) || (f === "rw" && isRw(c)) || (f === "soon" && c.daysLeft <= 90);
  const list = items.filter((c) => matches(c, filter) && (!dist || c.distributor === dist) && (!needle || `${c.filename} ${c.subject} ${c.distributor}`.toLowerCase().includes(needle)));

  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/certificates/refresh", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      reload();
      toast(`Rescanned ${distNames.length} Drive folders`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const k = data?.kpis;
  const header = (
    <PageHeader title="Certificates"
      description={k ? `AS2 EDI certificates · ${k.total} across ${distNames.length} distributors · last scan ${ago(k.lastScan)} · checked daily at 00:30 and 12:30 UTC` : "AS2 EDI certificates"}
      actions={<Button variant="primary" size="lg" className="px-3.5" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} className={cn("block", busy && "animate-nt-spin")} />Refresh all</Button>} />
  );
  if (error) return <Screen label="Certificates">{header}<ErrorNote message={error} onRetry={reload} /></Screen>;
  if (!data || !k) return <ScreenSkeleton />;

  const next = items[0];
  const stats: Array<{ label: string; n: number; dot?: string; good?: boolean; span: string }> = [
    { label: "Total", n: k.total, span: "--s5a" },
    { label: "Healthy", n: k.healthy, dot: "var(--success)", good: true, span: "--s5a" },
    { label: "Expiring ≤ 90 days", n: k.warn, dot: "var(--warning)", span: "--s5a" },
    { label: "Expiring ≤ 30 days", n: k.crit, dot: "var(--orange)", span: "--s5b" },
    { label: "Expired", n: k.expired, dot: "var(--danger)", span: "--s5e" },
  ];
  const nextColor = next ? SEV[next.severity].color : "var(--muted-fg)";

  return (
    <Screen label="Certificates">
      {header}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[repeat(var(--s5c,5),minmax(0,1fr))]">
          {stats.map((s) => (
            <div key={s.label} className="flex min-w-0 flex-col gap-1.5 px-5 py-4 shadow-[1px_0_0_var(--border),0_1px_0_var(--border)]" style={{ gridColumn: `span var(${s.span},1)` }}>
              <span className="flex items-start gap-[7px] text-[13px] font-medium leading-5 text-muted-foreground">
                {s.dot && <span className="mt-[6.5px] h-[7px] w-[7px] shrink-0 rounded-[7px]" style={{ background: s.dot }} />}{s.label}
              </span>
              <span className="mt-auto text-[26px] font-semibold leading-8 tracking-[-0.03em] tnum" style={{ color: s.good ? "var(--success)" : s.dot && s.n > 0 ? s.dot : undefined }}>{s.n}</span>
            </div>
          ))}
        </div>
        {next && (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-0 border-t border-solid border-border px-5 py-3 text-[13px]">
            <span className="inline-flex text-muted-foreground"><Clock size={14} className="block" /></span>
            <span className="text-muted-foreground">Next expiry</span>
            <span className="font-mono text-[12.5px] font-medium">{next.filename}</span>
            <span className="text-muted-foreground">{next.distributor} · {dateOnly(next.notAfter)}</span>
            <Badge tone={nextColor} className="ml-auto">{next.daysLeft} days</Badge>
          </div>
        )}
      </Card>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">Distributors</h2>
        <span className="text-[12.5px] text-muted-foreground">{distNames.length} folders in Drive · one card per partner · click to filter</span>
      </div>
      <div className="grid grid-cols-[repeat(var(--k10,5),minmax(0,1fr))] gap-3">
        {distNames.map((name, i) => {
          const rows = data.byDistributor[name];
          const sorted = [...rows].sort((a, b) => a.daysLeft - b.daysLeft);
          const rw = sorted.filter(isRw), pt = sorted.filter((c) => !isRw(c));
          const color = PALETTE[i % PALETTE.length];
          const first = sorted[0];
          const on = dist === name;
          return (
            <button key={name} type="button" aria-pressed={on} onClick={() => setDist(on ? null : name)}
              className="flex min-w-0 cursor-pointer flex-col gap-3 overflow-hidden rounded-[12px] border border-solid bg-card pb-3.5 text-left text-foreground shadow-card hover:border-border-strong" style={{ borderColor: on ? color : undefined }}>
              <span className="block h-1" style={{ background: color }} />
              <span className="flex items-center gap-2 px-3.5">
                <span className="inline-grid h-[22px] w-[26px] place-items-center rounded-[6px] text-[11px] font-bold" style={{ color, background: tint(color, 16) }}>{code(name)}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{name}</span>
                <Dot color={SEV[worst(rows)].color} size={7} />
              </span>
              <span className="flex items-baseline gap-1.5 px-3.5">
                <span className="text-[26px] font-semibold tracking-[-0.03em] tnum">{first?.daysLeft ?? "—"}</span>
                <span className="text-[12px] text-muted-foreground">days to next expiry</span>
              </span>
              <span className="grid grid-cols-2 gap-2 px-3.5">
                {[[`RW ×${rw.length}`, rw[0]], [`Partner ×${pt.length}`, pt[0]]].map(([label, c]) => (
                  <span key={label as string} className="rounded-[8px] bg-card-2 px-[9px] py-[7px] text-[11.5px]">
                    <span className="block text-muted-foreground">{label as string}</span>
                    <span className="mt-0.5 block font-semibold tnum">{c ? `${(c as CertRow).daysLeft}d` : "—"}</span>
                  </span>
                ))}
              </span>
              <span className="flex justify-between gap-2 px-3.5 text-[11.5px] text-muted-foreground">
                <span className="min-w-0 truncate font-mono">{first?.filename}</span>
                <span className="shrink-0 tnum">{first ? dateOnly(first.notAfter) : ""}</span>
              </span>
            </button>
          );
        })}
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">All certificates</h3>
            <div className="mt-[3px] text-[13px] text-muted-foreground tnum">Showing {list.length} of {items.length} · sorted by days left</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dist && <button type="button" onClick={() => setDist(null)} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-solid border-border-strong bg-card-2 px-2.5 text-[12.5px] font-medium text-foreground">{dist}<X size={12} className="block" /></button>}
            {([["all", "All"], ["partner", "Partner"], ["rw", "RW"], ["soon", "≤ 90 days"]] as Array<[Filter, string]>).map(([f, label]) => {
              const on = filter === f;
              return (
                <button key={f} type="button" aria-pressed={on} onClick={() => setFilter(f)} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-solid px-2.5 text-[12.5px] font-medium text-fg-2 hover:border-border-strong"
                  style={{ borderColor: on ? "color-mix(in oklab, var(--fg) 45%, transparent)" : "var(--border)", background: on ? tint("var(--fg)", 12) : "transparent" }}>
                  {label}<span className="text-muted-foreground tnum">{items.filter((c) => matches(c, f)).length}</span>
                </button>
              );
            })}
            <SearchInput wrapperClassName="w-[220px] max-w-full" placeholder="File, common name…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[1040px]">
            <div className="grid h-[38px] items-center gap-3.5 border-0 border-y border-solid border-border bg-card-2 px-5 text-[12px] font-medium text-muted-foreground" style={{ gridTemplateColumns: COLS }}>
              <span>Distributor</span><span>File</span><span>Owner</span><span>Common name</span><span>Expires</span><span>Days left</span><span>Status</span><span />
            </div>
            {list.map((c) => {
              const s = SEV[c.severity], ownerColor = isRw(c) ? "var(--brand)" : "var(--info)";
              return (
                <div key={c.id} className="grid min-h-11 items-center gap-3.5 border-0 border-b border-solid border-border px-5 text-[13px] hover:bg-hover" style={{ gridTemplateColumns: COLS }}>
                  <span className="truncate">{c.distributor}</span>
                  <span className="truncate font-mono text-[12px]" title={c.errorMessage ?? c.filename}>{c.filename}</span>
                  <span><Badge tone={ownerColor}>{isRw(c) ? "RW" : "Partner"}</Badge></span>
                  <span className="truncate text-[12.5px] text-fg-2" title={c.subject}>{c.subject}</span>
                  <span className="text-[12.5px] text-fg-2 tnum">{dateOnly(c.notAfter)}</span>
                  <span className="flex items-center gap-2">
                    <span className="w-11 text-right font-medium tnum">{c.daysLeft}d</span>
                    <span className="block h-[5px] flex-1 overflow-hidden rounded-[5px] bg-card-2"><span className="block h-full rounded-[5px]" style={{ width: `${Math.max(0, Math.min(100, (c.daysLeft / MAX_BAR_DAYS) * 100))}%`, background: s.color }} /></span>
                  </span>
                  <span><Badge tone={s.color} className="gap-[5px]">{s.label}</Badge></span>
                  <a href={driveUrl(c.driveFileId)} target="_blank" rel="noreferrer" title="Open in Drive" aria-label={`Open ${c.filename} in Drive`} className="inline-grid h-7 w-7 place-items-center rounded-[7px] text-muted-foreground hover:bg-hover hover:text-foreground"><ExternalLink size={12} className="block" /></a>
                </div>
              );
            })}
            {list.length === 0 && <div className="px-5 py-11 text-center text-[13px] text-muted-foreground">No certificates match these filters.</div>}
          </div>
        </div>
      </Card>
    </Screen>
  );
}
