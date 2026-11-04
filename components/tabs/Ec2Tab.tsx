"use client";
import { useMemo, useState, Fragment } from "react";
import Link from "next/link";
import { useJson } from "../useJson";
import IssueIcon, { type IssueBucket } from "../IssueIcon";
import { useMonthParam } from "../useMonth";
import { money } from "../format";
import { ErrorBox, Loading, Empty } from "../Common";
import FilterBar, { uniq } from "../FilterBar";
import type { InstanceAnalysisLite, Recommendation } from "../perf/Recommendations";
import InspectButton from "../InspectButton";
import CsvButton from "../CsvButton";
import { StatusPill } from "../perf/AutoRefresh";
import RefreshButton from "../RefreshButton";
import SnapshotAgeChip from "../SnapshotAgeChip";
import Ec2InstanceDetail from "../Ec2InstanceDetail";
import { ChevronRight } from "lucide-react";

const CPU_REC_KINDS = new Set(["cpu-upsize", "cpu-downsize", "rightsizing-downsize"]);

function pickCpuRec(recs: Recommendation[] | undefined): Recommendation | null {
  if (!recs?.length) return null;
  return recs.find((r) => CPU_REC_KINDS.has(r.kind)) ?? null;
}

function RightsizingCell({ rec, instanceId }: { rec: Recommendation | null | undefined; instanceId: string }) {
  if (rec === undefined) return <span className="muted">—</span>;
  if (rec === null) return <span className="rightsizing-ok" title="No CPU rightsizing action — utilization in range">OK</span>;
  const isUpgrade = rec.kind === "cpu-upsize";
  const cls = isUpgrade ? "rightsizing-up" : "rightsizing-down";
  const label = isUpgrade ? "Upgrade" : "Downgrade";
  const delta = rec.monthlyDeltaUsd;
  const deltaStr = delta !== undefined && delta !== 0
    ? (delta < 0 ? `saves $${Math.abs(delta).toFixed(0)}/mo` : `+$${delta.toFixed(0)}/mo`)
    : null;
  return (
    <Link href={`/perf/ec2/${instanceId}`} className={`rightsizing-pill ${cls}`} title={rec.message}>
      <span className="rs-arrow">{isUpgrade ? "↑" : "↓"}</span>
      <span className="rs-label">{label}</span>
      {rec.targetType && <span className="rs-target mono">{rec.targetType}</span>}
      {deltaStr && <span className="rs-delta">{deltaStr}</span>}
    </Link>
  );
}

interface Bucket { category: string; amount: number; count: number }
interface AllocRow {
  instanceId: string; name: string; region: string; type: string; state: string;
  category: string; matchedKey: string; publicIp: string; privateIp: string; vpcId: string;
  compute: number; dataTransfer: number; ebs: number; eip: number; other: number; total: number; unit: string;
}
interface AllocResp {
  mode?: string;
  month?: string | null;
  range14: { Start: string; End: string };
  monthRange: { Start: string; End: string };
  projectionFactor: number;
  daysInMonth: number;
  totals: { compute: number; dataTransfer: number; ebs: number; eip: number; unattributedEc2Other: number; total: number };
  buckets: Bucket[];
  rows: AllocRow[];
  monthEc2Total: number;
  monthTotalBill: number;
  taggedServers: number;
  stale?: boolean;
  asOf?: string;
}

interface InstanceHealth {
  instanceId: string;
  az: string;
  systemCheck: string;
  instanceCheck: string;
  overallOk: boolean;
  launchTime: string | null;
}
interface HealthResp { ok: boolean; fetchedAt: string; instances: InstanceHealth[] }

const CATEGORIES = ["2.0", "3.0", "Infra", "Dev", "Shared", "Not using", "Other"];
const CAT_COLORS: Record<string, string> = {
  "2.0": "#38bdf8", "3.0": "#a78bfa", Infra: "#f59e0b", Dev: "#f472b6",
  Shared: "#34d399", "Not using": "#64748b", Other: "#94a3b8",
  Unmapped: "#f87171", "Credits/Savings": "#22d3ee",
};

function CategoryPill({ category }: { category: string }) {
  const c = CAT_COLORS[category] ?? "#94a3b8";
  return <span className="pill" style={{ borderColor: c, color: c }}>{category}</span>;
}

