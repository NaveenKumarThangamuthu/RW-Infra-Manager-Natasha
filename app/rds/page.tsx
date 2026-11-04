"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useJson } from "@/components/useJson";
import { ErrorBox, Loading, Empty } from "@/components/Common";
import {
  RefreshCw, Database, Globe, Lock, Copy, HardDrive,
  Search, ChevronDown, ChevronRight, Cpu, Plug, Archive, LineChart,
} from "lucide-react";

type RdsFlag =
  | "publicly-accessible" | "unencrypted" | "no-multi-az"
  | "backup-disabled" | "no-deletion-protect" | "storage-pressure" | "stopped";

type Metrics = {
  cpuAvg: number | null; cpuMax: number | null; connectionsAvg: number | null;
  freeStorageBytes: number | null; freeStoragePct: number | null;
};
type Instance = {
  id: string; region: string; engine: string; engineVersion: string;
  instanceClass: string; status: string; multiAz: boolean;
  publiclyAccessible: boolean; storageEncrypted: boolean;
  allocatedStorageGb: number | null; storageType: string | null;
  backupRetentionDays: number | null; deletionProtection: boolean;
  endpoint: string | null; port: number | null; vpcId: string | null;
  clusterId: string | null; createdAt: string | null;
  tags: Record<string, string>; metrics: Metrics;
  flags: RdsFlag[]; worstFlag: RdsFlag | null;
};
type Cluster = {
  id: string; region: string; engine: string; engineVersion: string;
  status: string; multiAz: boolean; storageEncrypted: boolean;
  backupRetentionDays: number | null; deletionProtection: boolean;
  endpoint: string | null; readerEndpoint: string | null; memberIds: string[];
};
type Inventory = {
  fetchedAt: string; regions: string[];
  totalInstances: number; totalClusters: number;
  publicCount: number; unencryptedCount: number; singleAzCount: number;
  noBackupCount: number; stoppedCount: number;
  instances: Instance[]; clusters: Cluster[];
  regionErrors: { region: string; error: string }[];
};
type Resp = { ok: boolean; inventory: Inventory; error?: string };

type Filter = "all" | "public" | "unencrypted" | "single-az" | "no-backup" | "stopped";

const FLAG_LABEL: Record<RdsFlag, string> = {
  "publicly-accessible": "Public",
  "unencrypted": "Unencrypted",
  "no-multi-az": "Single-AZ",
  "backup-disabled": "No backups",
  "no-deletion-protect": "No delete-protect",
  "storage-pressure": "Low storage",
  "stopped": "Stopped",
};

