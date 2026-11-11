"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ChevronRight, Copy, Database, Globe, Lock, RefreshCw, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { num } from "@/components/natasha/format";
import { Banner, Dot, ErrorNote, PageHeader, Screen, ScreenSkeleton } from "@/components/natasha/primitives";
import { useJson } from "@/components/useJson";
import { useShell } from "@/components/shell/ShellContext";
import { cn, tint } from "@/lib/utils";

type RdsFlag = "publicly-accessible" | "unencrypted" | "no-multi-az" | "backup-disabled" | "no-deletion-protect" | "storage-pressure" | "stopped";
interface Instance {
  id: string; region: string; engine: string; engineVersion: string; instanceClass: string; status: string; multiAz: boolean; publiclyAccessible: boolean; storageEncrypted: boolean;
  allocatedStorageGb: number | null; storageType: string | null; endpoint: string | null; flags: RdsFlag[];
  metrics: { cpuAvg: number | null; connectionsAvg: number | null; freeStorageBytes: number | null; freeStoragePct: number | null };
}
interface Inventory { fetchedAt: string; regions: string[]; totalInstances: number; publicCount: number; unencryptedCount: number; singleAzCount: number; noBackupCount: number; stoppedCount: number; instances: Instance[]; regionErrors: Array<{ region: string; error: string }> }
type Filter = "all" | "public" | "unencrypted" | "no-backup" | "single-az" | "stopped";

const FILTER_FLAG: Record<Exclude<Filter, "all">, RdsFlag> = { public: "publicly-accessible", unencrypted: "unencrypted", "no-backup": "backup-disabled", "single-az": "no-multi-az", stopped: "stopped" };
const CONN_SCALE = 1000;

function Gauge({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-col gap-0.5 text-[12px]">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="text-[13px] font-semibold tnum">{value}</span>
      </div>
      <span className="block h-[5px] overflow-hidden rounded-[5px] bg-card-2"><span className="block h-full rounded-[5px]" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} /></span>
    </div>
  );
}
const load = (p: number) => (p >= 85 ? "var(--danger)" : p >= 65 ? "var(--warning)" : "var(--success)");

