"use client";
import { useState } from "react";
import Link from "next/link";
import { useJson } from "@/components/useJson";
import { ErrorBox, Loading } from "@/components/Common";
import { FreshnessLine, useAutoRefresh } from "@/components/perf/AutoRefresh";
import TimeChart from "@/components/perf/TimeChart";

interface CwSeries { label: string; unit: string; points: Array<[number, number]> }
interface CwMetrics {
  readOps: CwSeries | null; writeOps: CwSeries | null;
  readBytes: CwSeries | null; writeBytes: CwSeries | null;
  queueLength: CwSeries | null; burstBalance: CwSeries | null;
  totalReadTimeSec: CwSeries | null; totalWriteTimeSec: CwSeries | null;
}
interface VolumeDetail {
  summary: {
    volumeId: string; region: string; az: string; size: number; type: string; state: string;
    encrypted: boolean; iops: number | null; throughput: number | null;
    attachedInstance: string | null; device: string | null; createTime: string | null; kmsKeyId: string | null;
  };
  snapshots: Array<{ snapshotId: string; startTime: string; state: string; description: string; progress: string; sizeGiB: number }>;
  cw: CwMetrics | null;
}

interface Resp { ok: boolean; fetchedAt: string; window: string; detail: VolumeDetail }

const WINDOWS = [
  { key: "1h", label: "Last 1h" },
  { key: "6h", label: "Last 6h" },
  { key: "24h", label: "Last 24h" },
] as const;

const fmtBytes = (n: number) => {
  if (n < 1024) return `${n.toFixed(0)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let v = n / 1024;
  for (const u of units) {
    if (v < 1024) return `${v.toFixed(1)} ${u}`;
    v /= 1024;
  }
  return `${v.toFixed(1)} PiB`;
};

export default function Page({ params }: { params: { id: string } }) {
  const [window, setWindow] = useState<"1h" | "6h" | "24h">("1h");
  const { data, error, loading, reload } = useJson<Resp>(`/api/perf/volumes/${params.id}?window=${window}`);
  useAutoRefresh(reload, 60_000);

  const detail = data?.detail;
  const cw = detail?.cw;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="note" style={{ marginBottom: 4 }}>
            <Link href="/perf/volumes">← EBS Volumes</Link>
          </p>
          <h1 className="page-title">{params.id}</h1>
          <p className="page-sub">
            {detail && <>{detail.summary.size} GiB · {detail.summary.type} · {detail.summary.az} · {detail.summary.state}</>}
          </p>
        </div>
        <div className="modetoggle">
          {WINDOWS.map((w) => (
            <button key={w.key} className={window === w.key ? "active" : ""} onClick={() => setWindow(w.key)}>{w.label}</button>
          ))}
        </div>
      </div>

      <FreshnessLine fetchedAt={data?.fetchedAt ?? null} loading={loading} intervalLabel="60s" />

      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}

      {detail && (
        <>
          <div className="card-row" style={{ marginBottom: 14 }}>
            <div className="card"><div className="card-label">Size</div><div className="card-value">{detail.summary.size} GiB</div></div>
            <div className="card"><div className="card-label">Type</div><div className="card-value">{detail.summary.type}</div></div>
            <div className="card"><div className="card-label">IOPS</div><div className="card-value">{detail.summary.iops ?? "-"}</div></div>
            <div className="card"><div className="card-label">Throughput</div><div className="card-value">{detail.summary.throughput ? `${detail.summary.throughput} MB/s` : "-"}</div></div>
            <div className="card">
              <div className="card-label">Attached</div>
              <div className="card-value" style={{ fontSize: 16 }}>
                {detail.summary.attachedInstance ? (
                  <Link href={`/perf/ec2/${detail.summary.attachedInstance}`} className="mono">{detail.summary.attachedInstance}</Link>
                ) : <span className="muted">unattached</span>}
                {detail.summary.device && <span className="muted" style={{ fontSize: 12 }}> ({detail.summary.device})</span>}
              </div>
            </div>
            <div className="card"><div className="card-label">Encrypted</div><div className="card-value" style={{ color: detail.summary.encrypted ? "#34d399" : "#f87171" }}>{detail.summary.encrypted ? "Yes" : "No"}</div></div>
          </div>

          <div className="panel">
            <h2>IOPS</h2>
            {cw?.readOps || cw?.writeOps ? (
              <TimeChart
                series={[
                  cw.readOps && { label: "read ops", points: cw.readOps.points },
                  cw.writeOps && { label: "write ops", points: cw.writeOps.points },
                ].filter(Boolean) as Array<{ label: string; points: Array<[number, number]> }>}
                yLabel="ops"
                formatY={(v) => v.toFixed(0)}
              />
            ) : <div className="empty">No IOPS data.</div>}
          </div>

          <div className="panel">
            <h2>Throughput</h2>
            {cw?.readBytes || cw?.writeBytes ? (
              <TimeChart
                series={[
                  cw.readBytes && { label: "read", points: cw.readBytes.points },
                  cw.writeBytes && { label: "write", points: cw.writeBytes.points },
                ].filter(Boolean) as Array<{ label: string; points: Array<[number, number]> }>}
                yLabel="bytes"
                formatY={fmtBytes}
              />
            ) : <div className="empty">No throughput data.</div>}
          </div>

          <div className="panel">
            <h2>Queue length</h2>
            {cw?.queueLength ? (
              <TimeChart series={[{ label: "queue", points: cw.queueLength.points }]} formatY={(v) => v.toFixed(2)} />
            ) : <div className="empty">No queue-length data.</div>}
          </div>

          {(detail.summary.type === "gp2" || detail.summary.type === "st1" || detail.summary.type === "sc1") && cw?.burstBalance && cw.burstBalance.points.length > 0 && (
            <div className="panel">
              <h2>Burst balance</h2>
              <TimeChart series={[{ label: "burst %", points: cw.burstBalance.points }]} yMax={100} formatY={(v) => `${v.toFixed(0)}%`} />
            </div>
          )}

          {detail.snapshots.length > 0 && (
            <div className="panel">
              <h2>Snapshots ({detail.snapshots.length})</h2>
              <table>
                <thead><tr><th>Snapshot</th><th>Taken</th><th>State</th><th>Progress</th><th>Size</th><th>Description</th></tr></thead>
                <tbody>
                  {detail.snapshots.map((s) => (
                    <tr key={s.snapshotId}>
                      <td className="mono">{s.snapshotId}</td>
                      <td>{s.startTime ? new Date(s.startTime).toLocaleString() : "-"}</td>
                      <td>{s.state}</td>
                      <td>{s.progress}</td>
                      <td>{s.sizeGiB} GiB</td>
                      <td className="muted" style={{ maxWidth: 400 }}>{s.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
