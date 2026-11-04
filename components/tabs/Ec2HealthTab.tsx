"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useJson } from "@/components/useJson";
import { ErrorBox, Loading, Empty } from "@/components/Common";
import { StatusPill } from "@/components/perf/AutoRefresh";
import RefreshButton from "@/components/RefreshButton";
import SnapshotBanner from "@/components/SnapshotBanner";
import IssueIcon, { type IssueBucket } from "@/components/IssueIcon";

interface InstanceHealth {
  instanceId: string;
  name: string;
  region: string;
  az: string;
  type: string;
  state: string;
  publicIp: string | null;
  privateIp: string | null;
  launchTime: string | null;
  systemCheck: string;
  instanceCheck: string;
  overallOk: boolean;
}

interface Resp { ok: boolean; fetchedAt: string; instances: InstanceHealth[]; }

const STATE_COLOR: Record<string, string> = {
  running: "#34d399",
  stopped: "#64748b",
  stopping: "#fbbf24",
  pending: "#fbbf24",
  terminated: "#f87171",
};

export default function Ec2HealthTab() {
  const { data, error, loading, reload } = useJson<Resp>("/api/perf/ec2");
  const { data: issues } = useJson<{ ec2: Record<string, IssueBucket> }>("/api/issues/summary");

  const [region, setRegion] = useState("");
  const [state, setState] = useState("");
  const [showOnlyProblems, setShowOnlyProblems] = useState(false);
  const [q, setQ] = useState("");

  const rows = data?.instances ?? [];
  const regions = useMemo(() => Array.from(new Set(rows.map((r) => r.region))).sort(), [rows]);
  const states = useMemo(() => Array.from(new Set(rows.map((r) => r.state))).sort(), [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (region && r.region !== region) return false;
      if (state && r.state !== state) return false;
      if (showOnlyProblems && r.overallOk) return false;
      if (needle) {
        const hay = `${r.name} ${r.instanceId} ${r.publicIp ?? ""} ${r.privateIp ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, region, state, showOnlyProblems, q]);

  const running = rows.filter((r) => r.state === "running").length;
  const problems = rows.filter((r) => r.state === "running" && !r.overallOk).length;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <SnapshotBanner capturedAt={data?.fetchedAt ?? null} label="EC2 health snapshot" />
        <RefreshButton sources={["ec2-health"]} onDone={reload} label="Refresh EC2 health" />
      </div>

      <div className="card-row" style={{ marginBottom: 14 }}>
        <div className="card"><div className="card-label">Total</div><div className="card-value">{rows.length}</div></div>
        <div className="card"><div className="card-label">Running</div><div className="card-value" style={{ color: "#34d399" }}>{running}</div></div>
        <div className="card"><div className="card-label">Failing checks</div><div className="card-value" style={{ color: problems ? "#f87171" : "#34d399" }}>{problems}</div></div>
      </div>

      <div className="panel">
        <div className="filterbar">
          <input className="input" placeholder="Search name / ID / IP" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All regions</option>
            {regions.map((r) => <option key={r}>{r}</option>)}
          </select>
          <select className="input" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">All states</option>
            {states.map((s) => <option key={s}>{s}</option>)}
          </select>
          <label className="note" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={showOnlyProblems} onChange={(e) => setShowOnlyProblems(e.target.checked)} />
            Problems only
          </label>
        </div>

        {error ? <ErrorBox message={error} />
          : loading && !data ? <Loading />
            : filtered.length === 0 ? <Empty text="No instances match." />
              : (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Instance ID</th>
                        <th>Region / AZ</th>
                        <th>Type</th>
                        <th>State</th>
                        <th>System</th>
                        <th>Instance</th>
                        <th>Public IP</th>
                        <th>Private IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr key={r.instanceId}>
                          <td>
                            <Link href={`/perf/ec2/${r.instanceId}`}>{r.name}</Link>
                            <IssueIcon bucket={issues?.ec2?.[r.instanceId]} />
                          </td>
                          <td><Link href={`/perf/ec2/${r.instanceId}`} className="mono">{r.instanceId}</Link></td>
                          <td className="mono">{r.az}</td>
                          <td>{r.type}</td>
                          <td><span className="pill" style={{ borderColor: STATE_COLOR[r.state] ?? "#64748b", color: STATE_COLOR[r.state] ?? "#64748b" }}>{r.state}</span></td>
                          <td>{r.state === "running" ? <StatusPill ok={r.systemCheck === "ok"} label={r.systemCheck} /> : <span className="muted">-</span>}</td>
                          <td>{r.state === "running" ? <StatusPill ok={r.instanceCheck === "ok"} label={r.instanceCheck} /> : <span className="muted">-</span>}</td>
                          <td className="mono">{r.publicIp ?? "-"}</td>
                          <td className="mono">{r.privateIp ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
      </div>
    </>
  );
}
