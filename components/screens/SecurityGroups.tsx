"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronRight, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { ago } from "@/components/natasha/format";
import { Banner, Dot, ErrorNote, Kpi, KpiGrid, PageHeader, Screen, ScreenSkeleton } from "@/components/natasha/primitives";
import { useShell } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { cn, tint } from "@/lib/utils";

interface SgRule { direction: "in" | "out"; protocol: string; fromPort: number | null; toPort: number | null; cidr: string[]; cidr6: string[]; sgSources: string[]; description: string | null; flags: string[] }
interface Sg { id: string; name: string; description: string; vpcId: string | null; region: string; inbound: SgRule[]; outbound: SgRule[]; attachedEniCount: number; attachedInstanceIds: string[]; flags: string[]; worstFlag: "wide-open" | "risky" | "unused" | null; isDefault?: boolean; referencedByCount?: number }
interface Inventory { fetchedAt: string; regions: string[]; totalCount: number; riskyCount: number; wideOpenCount: number; unusedCount: number; groups: Sg[] }
type Filter = "all" | "wide-open" | "risky" | "unused" | "attached";

const COLS = "16px minmax(260px,1.8fr) 100px 120px 76px 76px 76px 96px";
const RULE_LIMIT = 6;
const PAGE_SIZE = 25;

const STATUS: Record<string, { label: string; color: string }> = {
  "wide-open": { label: "Wide-open", color: "var(--danger)" },
  risky: { label: "Risky", color: "var(--warning)" },
  unused: { label: "Not attached", color: "var(--muted-fg)" },
  attached: { label: "Attached", color: "var(--success)" },
};

function portLabel(r: SgRule): string {
  const proto = r.protocol === "-1" ? "All" : r.protocol === "icmp" || r.protocol === "icmpv6" ? "ICMP" : r.protocol.toUpperCase();
  if (r.protocol === "-1") return "All traffic";
  if (r.fromPort == null && r.toPort == null) return `${proto} all`;
  if (r.fromPort === 0 && r.toPort === 65535) return `${proto} all`;
  return r.fromPort === r.toPort || r.toPort == null ? `${proto} ${r.fromPort}` : `${proto} ${r.fromPort}–${r.toPort}`;
}

/** One row per source, so a rule open to the world stands out from its private siblings. */
function expand(rules: SgRule[]) {
  return rules.flatMap((r) => {
    const sources = [...r.cidr, ...r.cidr6, ...r.sgSources];
    return (sources.length ? sources : ["—"]).map((src) => {
      const world = src === "0.0.0.0/0" || src === "::/0";
      const flagged = world && (r.flags.includes("risky-port") || r.flags.includes("wide-open"));
      return { port: portLabel(r), src, flagged };
    });
  });
}

function RuleCard({ title, rules, empty }: { title: string; rules: SgRule[]; empty: string }) {
  const rows = expand(rules);
  return (
    <div className="overflow-hidden rounded-[10px] border border-solid border-border bg-card">
      <div className="border-0 border-b border-solid border-border px-3.5 py-2.5 text-[12.5px] font-semibold">{title}</div>
      {rows.slice(0, RULE_LIMIT).map((x, i) => {
        const c = x.flagged ? "var(--warning)" : "var(--fg-2)";
        return (
          <div key={i} className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-2.5 border-0 border-b border-solid border-border px-3.5 py-2 font-mono text-[12px]">
            <span className="text-fg-2">{x.port}</span>
            <span className="truncate" style={{ color: c }} title={x.src}>{x.src}</span>
            <span className="font-sans text-[11px] font-semibold" style={{ color: c }}>{x.flagged ? "Open to world" : ""}</span>
          </div>
        );
      })}
      {rows.length === 0 && <div className="px-3.5 py-2.5 text-[12.5px] text-muted-foreground">{empty}</div>}
      {rows.length > RULE_LIMIT && <div className="px-3.5 py-2 text-[12px] text-muted-foreground">+{rows.length - RULE_LIMIT} more rules</div>}
    </div>
  );
}

