"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useJson } from "@/components/useJson";
import { ErrorBox, Loading, Empty } from "@/components/Common";
import RefreshButton from "@/components/RefreshButton";
import SnapshotBanner from "@/components/SnapshotBanner";

interface VolumeHealth {
  volumeId: string;
  region: string;
  az: string;
  size: number;
  type: string;
  state: string;
  encrypted: boolean;
  iops: number | null;
  throughput: number | null;
  attachedInstance: string | null;
  device: string | null;
  createTime: string | null;
}

interface Resp { ok: boolean; fetchedAt: string; volumes: VolumeHealth[]; }

const STATE_COLOR: Record<string, string> = {
  "in-use": "#34d399",
  available: "#f59e0b",
  creating: "#fbbf24",
  deleting: "#f87171",
  error: "#f87171",
};

export default function Page() {
  const { data, error, loading, reload } = useJson<Resp>("/api/perf/volumes");

  const [region, setRegion] = useState("");
  const [state, setState] = useState("");
  const [q, setQ] = useState("");

  const rows = data?.volumes ?? [];
  const regions = useMemo(() => Array.from(new Set(rows.map((r) => r.region))).sort(), [rows]);
  const states = useMemo(() => Array.from(new Set(rows.map((r) => r.state))).sort(), [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (region && r.region !== region) return false;
      if (state && r.state !== state) return false;
      if (needle) {
        const hay = `${r.volumeId} ${r.attachedInstance ?? ""} ${r.az}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, region, state, q]);

  const totalSize = rows.reduce((s, r) => s + r.size, 0);
  const unattached = rows.filter((r) => r.state === "available").length;
  const unencrypted = rows.filter((r) => !r.encrypted).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">EBS Volumes</h1>
          <p className="page-sub">
            Every EBS volume across all regions, served from the snapshot cache. Unattached volumes
            usually cost money for nothing — they're listed first.
          </p>
        </div>
        <RefreshButton sources={["ec2-volumes"]} onDone={reload} label="Refresh volumes" />
      </div>

      <SnapshotBanner capturedAt={data?.fetchedAt ?? null} label="Volumes snapshot" />

      <div className="card-row" style={{ marginBottom: 14 }}>
        <div className="card"><div className="card-label">Volumes</div><div className="card-value">{rows.length}</div></div>
        <div className="card"><div className="card-label">Total size</div><div className="card-value">{totalSize.toLocaleString()} GiB</div></div>
        <div className="card"><div className="card-label">Unattached</div><div className="card-value" style={{ color: unattached ? "#f59e0b" : "#34d399" }}>{unattached}</div></div>
        <div className="card"><div className="card-label">Unencrypted</div><div className="card-value" style={{ color: unencrypted ? "#f87171" : "#34d399" }}>{unencrypted}</div></div>
      </div>

      <div className="panel">
        <div className="filterbar">
          <input className="input" placeholder="Search volume / instance / AZ" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All regions</option>
            {regions.map((r) => <option key={r}>{r}</option>)}
          </select>
          <select className="input" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">All states</option>
            {states.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>

        {error ? <ErrorBox message={error} />
          : loading && !data ? <Loading />
            : filtered.length === 0 ? <Empty text="No volumes match." />
              : (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Volume ID</th>
                        <th>AZ</th>
                        <th>Size (GiB)</th>
                        <th>Type</th>
                        <th>IOPS</th>
                        <th>State</th>
                        <th>Encrypted</th>
                        <th>Attached Instance</th>
                        <th>Device</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr key={r.volumeId}>
                          <td><Link href={`/perf/volumes/${r.volumeId}`} className="mono">{r.volumeId}</Link></td>
                          <td className="mono">{r.az}</td>
                          <td>{r.size.toLocaleString()}</td>
                          <td>{r.type}</td>
                          <td>{r.iops ?? "-"}</td>
                          <td><span className="pill" style={{ borderColor: STATE_COLOR[r.state] ?? "#64748b", color: STATE_COLOR[r.state] ?? "#64748b" }}>{r.state}</span></td>
                          <td>{r.encrypted ? <span style={{ color: "#34d399" }}>✓</span> : <span style={{ color: "#f87171" }}>✗</span>}</td>
                          <td>{r.attachedInstance ? <Link href={`/perf/ec2/${r.attachedInstance}`} className="mono">{r.attachedInstance}</Link> : <span className="muted">-</span>}</td>
                          <td className="mono">{r.device ?? "-"}</td>
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
