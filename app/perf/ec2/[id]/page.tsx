"use client";
import { useState } from "react";
import Link from "next/link";
import { useJson } from "@/components/useJson";
import { ErrorBox, Loading } from "@/components/Common";
import { FreshnessLine, StatusPill, useAutoRefresh } from "@/components/perf/AutoRefresh";
import TimeChart from "@/components/perf/TimeChart";
import { RecommendationList, type Recommendation } from "@/components/perf/Recommendations";

interface Series { label: string; points: Array<[number, number]> }
interface HostMetrics {
  scrapedBy: string;
  cpuPct: Series[];
  memUsedPct: Series[];
  memUsedBytes: Series[];
  memTotalBytes: number | null;
  load: Series[];
  diskByMount: Series[];
  netIn: Series[];
  netOut: Series[];
}
interface CwSeries { label: string; unit: string; points: Array<[number, number]> }
interface CwMetrics {
  cpuUtilization: CwSeries | null;
  networkIn: CwSeries | null;
  networkOut: CwSeries | null;
  diskReadBytes: CwSeries | null;
  diskWriteBytes: CwSeries | null;
  statusCheckFailed: CwSeries | null;
}
interface InstanceDetail {
  summary: {
    instanceId: string; name: string; region: string; az: string; type: string; state: string;
    publicIp: string | null; privateIp: string | null; vpcId: string | null; subnetId: string | null;
    imageId: string | null; launchTime: string | null; tags: Record<string, string>;
    systemCheck: string; instanceCheck: string;
  };
  volumes: Array<{ volumeId: string; size: number; type: string; device: string; state: string }>;
  snapshots: Array<{ snapshotId: string; volumeId: string; startTime: string; state: string; description: string; sizeGiB: number }>;
  source: "prometheus" | "cloudwatch";
  promTarget: string | null;
  host: HostMetrics | null;
  cw: CwMetrics | null;
}

interface Resp { ok: boolean; fetchedAt: string; window: string; detail: InstanceDetail }
interface ConsoleResp { ok: boolean; fetchedAt: string; timestamp: string | null; output: string }

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
const fmtBps = (n: number) => `${fmtBytes(n)}/s`;