function riskText(g: Sg): string | null {
  const bad = expand(g.inbound).filter((x) => x.flagged);
  return bad.length ? `${Array.from(new Set(bad.map((b) => b.port))).join(", ")} reachable from the internet.` : null;
}

export default function SecurityGroups() {
  const { toast } = useShell();
  const { data, error, reload } = useJson<{ inventory: Inventory }>("/api/security-groups");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [filter, q]);

  const inv = data?.inventory;
  const statusOf = (g: Sg) => g.worstFlag ?? "attached";
  const groups = useMemo(() => {
    const rank: Record<string, number> = { "wide-open": 0, risky: 1, attached: 2, unused: 3 };
    return [...(inv?.groups ?? [])].sort((a, b) => rank[statusOf(a)] - rank[statusOf(b)] || a.name.localeCompare(b.name));
  }, [inv]);
  const needle = q.trim().toLowerCase();
  const list = groups.filter((g) => (filter === "all" || statusOf(g) === filter)
    && (!needle || `${g.id} ${g.name} ${g.vpcId ?? ""} ${g.region} ${g.attachedInstanceIds.join(" ")}`.toLowerCase().includes(needle)));

  const refresh = async () => {
    setBusy(true);
    try {
      await fetch("/api/security-groups?refresh=1");
      reload();
      toast(`Security groups refreshed across ${inv?.regions.length ?? 0} regions`);
    } catch (e) {
      toast(`Refresh failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <PageHeader title="Security Groups"
      description={inv ? `AWS · ${inv.totalCount} security groups across ${inv.regions.length} regions · checked ${ago(inv.fetchedAt)}` : "AWS security groups across every region"}
      actions={<Button variant="primary" size="lg" className="px-3.5" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} className={cn("block", busy && "animate-nt-spin")} />Refresh</Button>} />
  );
  if (error) return <Screen label="Security Groups">{header}<ErrorNote message={error} onRetry={reload} /></Screen>;
  if (!inv) return <ScreenSkeleton />;

  const attached = groups.filter((g) => statusOf(g) === "attached").length;
  const chips: Array<[Filter, string, number, string | null]> = [
    ["all", "All", inv.totalCount, null], ["wide-open", "Wide-open", inv.wideOpenCount, "var(--danger)"], ["risky", "Risky", inv.riskyCount, "var(--warning)"],
    ["unused", "Not attached", inv.unusedCount, null], ["attached", "Attached", attached, null],
  ];

  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const start = current * PAGE_SIZE;
  const shown = list.slice(start, start + PAGE_SIZE);
  const unusedNote = (g: Sg) => (g.isDefault
    ? "AWS default group for its network. It is not attached to anything, but AWS does not allow deleting it."
    : g.referencedByCount
      ? `Not attached to any resource, but ${g.referencedByCount} other ${g.referencedByCount === 1 ? "group refers" : "groups refer"} to it in their rules. Review those before removing it in the AWS console.`
      : "Not attached to any resource. Review before deleting it in the AWS console; Natasha is read-only.");

  return (
    <Screen label="Security Groups">
      {header}
      <KpiGrid>
        <Kpi label="Total groups" value={inv.totalCount} footer={`Across ${inv.regions.length} regions`} />
        <Kpi label="Wide-open" value={inv.wideOpenCount} valueColor={inv.wideOpenCount ? "var(--danger)" : "var(--success)"} footer="0.0.0.0/0 on all ports" />
        <Kpi label="Risky" value={inv.riskyCount} valueColor={inv.riskyCount ? "var(--warning)" : "var(--success)"} footer="Sensitive port reachable from the internet" />
        <Kpi label="Not attached" value={inv.unusedCount} footer="Not attached to any resource · review before deleting" />
      </KpiGrid>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-border px-4 py-3.5">
          <SearchInput wrapperClassName="min-w-[220px] max-w-[440px] flex-[1_1_300px]" placeholder="Search by SG id, name, VPC, region or instance id…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="ml-auto flex flex-wrap gap-1.5">
            {chips.map(([k, label, n, color]) => {
              const on = filter === k, mix = color ?? "var(--fg)";
              return (
                <button key={k} type="button" aria-pressed={on} onClick={() => setFilter(k)} className="inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-[8px] border border-solid px-2.5 text-[12.5px] font-medium text-fg-2 hover:border-border-strong"
                  style={{ borderColor: on ? `color-mix(in oklab, ${mix} 45%, transparent)` : "var(--border)", background: on ? tint(mix, 12) : "transparent" }}>
                  {label}<span className="text-muted-foreground tnum">{n}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[940px]">
            <div className="grid h-[38px] items-center gap-3.5 border-0 border-b border-solid border-border bg-card-2 px-5 text-[12px] font-medium text-muted-foreground" style={{ gridTemplateColumns: COLS }}>
              <span /><span>Group</span><span>Region</span><span>VPC</span><span className="text-right">Inbound</span><span className="text-right">Outbound</span><span className="text-right">Attached</span><span>Status</span>
            </div>
            {shown.map((g) => {
              const isOpen = !!open[g.id];
              const st = STATUS[statusOf(g)];
              const risk = riskText(g);
              const toggle = () => setOpen((o) => ({ ...o, [g.id]: !isOpen }));
              return (
                <Fragment key={g.id}>
                  <div role="button" tabIndex={0} onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter") toggle(); }}
                    className={cn("grid min-h-[52px] cursor-pointer items-center gap-3.5 border-0 border-b border-solid border-border px-5 py-1.5 text-[13px] hover:bg-hover", isOpen && "bg-hover")} style={{ gridTemplateColumns: COLS }}>
                    <span className={cn("text-muted-foreground transition-transform duration-150", isOpen && "rotate-90")}><ChevronRight size={14} className="block" /></span>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{g.name}</div>
                      <div className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">{g.id}</div>
                    </div>
                    <span className="truncate font-mono text-[12px] text-fg-2">{g.region}</span>
                    <span className="truncate font-mono text-[12px] text-fg-2">{g.vpcId ?? "—"}</span>
                    <span className="text-right tnum">{g.inbound.length}</span>
                    <span className="text-right tnum">{g.outbound.length}</span>
                    <span className="text-right tnum" style={{ color: g.attachedEniCount ? "var(--fg)" : "var(--subtle-fg)" }}>{g.attachedEniCount}</span>
                    <span>
                      <Badge className="gap-[5px]" style={statusOf(g) === "unused" ? { color: st.color, background: "var(--card-2)", border: "none" } : { color: st.color, background: tint(st.color), border: "none" }}><Dot color={st.color} />{st.label}</Badge>
                    </span>
                  </div>
                  {isOpen && (
                    <div className="flex flex-col gap-3 border-0 border-b border-solid border-border bg-hover pb-[18px] pl-[50px] pr-5 pt-1.5">
                      {risk && <Banner tone="var(--warning)"><span className="text-warning"><ShieldAlert size={14} className="block" /></span>{risk}</Banner>}
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-3">
                        <RuleCard title="Inbound rules" rules={g.inbound} empty="No inbound rules." />
                        <RuleCard title="Outbound rules" rules={g.outbound} empty="No outbound rules." />
                      </div>
                      {statusOf(g) === "unused" && <div className="text-[12.5px] text-muted-foreground">{unusedNote(g)}</div>}
                      {g.attachedInstanceIds.length > 0 && <div className="text-[12.5px] text-muted-foreground">Attached to <span className="font-mono text-fg-2">{g.attachedInstanceIds.join(", ")}</span></div>}
                    </div>
                  )}
                </Fragment>
              );
            })}
            {list.length === 0 && <div className="px-5 py-11 text-center text-[13px] text-muted-foreground">No security groups match these filters.</div>}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3.5 pt-3 text-[12.5px] text-muted-foreground tnum">
          <span>{list.length === 0 ? "Showing 0 groups" : `Showing ${start + 1}–${start + shown.length} of ${list.length} groups`}{list.length !== inv.totalCount && ` · ${inv.totalCount} in total`}</span>
          {pages > 1 && (
            <span className="flex items-center gap-2">
              <Button size="xs" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</Button>
              <span>Page {current + 1} of {pages}</span>
              <Button size="xs" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</Button>
            </span>
          )}
        </div>
      </Card>
    </Screen>
  );
}
