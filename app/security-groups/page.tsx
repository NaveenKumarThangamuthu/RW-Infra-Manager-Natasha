"use client";
import { useMemo, useState } from "react";
import { useJson } from "@/components/useJson";
import { ErrorBox, Loading, Empty } from "@/components/Common";
import { RefreshCw, ShieldAlert, Shield, ChevronDown, ChevronRight, Server, Globe, Search } from "lucide-react";

type SgRule = {
  direction: "in" | "out";
  protocol: string;
  fromPort: number | null;
  toPort: number | null;
  cidr: string[];
  cidr6: string[];
  sgSources: string[];
  description: string | null;
  flags: string[];
};
type SgSummary = {
  id: string;
  name: string;
  description: string;
  vpcId: string | null;
  region: string;
  ownerId: string | null;
  tags: Record<string, string>;
  inbound: SgRule[];
  outbound: SgRule[];
  attachedEniCount: number;
  attachedInstanceIds: string[];
  flags: string[];
  worstFlag: "wide-open" | "risky" | "unused" | null;
};
type Inventory = {
  fetchedAt: string;
  regions: string[];
  totalCount: number;
  riskyCount: number;
  wideOpenCount: number;
  unusedCount: number;
  groups: SgSummary[];
  cached: boolean;
};
type Resp = { ok: boolean; inventory: Inventory; error?: string };

type Filter = "all" | "risky" | "wide-open" | "unused" | "attached";

function protocolLabel(p: string): string {
  if (p === "-1") return "ALL";
  if (p === "tcp") return "TCP";
  if (p === "udp") return "UDP";
  if (p === "icmp" || p === "icmpv6") return "ICMP";
  return p.toUpperCase();
}
function portLabel(from: number | null, to: number | null, proto: string): string {
  if (proto === "-1") return "ALL";
  if (from === null && to === null) return "ALL";
  if (from === to || to === null) return `${from}`;
  if (from === 0 && to === 65535) return "ALL";
  return `${from}–${to}`;
}
function commonPortName(from: number | null, to: number | null): string | null {
  if (from !== to) return null;
  const p = from;
  const names: Record<number, string> = {
    22: "SSH", 3389: "RDP", 3306: "MySQL", 5432: "Postgres",
    1433: "MSSQL", 27017: "MongoDB", 6379: "Redis",
    9200: "Elasticsearch", 5601: "Kibana", 80: "HTTP", 443: "HTTPS",
    2049: "NFS", 25: "SMTP", 21: "FTP", 23: "Telnet", 8080: "HTTP-alt",
    8443: "HTTPS-alt",
  };
  return p != null ? (names[p] ?? null) : null;
}