function gb(bytes: number | null): string {
  if (bytes == null) return "—";
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
function pct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)}%`;
}

export default function RdsPage() {
  const { data, error, reload } = useJson<Resp>("/api/rds");
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  async function forceRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetch("/api/rds?refresh=1");
      reload();
    } finally { setRefreshing(false); }
  }

  const filtered = useMemo(() => {
    if (!data?.inventory?.instances) return [];
    const q = search.trim().toLowerCase();
    return data.inventory.instances.filter((i) => {
      if (filter === "public" && !i.publiclyAccessible) return false;
      if (filter === "unencrypted" && i.storageEncrypted) return false;
      if (filter === "single-az" && i.multiAz) return false;
      if (filter === "no-backup" && i.backupRetentionDays) return false;
      if (filter === "stopped" && i.status !== "stopped") return false;
      if (q) {
        return (
          i.id.toLowerCase().includes(q) ||
          i.engine.toLowerCase().includes(q) ||
          i.instanceClass.toLowerCase().includes(q) ||
          i.region.includes(q) ||
          (i.endpoint ?? "").toLowerCase().includes(q) ||
          (i.clusterId ?? "").toLowerCase().includes(q)
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
      <div className="sg-hero">
        <div className="sg-hero-glow-a" />
        <div className="sg-hero-glow-b" />
        <div className="sg-hero-inner">
          <div className="sg-hero-title-row">
            <div>
              <div className="sg-hero-eyebrow"><Database size={12} /> AWS RDS</div>
              <h1 className="sg-hero-title"><span className="sg-hero-title-grad">Managed</span> Databases</h1>
              <p className="sg-hero-subline">
                {inv.totalInstances} instance{inv.totalInstances === 1 ? "" : "s"}
                {inv.totalClusters > 0 && ` · ${inv.totalClusters} cluster${inv.totalClusters === 1 ? "" : "s"}`}
                {" "}across {inv.regions.length} regions ·
                last fetched {new Date(inv.fetchedAt).toLocaleTimeString()}
              </p>
            </div>
            <button className="btn primary sg-refresh-btn" onClick={forceRefresh} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? "spin" : ""} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          <div className="sg-kpi-row">
            <div className="sg-kpi sg-kpi-total">
              <div className="sg-kpi-ico"><Database size={14} /></div>
              <div className="sg-kpi-body"><div className="sg-kpi-val">{inv.totalInstances}</div><div className="sg-kpi-lbl">Instances</div></div>
            </div>
            <div className={`sg-kpi sg-kpi-wide ${inv.publicCount > 0 ? "hot" : ""}`}>
              <div className="sg-kpi-ico"><Globe size={14} /></div>
              <div className="sg-kpi-body"><div className="sg-kpi-val">{inv.publicCount}</div><div className="sg-kpi-lbl">Publicly accessible</div></div>
            </div>
            <div className={`sg-kpi sg-kpi-risky ${inv.unencryptedCount > 0 ? "warm" : ""}`}>
              <div className="sg-kpi-ico"><Lock size={14} /></div>
              <div className="sg-kpi-body"><div className="sg-kpi-val">{inv.unencryptedCount}</div><div className="sg-kpi-lbl">Unencrypted at rest</div></div>
            </div>
            <div className={`sg-kpi sg-kpi-risky ${inv.noBackupCount > 0 ? "warm" : ""}`}>
              <div className="sg-kpi-ico"><Archive size={14} /></div>
              <div className="sg-kpi-body"><div className="sg-kpi-val">{inv.noBackupCount}</div><div className="sg-kpi-lbl">No automated backups</div></div>
            </div>
            <div className="sg-kpi sg-kpi-unused">
              <div className="sg-kpi-ico"><Copy size={14} /></div>
              <div className="sg-kpi-body"><div className="sg-kpi-val">{inv.singleAzCount}</div><div className="sg-kpi-lbl">Single-AZ</div></div>
            </div>
          </div>

          {(inv.publicCount > 0 || inv.unencryptedCount > 0 || inv.noBackupCount > 0) && (
            <div className="sg-fable">
              <div className="sg-fable-head">🚨 Fable insight <span className="sg-fable-model">claude-fable-5</span></div>
              <div className="sg-fable-body">
                {inv.publicCount > 0
                  ? `${inv.publicCount} database${inv.publicCount === 1 ? " is" : "s are"} publicly accessible — reachable from outside the VPC. Unless this is deliberate, move them to private subnets and reach them through a bastion or VPN.`
                  : inv.noBackupCount > 0
                  ? `${inv.noBackupCount} database${inv.noBackupCount === 1 ? " has" : "s have"} automated backups disabled. There is no point-in-time recovery for these — a bad migration or deletion is unrecoverable.`
                  : `${inv.unencryptedCount} database${inv.unencryptedCount === 1 ? " is" : "s are"} unencrypted at rest. Encryption cannot be enabled in place — it needs a snapshot, copy-with-encryption, and restore.`}
              </div>
            </div>
          )}

          {inv.regionErrors.length > 0 && (
            <div className="sg-fable" style={{ borderLeftColor: "#c2621b" }}>
              <div className="sg-fable-head">⚠️ Partial result</div>
              <div className="sg-fable-body">
                {inv.regionErrors.length} region{inv.regionErrors.length === 1 ? "" : "s"} could not be queried
                ({inv.regionErrors.map((r) => r.region).join(", ")}). Counts above exclude them —
                this is not the same as those regions having no databases.
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="sg-toolbar">
        <div className="sg-search">
          <Search size={14} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by identifier, engine, class, endpoint, region…" />
        </div>
        <div className="sg-filter-chips">
          {(["all", "public", "unencrypted", "no-backup", "single-az", "stopped"] as const).map((f) => {
            const n = f === "all" ? inv.totalInstances :
                      f === "public" ? inv.publicCount :
                      f === "unencrypted" ? inv.unencryptedCount :
                      f === "no-backup" ? inv.noBackupCount :
                      f === "single-az" ? inv.singleAzCount : inv.stoppedCount;
            const label = f === "all" ? "All" :
                          f === "public" ? "Public" :
                          f === "unencrypted" ? "Unencrypted" :
                          f === "no-backup" ? "No backups" :
                          f === "single-az" ? "Single-AZ" : "Stopped";
            return (
              <button key={f} className={`sg-chip sg-chip-${f === "public" ? "wide-open" : f === "all" ? "all" : "risky"} ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
                {label} <span className="sg-chip-count">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="sg-list">
        {filtered.length === 0 && <Empty text="No databases match the current filter." />}
        {filtered.map((db) => {
          const key = `${db.region}-${db.id}`;
          return (
            <DbRow key={key} db={db} open={openId === key} onToggle={() => setOpenId(openId === key ? null : key)} />
          );
        })}
      </div>

      {inv.clusters.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, margin: "22px 0 10px" }}>Clusters ({inv.clusters.length})</h2>
          <div className="sg-list">
            {inv.clusters.map((c) => (
              <div key={`${c.region}-${c.id}`} className="sg-row">
                <div className="sg-row-head" style={{ cursor: "default" }}>
                  <div className="sg-row-main">
                    <div className="sg-row-name">{c.id}</div>
                    <div className="sg-row-sub">
                      {c.engine} {c.engineVersion} · {c.region} · {c.memberIds.length} member{c.memberIds.length === 1 ? "" : "s"}
                      {c.endpoint && ` · ${c.endpoint}`}
                    </div>
                  </div>
                  <div className="sg-row-badges">
                    <span className={`sg-badge ${c.status === "available" ? "" : "warn"}`}>{c.status}</span>
                    {!c.storageEncrypted && <span className="sg-badge risky">Unencrypted</span>}
                    {!c.backupRetentionDays && <span className="sg-badge risky">No backups</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DbRow({ db, open, onToggle }: { db: Instance; open: boolean; onToggle: () => void }) {
  const m = db.metrics;
  return (
    <div className="sg-row">
      <div className="sg-row-head" onClick={onToggle}>
        <div className="sg-row-chev">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</div>
        <div className="sg-row-main">
          <div className="sg-row-name">{db.id}</div>
          <div className="sg-row-sub">
            {db.engine} {db.engineVersion} · {db.instanceClass} · {db.region}
            {db.allocatedStorageGb != null && ` · ${db.allocatedStorageGb} GB ${db.storageType ?? ""}`}
          </div>
        </div>
        <div className="sg-row-metrics" style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 12 }}>
          <span title="24h average CPU"><Cpu size={12} /> {pct(m.cpuAvg)}</span>
          <span title="24h average connections"><Plug size={12} /> {m.connectionsAvg != null ? m.connectionsAvg.toFixed(0) : "—"}</span>
          <span title="Free storage"><HardDrive size={12} /> {pct(m.freeStoragePct)}</span>
        </div>
        <div className="sg-row-badges">
          <span className={`sg-badge ${db.status === "available" ? "" : "warn"}`}>{db.status}</span>
          {db.worstFlag && <span className="sg-badge risky">{FLAG_LABEL[db.worstFlag]}</span>}
        </div>
      </div>

      {open && (
        <div className="sg-row-body">
          <table className="sg-rule-table">
            <tbody>
              <tr><td>Endpoint</td><td className="mono">{db.endpoint ? `${db.endpoint}:${db.port ?? ""}` : "—"}</td></tr>
              <tr><td>VPC</td><td className="mono">{db.vpcId ?? "—"}</td></tr>
              <tr><td>Cluster</td><td className="mono">{db.clusterId ?? "— (standalone)"}</td></tr>
              <tr><td>Multi-AZ</td><td>{db.multiAz ? "Yes" : "No — a zone failure takes this database offline"}</td></tr>
              <tr><td>Publicly accessible</td><td>{db.publiclyAccessible ? "Yes — reachable outside the VPC" : "No"}</td></tr>
              <tr><td>Encrypted at rest</td><td>{db.storageEncrypted ? "Yes" : "No"}</td></tr>
              <tr><td>Backup retention</td><td>{db.backupRetentionDays ? `${db.backupRetentionDays} days` : "Disabled — no point-in-time recovery"}</td></tr>
              <tr><td>Deletion protection</td><td>{db.deletionProtection ? "On" : "Off"}</td></tr>
              <tr><td>Free storage</td><td>{gb(m.freeStorageBytes)} ({pct(m.freeStoragePct)} of allocated)</td></tr>
              <tr><td>CPU 24h</td><td>avg {pct(m.cpuAvg)} · peak {pct(m.cpuMax)}</td></tr>
              <tr><td>Created</td><td>{db.createdAt ? new Date(db.createdAt).toLocaleDateString() : "—"}</td></tr>
              {Object.keys(db.tags).length > 0 && (
                <tr><td>Tags</td><td className="mono">{Object.entries(db.tags).map(([k, v]) => `${k}=${v}`).join(" · ")}</td></tr>
              )}
            </tbody>
          </table>
          <Link
            href={`/rds/${encodeURIComponent(db.id)}?region=${encodeURIComponent(db.region)}`}
            className="btn primary"
            style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <LineChart size={14} /> Performance &amp; issues
          </Link>
        </div>
      )}
    </div>
  );
}