export default function Databases() {
  const { toast } = useShell();
  const { data, error, reload } = useJson<{ inventory: Inventory }>("/api/rds");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const inv = data?.inventory;
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (inv?.instances ?? []).filter((i) => (filter === "all" || i.flags.includes(FILTER_FLAG[filter]))
      && (!needle || `${i.id} ${i.engine} ${i.engineVersion} ${i.instanceClass} ${i.endpoint ?? ""} ${i.region}`.toLowerCase().includes(needle)));
  }, [inv, filter, q]);

  const refresh = async () => {
    setBusy(true);
    try {
      await fetch("/api/rds?refresh=1");
      reload();
      toast("RDS inventory refreshed from AWS");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <PageHeader title="Databases" description={inv ? `Amazon RDS · ${inv.totalInstances} instance${inv.totalInstances === 1 ? "" : "s"} across ${inv.regions.length} regions · last fetched ${new Date(inv.fetchedAt).toLocaleTimeString()}` : "Amazon RDS"}
      actions={<Button variant="primary" size="lg" className="px-3.5" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} className={cn("block", busy && "animate-nt-spin")} />Refresh</Button>} />
  );
  if (error) return <Screen label="Databases">{header}<ErrorNote message={error} onRetry={reload} /></Screen>;
  if (!inv) return <ScreenSkeleton />;

  const stats: Array<{ label: string; n: number; icon: LucideIcon; color?: string; span: string }> = [
    { label: "Instances", n: inv.totalInstances, icon: Database, span: "--s5a" },
    { label: "Publicly accessible", n: inv.publicCount, icon: Globe, color: "var(--danger)", span: "--s5a" },
    { label: "Unencrypted at rest", n: inv.unencryptedCount, icon: Lock, color: "var(--warning)", span: "--s5a" },
    { label: "No automated backups", n: inv.noBackupCount, icon: Archive, color: "var(--danger)", span: "--s5b" },
    { label: "Single-AZ", n: inv.singleAzCount, icon: Copy, color: "var(--warning)", span: "--s5e" },
  ];
  const chips: Array<[Filter, string, number]> = [["all", "All", inv.totalInstances], ["public", "Public", inv.publicCount], ["unencrypted", "Unencrypted", inv.unencryptedCount], ["no-backup", "No backups", inv.noBackupCount], ["single-az", "Single-AZ", inv.singleAzCount], ["stopped", "Stopped", inv.stoppedCount]];

  return (
    <Screen label="Databases">
      {header}
      {inv.regionErrors.length > 0 && <Banner tone="var(--warning)">Could not read {inv.regionErrors.length} region{inv.regionErrors.length === 1 ? "" : "s"}: {inv.regionErrors.map((e) => e.region).join(", ")}. Counts may be incomplete.</Banner>}
      <Card className="grid overflow-hidden grid-cols-[repeat(var(--s5c,5),minmax(0,1fr))]">
        {stats.map((s) => {
          const Icon = s.icon, active = s.n > 0 && s.color;
          return (
            <div key={s.label} className="flex min-w-0 flex-col gap-1.5 px-5 py-4 shadow-[1px_0_0_var(--border),0_1px_0_var(--border)]" style={{ gridColumn: `span var(${s.span},1)` }}>
              <span className="flex items-start gap-[7px] text-[13px] font-medium leading-5 text-muted-foreground">
                <span className="inline-flex h-5 shrink-0 items-center" style={{ color: active ? s.color : "var(--subtle-fg)" }}><Icon size={12} className="block" /></span>{s.label}
              </span>
              <span className="mt-auto text-[26px] font-semibold leading-8 tracking-[-0.03em] tnum" style={{ color: active ? s.color : undefined }}>{s.n}</span>
            </div>
          );
        })}
      </Card>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-border px-4 py-3.5">
          <SearchInput wrapperClassName="min-w-[200px] max-w-[420px] flex-[1_1_280px]" placeholder="Search identifier, engine, class, endpoint, region…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="ml-auto flex flex-wrap gap-1.5">
            {chips.map(([k, label, n]) => {
              const on = filter === k;
              return (
                <button key={k} type="button" aria-pressed={on} onClick={() => setFilter(k)} className="inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-[8px] border border-solid px-2.5 text-[12.5px] font-medium text-fg-2 hover:border-border-strong"
                  style={{ borderColor: on ? "color-mix(in oklab, var(--fg) 45%, transparent)" : "var(--border)", background: on ? tint("var(--fg)", 12) : "transparent" }}>
                  {label}<span className="text-muted-foreground tnum">{n}</span>
                </button>
              );
            })}
          </div>
        </div>
        {list.map((i, idx) => {
          const ok = i.status === "available", statusColor = ok ? "var(--success)" : "var(--warning)";
          const cpu = i.metrics.cpuAvg, conns = i.metrics.connectionsAvg;
          const used = i.metrics.freeStoragePct != null ? 100 - i.metrics.freeStoragePct : null;
          return (
            <Link key={i.id} href={`/rds/${encodeURIComponent(i.id)}?region=${encodeURIComponent(i.region)}`}
              className={cn("relative flex flex-wrap items-center gap-x-8 gap-y-4 py-[18px] pl-5 pr-12 no-underline hover:bg-hover", idx > 0 && "border-0 border-t border-solid border-border")}>
              <div className="min-w-0 flex-[1_1_300px]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <span className="mr-0.5 text-[14px] font-semibold text-foreground">{i.id}</span>
                  <Badge tone={statusColor} className="gap-[5px]"><Dot color={statusColor} />{i.status}</Badge>
                  {i.publiclyAccessible && <Badge tone="var(--danger)">Public</Badge>}
                  {!i.storageEncrypted && <Badge tone="var(--warning)">Unencrypted</Badge>}
                </div>
                <div className="mt-1.5 font-mono text-[12px] leading-[1.5] text-muted-foreground">
                  {i.engine} {i.engineVersion} · {i.instanceClass} · {i.region}{i.allocatedStorageGb != null ? ` · ${i.allocatedStorageGb} GB ${i.storageType ?? ""}` : ""}
                </div>
              </div>
              <div className="grid min-w-0 flex-[0_1_440px] grid-cols-3 gap-5 text-foreground">
                <Gauge label="CPU" value={cpu != null ? `${cpu.toFixed(1)}%` : "—"} pct={cpu ?? 0} color={load(cpu ?? 0)} />
                <Gauge label="Connections" value={conns != null ? num(conns) : "—"} pct={((conns ?? 0) / CONN_SCALE) * 100} color="var(--info)" />
                <Gauge label="Storage" value={used != null ? `${used.toFixed(1)}%` : "—"} pct={used ?? 0} color={load(used ?? 0)} />
              </div>
              <span className="absolute right-5 top-1/2 -mt-[7px] text-muted-foreground"><ChevronRight size={14} className="block" /></span>
            </Link>
          );
        })}
        {list.length === 0 && <div className="px-5 py-11 text-center text-[13px] text-muted-foreground">No databases match this filter.</div>}
      </Card>
    </Screen>
  );
}