export default function Ec2Tab() {
  const month = useMonthParam();
  // Default view is the CURRENT MONTH (month-to-date, real numbers) — not the
  // rolling 14-day window. The "14d" toggle is available as a drill-down for
  // anomaly investigations.
  const [view, setView] = useState<"month" | "14d">("month");
  const url = `/api/cost/allocation?mode=${view}${month ? `&month=${month}` : ""}`;
  const { data, error, loading, reload } = useJson<AllocResp>(url);
  const { data: issues } = useJson<{ ec2: Record<string, IssueBucket> }>("/api/issues/summary");
  const { data: perfRecs } = useJson<{ analyses: InstanceAnalysisLite[] }>("/api/perf/recommendations");
  // EC2 health snapshot — merged into the same table.
  const { data: healthResp, reload: reloadHealth } = useJson<HealthResp>("/api/perf/ec2");
  const healthByInstance = useMemo(() => {
    const m = new Map<string, InstanceHealth>();
    for (const h of healthResp?.instances ?? []) m.set(h.instanceId, h);
    return m;
  }, [healthResp]);

  const cpuRecByInstance = useMemo(() => {
    const map = new Map<string, Recommendation | null>();
    for (const a of perfRecs?.analyses ?? []) {
      map.set(a.instanceId, pickCpuRec(a.recommendations));
    }
    return map;
  }, [perfRecs]);

  const [editing, setEditing] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [region, setRegion] = useState("");
  const [vpc, setVpc] = useState("");
  const [state, setState] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [openInstance, setOpenInstance] = useState<string | null>(null);

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (region && r.region !== region) return false;
      if (vpc && r.vpcId !== vpc) return false;
      if (state && r.state !== state) return false;
      if (category && r.category !== category) return false;
      if (problemsOnly) {
        const h = healthByInstance.get(r.instanceId);
        if (!h || h.overallOk) return false;
      }
      if (needle) {
        const hay = `${r.name} ${r.instanceId} ${r.privateIp} ${r.publicIp} ${r.vpcId}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, region, vpc, state, category, q, problemsOnly, healthByInstance]);

  const cardBuckets = useMemo(() => {
    const sums: Record<string, number> = {};
    for (const r of filtered) sums[r.category] = (sums[r.category] ?? 0) + r.total;
    return sums;
  }, [filtered]);
  const shownTotal = useMemo(() => filtered.reduce((s, r) => s + r.total, 0), [filtered]);

  async function saveTag(row: AllocRow, cat: string) {
    setSavingKey(row.instanceId);
    setSaveError(null);
    try {
      const r = await fetch("/api/tags/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchKey: row.instanceId, category: cat,
          label: row.name !== "(unknown / terminated)" ? row.name : undefined,
          region: row.region !== "-" ? row.region : undefined,
          instanceType: row.type !== "-" ? row.type : undefined,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Save failed");
      setEditing(null);
      reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Empty text="No data." />;

  // The API is now called with mode={view}; the returned cost values are
  // already scoped to that mode (current-month MTD or last-14-day live).
  // No projection factor needed anymore.
  function Cost({ v, bold }: { v: number; bold?: boolean }) {
    if (v <= 0) return <span style={{ color: "var(--muted)" }}>—</span>;
    return <span className={bold ? "cost-actual-bold" : undefined}>{money(v)}</span>;
  }
  const monthLabel = (data.month ?? new Date().toISOString().slice(0, 7)) as string;

  return (
    <>
      {data.stale && (
        <div className="stale-banner">
          ⚠️ AWS session expired — showing the last saved snapshot
          {data.asOf ? ` from ${new Date(data.asOf).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST` : ""}.
          Cost (Compute, Data Transfer, EBS, Elastic IP) &amp; tags are from the DB; only live IP / VPC / state are hidden until you re-login.
        </div>
      )}
      <div className="cards">
        {(["2.0", "3.0", "Infra"] as const).map((cat) => (
          <div className="card kpi" key={cat}>
            <div className="label" style={{ color: CAT_COLORS[cat] }}>{cat}</div>
            <div className="value">{money(cardBuckets[cat] ?? 0)}</div>
          </div>
        ))}
        <div className="card kpi kpi-accent">
          <div className="label">{view === "month" ? `Total (MTD · ${monthLabel})` : "Total (last 14 days)"}</div>
          <div className="value">{money(shownTotal)}</div>
        </div>
      </div>

      {saveError && <ErrorBox message={saveError} />}

      <FilterBar
        selects={[
          { key: "region", label: "Region", value: region, options: uniq(rows, (r) => r.region), onChange: setRegion },
          { key: "vpc", label: "VPC", value: vpc, options: uniq(rows, (r) => r.vpcId), onChange: setVpc },
          { key: "state", label: "State", value: state, options: uniq(rows, (r) => r.state), onChange: setState },
          { key: "tag", label: "Tag", value: category, options: uniq(rows, (r) => r.category), onChange: setCategory },
        ]}
        search={{ value: q, onChange: setQ, placeholder: "Name, instance id, IP, VPC…" }}
        shown={filtered.length}
        total={rows.length}
        onReset={() => { setRegion(""); setVpc(""); setState(""); setCategory(""); setQ(""); setProblemsOnly(false); }}
      />
      <label className="ec2-problems-toggle">
        <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
        <span>Problems only</span>
        <span className="muted small">(failing AWS status checks)</span>
      </label>

      <div className="panel ec2-panel">
        <div className="ec2-panel-head">
          <div className="ec2-panel-title">
            <h2>EC2 — cost + health per server<SnapshotAgeChip source="ec2-health" /></h2>
            <div className="note ec2-panel-note">
              {view === "month"
                ? <>Showing <strong>current-month spend</strong> ({monthLabel}) — actual month-to-date per instance.</>
                : <>Showing <strong>last 14 days</strong> (live AWS resource-level query) — useful for spotting recent spikes.</>}
            </div>
          </div>
          <div className="ec2-panel-actions">
            <div className="modetoggle">
              <button className={view === "month" ? "active" : ""} onClick={() => setView("month")}>Current month</button>
              <button className={view === "14d" ? "active" : ""} onClick={() => setView("14d")}>Last 14 days</button>
            </div>
            <CsvButton
              rows={filtered}
              filename={`ec2-${view === "month" ? "month" : "14d"}.csv`}
              columns={[
                { key: "instanceId", label: "Instance ID" },
                { key: "name", label: "Name" },
                { key: "category", label: "Category" },
                { key: "region", label: "Region" },
                { key: "vpcId", label: "VPC" },
                { key: "type", label: "Type" },
                { key: "state", label: "State" },
                { key: "publicIp", label: "Public IP" },
                { key: "privateIp", label: "Private IP" },
                { key: "compute", label: "Compute (14d $)" },
                { key: "dataTransfer", label: "Data Transfer (14d $)" },
                { key: "ebs", label: "EBS (14d $)" },
                { key: "eip", label: "EIP (14d $)" },
                { key: "total", label: "Total (14d $)" },
              ]}
            />
            <RefreshButton sources={["ec2-health"]} onDone={reloadHealth} label="Refresh health" />
            <button className="refresh" onClick={reload} title="Refresh cost data">Refresh</button>
          </div>
        </div>

        <div className="ec2-table-scroll">
        <table className="ec2-merged-table">
          <colgroup>
            <col className="c-tag" />
            <col className="c-id" />
            <col className="c-name" />
            <col className="c-region" />
            <col className="c-vpc" />
            <col className="c-type" />
            <col className="c-state" />
            <col className="c-system" />
            <col className="c-instance" />
            <col className="c-num" />
            <col className="c-num" />
            <col className="c-num" />
            <col className="c-num" />
            <col className="c-total" />
            <col className="c-actions" />
            <col className="c-rec" />
          </colgroup>
          <thead>
            <tr>
              <th>Tag</th><th>Instance ID</th><th>Name</th><th>Region</th><th>VPC</th><th>Type</th><th>State</th>
              <th>System</th><th>Instance</th>
              <th className="num">Compute</th><th className="num">Data Transfer</th>
              <th className="num">EBS</th><th className="num">Elastic IP</th>
              <th className="num">Total</th>
              <th><span className="sr-only">Actions</span></th>
              <th>Rightsizing</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const isOpen = openInstance === r.instanceId;
              return (
              <Fragment key={r.instanceId}>
              <tr
                className={`ec2-row ${isOpen ? "ec2-row-open" : ""}`}
                onClick={(e) => {
                  const el = e.target as HTMLElement;
                  if (el.closest("button, a, select, input, .no-row-toggle")) return;
                  setOpenInstance(isOpen ? null : r.instanceId);
                }}
                style={{ cursor: "pointer" }}
              >
                <td>
                  <span className={`repo-caret ${isOpen ? "open" : ""}`} aria-hidden><ChevronRight size={13} /></span>
                  {editing === r.instanceId ? (
                    <select
                      className="tag-inline-select"
                      defaultValue={CATEGORIES.includes(r.category) ? r.category : "Other"}
                      disabled={savingKey === r.instanceId}
                      onChange={(e) => saveTag(r, e.target.value)}
                      autoFocus
                    >
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    <CategoryPill category={r.category} />
                  )}
                </td>
                <td className="mono">{r.instanceId}</td>
                <td>{r.name}<IssueIcon bucket={issues?.ec2?.[r.instanceId]} /></td>
                <td className="mono">{r.region}</td>
                <td className="mono">{r.vpcId}</td>
                <td>{r.type}</td>
                <td>
                  <span className={`pill ${r.state === "running" ? "running" : r.state === "stopped" ? "stopped" : ""}`}>{r.state}</span>
                </td>
                <td>{(() => {
                  const h = healthByInstance.get(r.instanceId);
                  if (!h) return <span className="muted">—</span>;
                  if (r.state !== "running") return <span className="muted">-</span>;
                  return <StatusPill ok={h.systemCheck === "ok"} label={h.systemCheck} />;
                })()}</td>
                <td>{(() => {
                  const h = healthByInstance.get(r.instanceId);
                  if (!h) return <span className="muted">—</span>;
                  if (r.state !== "running") return <span className="muted">-</span>;
                  return <StatusPill ok={h.instanceCheck === "ok"} label={h.instanceCheck} />;
                })()}</td>
                <td className="num"><Cost v={r.compute} /></td>
                <td className="num"><Cost v={r.dataTransfer} /></td>
                <td className="num"><Cost v={r.ebs} /></td>
                <td className="num"><Cost v={r.eip} /></td>
                <td className="num"><Cost v={r.total} bold /></td>
                <td className="row-actions">
                  {editing === r.instanceId ? (
                    <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                  ) : (
                    <>
                      <InspectButton
                        payload={{
                          kind: "ec2",
                          id: r.instanceId,
                          label: r.name,
                          region: r.region,
                          tag: r.category,
                          cost14d: r.total,
                          href: `/perf/ec2/${r.instanceId}`,
                          meta: {
                            Type: r.type,
                            State: r.state,
                            VPC: r.vpcId,
                            "Public IP": r.publicIp || "—",
                            "Private IP": r.privateIp || "—",
                            Compute: money(r.compute),
                            "Data Transfer": money(r.dataTransfer),
                            EBS: money(r.ebs),
                            "Elastic IP": money(r.eip),
                          },
                        }}
                      />
                      <button className="btn-ghost" onClick={() => { setSaveError(null); setEditing(r.instanceId); }}>Edit</button>
                    </>
                  )}
                </td>
                <td>
                  <RightsizingCell
                    rec={cpuRecByInstance.has(r.instanceId) ? cpuRecByInstance.get(r.instanceId) ?? null : undefined}
                    instanceId={r.instanceId}
                  />
                </td>
              </tr>
              {isOpen && (
                <tr className="repo-detail-row">
                  <td colSpan={16}>
                    <Ec2InstanceDetail
                      instanceId={r.instanceId}
                      name={r.name}
                      region={r.region}
                      publicIp={r.publicIp || null}
                      privateIp={r.privateIp || null}
                      onClose={() => setOpenInstance(null)}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
        {filtered.length === 0 && <Empty text="No instances match the current filters." />}
      </div>

      <div className="panel">
        <h2>Overall server cost — {view === "month" ? `${monthLabel} (MTD)` : "last 14 days"}</h2>
        <table className="table-min">
          <thead>
            <tr><th>Component</th><th className="num">{view === "month" ? `${monthLabel} MTD` : "Last 14 days"}</th></tr>
          </thead>
          <tbody>
            <tr><td>Compute (instance-hours)</td><td className="num">{money(data.totals.compute)}</td></tr>
            <tr><td>Data Transfer</td><td className="num">{money(data.totals.dataTransfer)}</td></tr>
            <tr><td>EBS storage</td><td className="num">{money(data.totals.ebs)}</td></tr>
            <tr><td>Elastic IP / Public IPv4</td><td className="num">{money(data.totals.eip)}</td></tr>
          </tbody>
          <tfoot>
            <tr>
              <td><strong>All servers total</strong></td>
              <td className="num"><strong>{money(data.totals.total)}</strong></td>
            </tr>
          </tfoot>
        </table>
        <div className="note">
          Full EC2 cost for {data.monthRange.Start.slice(0, 7)} (Compute + EC2-Other from Cost Explorer):{" "}
          <strong>{money(data.monthEc2Total)}</strong>. Unattributed EC2-Other (no instance link):{" "}
          {money(data.totals.unattributedEc2Other)}.
        </div>
      </div>
    </>
  );
}