export default function Page({ params }: { params: { id: string } }) {
  const [window, setWindow] = useState<"1h" | "6h" | "24h">("1h");
  const { data, error, loading, reload } = useJson<Resp>(`/api/perf/ec2/${params.id}?window=${window}`);
  useAutoRefresh(reload, 60_000);

  const detail = data?.detail;
  const host = detail?.host ?? null;
  const cw = detail?.cw ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="note" style={{ marginBottom: 4 }}>
            <Link href="/perf/ec2">← EC2 Health</Link>
          </p>
          <h1 className="page-title">
            {detail?.summary.name ?? params.id}
          </h1>
          <p className="page-sub">
            <span className="mono">{params.id}</span>
            {detail && <> · {detail.summary.type} · {detail.summary.az} · {detail.summary.state}</>}
            {detail && (
              <span className="pill" style={{ marginLeft: 10, borderColor: detail.source === "prometheus" ? "#34d399" : "#f59e0b", color: detail.source === "prometheus" ? "#34d399" : "#f59e0b" }}>
                via {detail.source}
              </span>
            )}
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
          <RecPanel instanceId={params.id} />
          {/* Summary cards */}
          <div className="card-row" style={{ marginBottom: 14 }}>
            <div className="card">
              <div className="card-label">State</div>
              <div className="card-value">{detail.summary.state}</div>
            </div>
            <div className="card">
              <div className="card-label">System check</div>
              <div className="card-value">
                {detail.summary.state === "running" ? <StatusPill ok={detail.summary.systemCheck === "ok"} label={detail.summary.systemCheck} /> : "-"}
              </div>
            </div>
            <div className="card">
              <div className="card-label">Instance check</div>
              <div className="card-value">
                {detail.summary.state === "running" ? <StatusPill ok={detail.summary.instanceCheck === "ok"} label={detail.summary.instanceCheck} /> : "-"}
              </div>
            </div>
            <div className="card">
              <div className="card-label">Public IP</div>
              <div className="card-value mono" style={{ fontSize: 18 }}>{detail.summary.publicIp ?? "-"}</div>
            </div>
            <div className="card">
              <div className="card-label">Private IP</div>
              <div className="card-value mono" style={{ fontSize: 18 }}>{detail.summary.privateIp ?? "-"}</div>
            </div>
          </div>

          {/* CPU */}
          <div className="panel">
            <h2>CPU</h2>
            {host && host.cpuPct.length > 0 ? (
              <TimeChart series={host.cpuPct.map((s) => ({ ...s, label: "CPU %" }))} yLabel="%" yMax={100} formatY={(v) => `${v.toFixed(0)}%`} />
            ) : cw?.cpuUtilization ? (
              <TimeChart series={[{ label: "CPU %", points: cw.cpuUtilization.points }]} yLabel="%" yMax={100} formatY={(v) => `${v.toFixed(0)}%`} />
            ) : <div className="empty">No CPU data.</div>}
            {host && host.load.length > 0 && (
              <>
                <h2 style={{ marginTop: 18 }}>Load average</h2>
                <TimeChart series={host.load} yLabel="load" formatY={(v) => v.toFixed(2)} />
              </>
            )}
          </div>

          {/* Memory */}
          {host && host.memUsedPct.length > 0 && (
            <div className="panel">
              <h2>Memory</h2>
              <p className="note" style={{ marginTop: 0 }}>
                Total: {host.memTotalBytes ? fmtBytes(host.memTotalBytes) : "-"}
              </p>
              <TimeChart series={host.memUsedPct.map((s) => ({ ...s, label: "used %" }))} yLabel="%" yMax={100} formatY={(v) => `${v.toFixed(0)}%`} />
            </div>
          )}

          {/* Disk filesystems */}
          {host && host.diskByMount.length > 0 && (
            <div className="panel">
              <h2>Disk usage by mount</h2>
              <TimeChart series={host.diskByMount} yLabel="%" yMax={100} formatY={(v) => `${v.toFixed(0)}%`} />
            </div>
          )}

          {/* Network */}
          <div className="panel">
            <h2>Network</h2>
            {host && host.netIn.length > 0 ? (
              <>
                <p className="note" style={{ marginTop: 0 }}>In</p>
                <TimeChart series={host.netIn} yLabel="bytes/s" formatY={fmtBytes} />
                <p className="note" style={{ marginTop: 12 }}>Out</p>
                <TimeChart series={host.netOut} yLabel="bytes/s" formatY={fmtBytes} />
              </>
            ) : cw?.networkIn && cw?.networkOut ? (
              <TimeChart
                series={[
                  { label: "in", points: cw.networkIn.points },
                  { label: "out", points: cw.networkOut.points },
                ]}
                yLabel="bytes"
                formatY={fmtBytes}
              />
            ) : <div className="empty">No network data.</div>}
          </div>

          {/* Attached volumes */}
          {detail.volumes.length > 0 && (
            <div className="panel">
              <h2>Attached volumes</h2>
              <table>
                <thead><tr><th>Volume</th><th>Device</th><th>Size</th><th>Type</th><th>State</th></tr></thead>
                <tbody>
                  {detail.volumes.map((v) => (
                    <tr key={v.volumeId}>
                      <td><Link href={`/perf/volumes/${v.volumeId}`} className="mono">{v.volumeId}</Link></td>
                      <td className="mono">{v.device}</td>
                      <td>{v.size} GiB</td>
                      <td>{v.type}</td>
                      <td>{v.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Snapshots */}
          {detail.snapshots.length > 0 && (
            <div className="panel">
              <h2>Recent snapshots</h2>
              <table>
                <thead><tr><th>Snapshot</th><th>Volume</th><th>Taken</th><th>State</th><th>Size</th><th>Description</th></tr></thead>
                <tbody>
                  {detail.snapshots.map((s) => (
                    <tr key={s.snapshotId}>
                      <td className="mono">{s.snapshotId}</td>
                      <td className="mono">{s.volumeId}</td>
                      <td>{s.startTime ? new Date(s.startTime).toLocaleString() : "-"}</td>
                      <td>{s.state}</td>
                      <td>{s.sizeGiB} GiB</td>
                      <td className="muted" style={{ maxWidth: 400 }}>{s.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <ConsolePanel instanceId={params.id} />
        </>
      )}
    </>
  );
}

interface RecResp {
  ok: boolean;
  fetchedAt: string;
  analysis: {
    cpuAvg24h: number | null; cpuP95_24h: number | null;
    memAvg24h: number | null; diskMaxPct: number | null;
    creditBalancePct: number | null;
    recommendations: Recommendation[];
  };
}

function RecPanel({ instanceId }: { instanceId: string }) {
  const { data, error, loading } = useJson<RecResp>(`/api/perf/ec2/${instanceId}/recommend`);
  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <h2 style={{ marginTop: 0 }}>Recommendations <span className="note">(24h analysis)</span></h2>
      {error ? <ErrorBox message={error} />
        : loading && !data ? <Loading />
          : data?.analysis ? (
            <>
              <div className="note" style={{ marginBottom: 10 }}>
                CPU avg {data.analysis.cpuAvg24h?.toFixed(0) ?? "-"}%
                {" · "}p95 {data.analysis.cpuP95_24h?.toFixed(0) ?? "-"}%
                {data.analysis.memAvg24h !== null && <> · Mem avg {data.analysis.memAvg24h.toFixed(0)}%</>}
                {data.analysis.diskMaxPct !== null && <> · Disk max {data.analysis.diskMaxPct.toFixed(0)}%</>}
                {data.analysis.creditBalancePct !== null && <> · Credits min {data.analysis.creditBalancePct.toFixed(0)}%</>}
              </div>
              <RecommendationList recs={data.analysis.recommendations} />
            </>
          ) : null}
    </div>
  );
}

function ConsolePanel({ instanceId }: { instanceId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel">
      <h2>Console output</h2>
      {open
        ? <LoadedConsole instanceId={instanceId} />
        : <button className="input" onClick={() => setOpen(true)}>Load console output (~64 KB)</button>}
    </div>
  );
}

function LoadedConsole({ instanceId }: { instanceId: string }) {
  const { data, error, loading, reload } = useJson<ConsoleResp>(`/api/perf/ec2/${instanceId}/console`);
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <p className="note" style={{ margin: 0 }}>
          {data?.timestamp ? `Captured ${new Date(data.timestamp).toLocaleString()}` : "Fetching latest console..."}
        </p>
        <button className="input" style={{ minWidth: 80, padding: "4px 10px" }} onClick={reload} disabled={loading}>
          {loading ? "…" : "Refresh"}
        </button>
      </div>
      {error ? <ErrorBox message={error} />
        : loading && !data ? <Loading />
          : data?.output ? (
            <pre className="mono" style={{ background: "#0a0f1c", padding: 12, borderRadius: 8, maxHeight: 480, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11.5 }}>
              {data.output}
            </pre>
          ) : <div className="empty">No console output available (instance may be stopped or not booted).</div>}
    </>
  );
}