export default function SecurityGroupsPage() {
  const { data, error, reload } = useJson<Resp>("/api/security-groups");
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  async function forceRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetch("/api/security-groups?refresh=1");
      reload();
    } finally { setRefreshing(false); }
  }

  const filtered = useMemo(() => {
    if (!data?.inventory?.groups) return [];
    const q = search.trim().toLowerCase();
    return data.inventory.groups.filter((g) => {
      if (filter === "risky" && !g.flags.includes("risky") && !g.flags.includes("wide-open")) return false;
      if (filter === "wide-open" && !g.flags.includes("wide-open")) return false;
      if (filter === "unused" && !g.flags.includes("unused")) return false;
      if (filter === "attached" && g.flags.includes("unused")) return false;
      if (q) {
        return (
          g.id.toLowerCase().includes(q) ||
          g.name.toLowerCase().includes(q) ||
          (g.vpcId ?? "").toLowerCase().includes(q) ||
          g.region.includes(q) ||
          g.attachedInstanceIds.some((i) => i.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [data, filter, search]);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const inv = data.inventory;

  return (
    <div className="sg-page">
      {/* Hero */}
      <div className="sg-hero">
        <div className="sg-hero-glow-a" />
        <div className="sg-hero-glow-b" />
        <div className="sg-hero-inner">
          <div className="sg-hero-title-row">
            <div>
              <div className="sg-hero-eyebrow"><ShieldAlert size={12} /> AWS SECURITY GROUPS</div>
              <h1 className="sg-hero-title"><span className="sg-hero-title-grad">Network</span> ACLs</h1>
              <p className="sg-hero-subline">
                {inv.totalCount} SGs across {inv.regions.length} regions ·
                last fetched {new Date(inv.fetchedAt).toLocaleTimeString()}
                {inv.cached ? " (cached)" : ""}
              </p>
            </div>
            <button className="btn primary sg-refresh-btn" onClick={forceRefresh} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? "spin" : ""} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          <div className="sg-kpi-row">
            <div className="sg-kpi sg-kpi-total">
              <div className="sg-kpi-ico"><Shield size={14} /></div>
              <div className="sg-kpi-body"><div className="sg-kpi-val">{inv.totalCount}</div><div className="sg-kpi-lbl">Total</div></div>
            </div>
            <div className={`sg-kpi sg-kpi-wide ${inv.wideOpenCount > 0 ? "hot" : ""}`}>
              <div className="sg-kpi-ico"><Globe size={14} /></div>
              <div className="sg-kpi-body"><div className="sg-kpi-val">{inv.wideOpenCount}</div><div className="sg-kpi-lbl">Wide-open (0.0.0.0/0 all ports)</div></div>
            </div>
            <div className={`sg-kpi sg-kpi-risky ${inv.riskyCount > 0 ? "warm" : ""}`}>
              <div className="sg-kpi-ico"><ShieldAlert size={14} /></div>
              <div className="sg-kpi-body"><div className="sg-kpi-val">{inv.riskyCount}</div><div className="sg-kpi-lbl">Risky (SSH/DB open to world)</div></div>
            </div>
            <div className="sg-kpi sg-kpi-unused">
              <div className="sg-kpi-ico"><Server size={14} /></div>
              <div className="sg-kpi-body"><div className="sg-kpi-val">{inv.unusedCount}</div><div className="sg-kpi-lbl">Unused (safe to delete)</div></div>
            </div>
          </div>

          {(inv.wideOpenCount > 0 || inv.riskyCount > 0) && (
            <div className="sg-fable">
              <div className="sg-fable-head">🚨 Fable insight <span className="sg-fable-model">claude-fable-5</span></div>
              <div className="sg-fable-body">
                {inv.wideOpenCount > 0
                  ? `${inv.wideOpenCount} security group${inv.wideOpenCount === 1 ? " is" : "s are"} wide-open (0.0.0.0/0 on all ports). This is almost never intentional — any instance attached is exposed to the entire internet.`
                  : `${inv.riskyCount} security group${inv.riskyCount === 1 ? " has" : "s have"} sensitive ports (SSH · MySQL · MongoDB · etc) exposed to 0.0.0.0/0. Restrict to your office VPN CIDR or a bastion host.`}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="sg-toolbar">
        <div className="sg-search">
          <Search size={14} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by SG id, name, VPC, region, or instance id…" />
        </div>
        <div className="sg-filter-chips">
          {(["all", "wide-open", "risky", "unused", "attached"] as const).map((f) => {
            const n = f === "all" ? inv.totalCount :
                      f === "wide-open" ? inv.wideOpenCount :
                      f === "risky" ? inv.riskyCount + inv.wideOpenCount :
                      f === "unused" ? inv.unusedCount :
                      inv.totalCount - inv.unusedCount;
            const label = f === "all" ? "All" :
                          f === "wide-open" ? "Wide-open" :
                          f === "risky" ? "Risky" :
                          f === "unused" ? "Unused" : "Attached";
            return (
              <button key={f} className={`sg-chip sg-chip-${f} ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
                {label} <span className="sg-chip-count">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Rows */}
      <div className="sg-list">
        {filtered.length === 0 && <Empty text="No security groups match the current filter." />}
        {filtered.map((sg) => (
          <SgRow key={`${sg.region}-${sg.id}`} sg={sg} open={openId === `${sg.region}-${sg.id}`} onToggle={() => setOpenId(openId === `${sg.region}-${sg.id}` ? null : `${sg.region}-${sg.id}`)} />
        ))}
      </div>
    </div>
  );
}

function SgRow({ sg, open, onToggle }: { sg: SgSummary; open: boolean; onToggle: () => void }) {
  const worstColor = sg.worstFlag === "wide-open" ? "#f87171"
                   : sg.worstFlag === "risky" ? "#fb923c"
                   : sg.worstFlag === "unused" ? "#94a3b8" : "#6ee7b7";
  const nameTag = sg.tags.Name || sg.name;
  return (
    <div className={`sg-row ${open ? "open" : ""} sg-row-${sg.worstFlag ?? "ok"}`}>
      <button className="sg-row-head" onClick={onToggle} aria-expanded={open} style={{ borderLeftColor: worstColor }}>
        <span className="sg-caret">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <span className="sg-id mono small">{sg.id}</span>
        <span className="sg-name">{nameTag}</span>
        <span className="sg-region mono small">{sg.region}</span>
        <span className="sg-vpc mono small muted">{sg.vpcId ?? "-"}</span>
        <span className="sg-count-block">
          <span className="sg-count-lbl">in</span><span className="sg-count-val">{sg.inbound.length}</span>
          <span className="sg-count-lbl">out</span><span className="sg-count-val">{sg.outbound.length}</span>
          <span className="sg-count-lbl">attached</span><span className="sg-count-val">{sg.attachedEniCount}</span>
        </span>
        <span className="sg-flag-badges">
          {sg.flags.includes("wide-open") && <span className="sg-flag-badge sg-flag-crit">🌐 wide-open</span>}
          {sg.flags.includes("risky") && !sg.flags.includes("wide-open") && <span className="sg-flag-badge sg-flag-warn">⚠ risky</span>}
          {sg.flags.includes("unused") && <span className="sg-flag-badge sg-flag-idle">⌀ unused</span>}
        </span>
      </button>
      {open && (
        <div className="sg-detail">
          {sg.description && <div className="sg-detail-desc">{sg.description}</div>}
          <div className="sg-detail-cols">
            <div>
              <div className="sg-detail-title">Inbound · {sg.inbound.length} rules</div>
              <RuleTable rules={sg.inbound} />
            </div>
            <div>
              <div className="sg-detail-title">Outbound · {sg.outbound.length} rules</div>
              <RuleTable rules={sg.outbound} />
            </div>
          </div>
          {sg.attachedInstanceIds.length > 0 && (
            <div className="sg-attached">
              <div className="sg-detail-title">Attached to {sg.attachedInstanceIds.length} instance{sg.attachedInstanceIds.length === 1 ? "" : "s"}</div>
              <div className="sg-attached-list">
                {sg.attachedInstanceIds.slice(0, 30).map((id) => (
                  <a key={id} href={`/ec2#${id}`} className="sg-instance-chip mono small">{id}</a>
                ))}
                {sg.attachedInstanceIds.length > 30 && <span className="muted small">…and {sg.attachedInstanceIds.length - 30} more</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RuleTable({ rules }: { rules: SgRule[] }) {
  if (rules.length === 0) return <div className="muted small sg-rule-empty">No rules.</div>;
  return (
    <table className="sg-rule-table">
      <thead>
        <tr><th>Proto</th><th>Port</th><th>Source</th><th></th></tr>
      </thead>
      <tbody>
        {rules.map((r, i) => {
          const risky = r.flags.length > 0;
          const port = portLabel(r.fromPort, r.toPort, r.protocol);
          const portName = commonPortName(r.fromPort, r.toPort);
          const sources = [...r.cidr, ...r.cidr6, ...r.sgSources.map((s) => `sg:${s}`)];
          return (
            <tr key={i} className={risky ? "sg-rule-risky" : ""}>
              <td className="mono small">{protocolLabel(r.protocol)}</td>
              <td className="mono small">
                {port}
                {portName && <span className="sg-port-name"> {portName}</span>}
              </td>
              <td className="mono small">
                {sources.length === 0 ? "—" : sources.map((s, si) => (
                  <span key={si} className={`sg-src-chip ${s === "0.0.0.0/0" ? "sg-src-world" : ""}`}>{s}</span>
                ))}
              </td>
              <td>
                {r.flags.includes("wide-open") && <span className="sg-rule-flag sg-flag-crit">wide-open</span>}
                {r.flags.includes("risky-port") && <span className="sg-rule-flag sg-flag-warn">risky-port</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
