"use client";
import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useJson } from "@/components/useJson";
import { ErrorBox, Loading } from "@/components/Common";
import TimeChart from "@/components/perf/TimeChart";
import {
  RefreshCw, ArrowLeft, Cpu, Plug, MemoryStick, HardDrive, Activity,
  Gauge, Network, AlertOctagon, AlertTriangle, Info, CheckCircle2, Zap,
  Search, Database,
} from "lucide-react";

type Series = { label: string; unit: string; points: Array<[number, number]> };
type Stat = { avg: number | null; max: number | null; min: number | null; last: number | null };
type Issue = { severity: "critical" | "warning" | "info"; title: string; evidence: string; action: string };
type Perf = {
  id: string; region: string; windowHours: number; fetchedAt: string;
  engine: string; engineVersion: string; instanceClass: string; status: string;
  allocatedStorageGb: number | null; multiAz: boolean; vcpu: number | null; burstable: boolean;
  series: Record<string, Series | null>;
  stats: Record<string, Stat>;
  issues: Issue[];
  health: "healthy" | "attention" | "critical";
};
type Resp = { ok: boolean; perf: Perf; error?: string };

type TopQuery = {
  rank: number; digestText: string; countStar: number;
  sumRowsExamined: number; sumRowsSent: number; seconds: number;
  rowsExaminedPerCall: number; examinedPerSent: number | null;
  avgLatencyMs: number; noIndexUsedCount: number; fullScanRatio: number | null;
};
type QueryIssue = Issue & { digestText?: string };
type Insights = {
  available: boolean; reason?: string; remedy?: string;
  fetchedAt: string; instanceId: string;
  queries: TopQuery[]; issues: QueryIssue[];
  performanceSchemaEnabled?: boolean;
};
type QResp = { ok: boolean; insights: Insights; error?: string };

const n0 = (v: number) => Math.round(v).toLocaleString();

const GB = 1024 ** 3;
const MB = 1024 ** 2;

const pctFmt = (v: number) => `${v.toFixed(0)}%`;
const msFmt = (v: number) => `${(v * 1000).toFixed(0)}ms`;
const gbFmt = (v: number) => `${(v / GB).toFixed(1)}GB`;
const mbFmt = (v: number) => `${(v / MB).toFixed(0)}MB`;
const numFmt = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0));
const mbpsFmt = (v: number) => `${(v / MB).toFixed(2)}MB/s`;
const timeFmt = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function Panel({
  title, icon, series, color, formatY, yMax, foot,
}: {
  title: string; icon: React.ReactNode; series: Series | null;
  color: string; formatY: (v: number) => string; yMax?: number; foot?: string;
}) {
  return (
    <div className="sg-row" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600 }}>
          {icon} {title}
        </div>
        {foot && <div style={{ fontSize: 11.5, opacity: 0.7 }}>{foot}</div>}
      </div>
      {series ? (
        <TimeChart
          series={[{ label: title, points: series.points, color }]}
          height={130}
          yMax={yMax}
          formatY={formatY}
          formatX={timeFmt}
        />
      ) : (
        <div className="empty" style={{ padding: 22, textAlign: "center", fontSize: 12.5, opacity: 0.65 }}>
          CloudWatch returned no datapoints for this metric. That is not the same as a healthy zero —
          the metric may not be published for this engine or class.
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "hot" | "warm" }) {
  return (
    <div className={`sg-kpi ${tone === "hot" ? "sg-kpi-wide hot" : tone === "warm" ? "sg-kpi-risky warm" : "sg-kpi-total"}`}>
      <div className="sg-kpi-body">
        <div className="sg-kpi-val">{value}</div>
        <div className="sg-kpi-lbl">{label}{sub ? ` · ${sub}` : ""}</div>
      </div>
    </div>
  );
}

export default function RdsPerformancePage() {
  const params = useParams<{ id: string }>();
  const sp = useSearchParams();
  const region = sp.get("region") ?? "us-east-1";
  const [hours, setHours] = useState(24);
  const [refreshing, setRefreshing] = useState(false);

  const { data, error, reload } = useJson<Resp>(
    `/api/rds/${encodeURIComponent(params.id)}?region=${encodeURIComponent(region)}&hours=${hours}`,
  );
  // Query digests come from the database itself, so they load independently —
  // a credential or connectivity problem there must not blank the whole page.
  const { data: qdata } = useJson<QResp>(
    `/api/rds/${encodeURIComponent(params.id)}/queries?region=${encodeURIComponent(region)}`,
  );

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try { reload(); } finally { setTimeout(() => setRefreshing(false), 600); }
  }

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const p = data.perf;
  const s = p.stats;

  const healthTone = p.health === "critical" ? "hot" : p.health === "attention" ? "warm" : undefined;
  const criticals = p.issues.filter((i) => i.severity === "critical").length;
  const warnings = p.issues.filter((i) => i.severity === "warning").length;

  return (
    <div className="sg-page">
      <div className="sg-hero">
        <div className="sg-hero-glow-a" />
        <div className="sg-hero-glow-b" />
        <div className="sg-hero-inner">
          <div className="sg-hero-title-row">
            <div>
              <Link href="/rds" className="sg-hero-eyebrow" style={{ textDecoration: "none" }}>
                <ArrowLeft size={12} /> ALL DATABASES
              </Link>
              <h1 className="sg-hero-title">
                <span className="sg-hero-title-grad">{p.id}</span>
              </h1>
              <p className="sg-hero-subline">
                {p.engine} {p.engineVersion} · {p.instanceClass}
                {p.vcpu ? ` (${p.vcpu} vCPU)` : ""} · {p.region} · {p.status}
                {p.multiAz ? " · Multi-AZ" : " · Single-AZ"}
                {p.burstable ? " · burstable" : ""}
                {" "}· last {p.windowHours}h · fetched {new Date(p.fetchedAt).toLocaleTimeString()}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div className="sg-filter-chips">
                {[3, 6, 24, 72, 168].map((h) => (
                  <button key={h} className={`sg-chip ${hours === h ? "active" : ""}`} onClick={() => setHours(h)}>
                    {h < 24 ? `${h}h` : `${h / 24}d`}
                  </button>
                ))}
              </div>
              <button className="btn primary sg-refresh-btn" onClick={refresh} disabled={refreshing}>
                <RefreshCw size={14} className={refreshing ? "spin" : ""} />
              </button>
            </div>
          </div>

          <div className="sg-kpi-row">
            <Kpi
              label="CPU average"
              value={s.cpu.avg != null ? `${s.cpu.avg.toFixed(1)}%` : "—"}
              sub={s.cpu.max != null ? `peak ${s.cpu.max.toFixed(0)}%` : undefined}
              tone={s.cpu.avg != null && s.cpu.avg >= 80 ? "hot" : s.cpu.avg != null && s.cpu.avg >= 60 ? "warm" : undefined}
            />
            <Kpi
              label="Connections"
              value={s.connections.avg != null ? s.connections.avg.toFixed(0) : "—"}
              sub={s.connections.max != null ? `peak ${s.connections.max.toFixed(0)}` : undefined}
            />
            <Kpi
              label="Freeable memory"
              value={s.freeableMemory.min != null ? `${(s.freeableMemory.min / MB).toFixed(0)} MB` : "—"}
              sub="low-water"
              tone={s.freeableMemory.min != null && s.freeableMemory.min < 256 * MB ? "hot" : s.freeableMemory.min != null && s.freeableMemory.min < GB ? "warm" : undefined}
            />
            <Kpi
              label="Free storage"
              value={s.freeStorage.min != null ? `${(s.freeStorage.min / GB).toFixed(1)} GB` : "—"}
              sub={p.allocatedStorageGb ? `of ${p.allocatedStorageGb} GB` : undefined}
              tone={
                s.freeStorage.min != null && p.allocatedStorageGb && s.freeStorage.min / (p.allocatedStorageGb * GB) < 0.1
                  ? "hot" : undefined
              }
            />
            <Kpi
              label="Read / write latency"
              value={
                s.readLatency.avg != null || s.writeLatency.avg != null
                  ? `${s.readLatency.avg != null ? (s.readLatency.avg * 1000).toFixed(1) : "—"} / ${s.writeLatency.avg != null ? (s.writeLatency.avg * 1000).toFixed(1) : "—"} ms`
                  : "—"
              }
              sub="average"
            />
            <Kpi
              label="Issues"
              value={p.issues.length === 0 ? "0" : `${criticals} / ${warnings}`}
              sub={p.issues.length === 0 ? "none found" : "critical / warning"}
              tone={healthTone}
            />
          </div>
        </div>
      </div>

      {/* Issues */}
      <h2 style={{ fontSize: 15, margin: "18px 0 10px", display: "flex", alignItems: "center", gap: 8 }}>
        {p.health === "healthy" ? <CheckCircle2 size={16} /> : <AlertOctagon size={16} />}
        Detected issues {p.issues.length > 0 && <span style={{ opacity: 0.6, fontWeight: 400 }}>({p.issues.length})</span>}
      </h2>

      {p.issues.length === 0 ? (
        <div className="sg-row" style={{ padding: "16px 18px", fontSize: 13 }}>
          No issues detected across CPU, memory, storage, IO latency, queueing, credits and availability
          over the last {p.windowHours}h. Metrics with no datapoints are reported as unavailable in the
          charts below rather than counted as healthy.
        </div>
      ) : (
        <div className="sg-list">
          {p.issues.map((i, n) => (
            <div key={n} className="sg-row" style={{ padding: "13px 16px" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ marginTop: 2 }}>
                  {i.severity === "critical" ? <AlertOctagon size={15} color="#c62234" />
                    : i.severity === "warning" ? <AlertTriangle size={15} color="#c2621b" />
                    : <Info size={15} color="#5d6b82" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 3 }}>
                    {i.title}
                    <span className={`sg-badge ${i.severity === "info" ? "" : "risky"}`} style={{ marginLeft: 8, fontSize: 10.5 }}>
                      {i.severity}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, opacity: 0.85, marginBottom: 4 }}>{i.evidence}</div>
                  <div style={{ fontSize: 12.5, opacity: 0.7 }}>→ {i.action}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Top queries from performance_schema */}
      <QueryPanel insights={qdata?.insights} />

      {/* Charts */}
      <h2 style={{ fontSize: 15, margin: "22px 0 10px" }}>Performance · last {p.windowHours}h</h2>
      <div className="grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Panel title="CPU utilisation" icon={<Cpu size={14} />} series={p.series.cpu} color="#c62234"
               formatY={pctFmt} yMax={100}
               foot={s.cpu.avg != null ? `avg ${s.cpu.avg.toFixed(1)}% · peak ${s.cpu.max?.toFixed(1)}%` : undefined} />
        <Panel title="Database connections" icon={<Plug size={14} />} series={p.series.connections} color="#1d4ed8"
               formatY={numFmt}
               foot={s.connections.avg != null ? `avg ${s.connections.avg.toFixed(0)} · peak ${s.connections.max?.toFixed(0)}` : undefined} />
        <Panel title="Freeable memory" icon={<MemoryStick size={14} />} series={p.series.freeableMemory} color="#17795c"
               formatY={mbFmt}
               foot={s.freeableMemory.min != null ? `low ${(s.freeableMemory.min / MB).toFixed(0)} MB` : undefined} />
        <Panel title="Free storage" icon={<HardDrive size={14} />} series={p.series.freeStorage} color="#9a7b10"
               formatY={gbFmt}
               foot={s.freeStorage.min != null ? `low ${(s.freeStorage.min / GB).toFixed(1)} GB` : undefined} />
        <Panel title="Read IOPS" icon={<Activity size={14} />} series={p.series.readIops} color="#1d4ed8" formatY={numFmt} />
        <Panel title="Write IOPS" icon={<Activity size={14} />} series={p.series.writeIops} color="#c2621b" formatY={numFmt} />
        <Panel title="Read latency" icon={<Gauge size={14} />} series={p.series.readLatency} color="#1d4ed8" formatY={msFmt}
               foot={s.readLatency.avg != null ? `avg ${(s.readLatency.avg * 1000).toFixed(1)} ms` : undefined} />
        <Panel title="Write latency" icon={<Gauge size={14} />} series={p.series.writeLatency} color="#c2621b" formatY={msFmt}
               foot={s.writeLatency.avg != null ? `avg ${(s.writeLatency.avg * 1000).toFixed(1)} ms` : undefined} />
        <Panel title="Disk queue depth" icon={<Activity size={14} />} series={p.series.diskQueueDepth} color="#9a7b10" formatY={(v) => v.toFixed(1)} />
        <Panel title="Swap usage" icon={<MemoryStick size={14} />} series={p.series.swapUsage} color="#c62234" formatY={mbFmt} />
        <Panel title="Network in" icon={<Network size={14} />} series={p.series.networkIn} color="#17795c" formatY={mbpsFmt} />
        <Panel title="Network out" icon={<Network size={14} />} series={p.series.networkOut} color="#1d4ed8" formatY={mbpsFmt} />
        {p.burstable && (
          <Panel title="CPU credit balance" icon={<Zap size={14} />} series={p.series.cpuCreditBalance} color="#c62234"
                 formatY={numFmt}
                 foot={s.cpuCreditBalance.min != null ? `low ${s.cpuCreditBalance.min.toFixed(0)}` : undefined} />
        )}
        {p.series.burstBalance && (
          <Panel title="EBS burst balance" icon={<Zap size={14} />} series={p.series.burstBalance} color="#9a7b10"
                 formatY={pctFmt} yMax={100}
                 foot={s.burstBalance.min != null ? `low ${s.burstBalance.min.toFixed(0)}%` : undefined} />
        )}
        {p.series.replicaLag && (
          <Panel title="Replica lag" icon={<Activity size={14} />} series={p.series.replicaLag} color="#c2621b" formatY={(v) => `${v.toFixed(0)}s`} />
        )}
      </div>
    </div>
  );
}

function QueryPanel({ insights }: { insights?: Insights }) {
  const [open, setOpen] = useState<number | null>(null);

  const heading = (
    <h2 style={{ fontSize: 15, margin: "22px 0 10px", display: "flex", alignItems: "center", gap: 8 }}>
      <Search size={16} /> Top queries by rows examined
    </h2>
  );

  if (!insights) {
    return (
      <>
        {heading}
        <div className="sg-row" style={{ padding: "16px 18px", fontSize: 13, opacity: 0.7 }}>
          Loading query digests…
        </div>
      </>
    );
  }

  if (!insights.available) {
    return (
      <>
        {heading}
        <div className="sg-row" style={{ padding: "15px 18px" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Info size={15} style={{ marginTop: 2, opacity: 0.7 }} />
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 4 }}>Not available</div>
              <div style={{ fontSize: 12.5, opacity: 0.85, marginBottom: 6 }}>{insights.reason}</div>
              {insights.remedy && <div style={{ fontSize: 12.5, opacity: 0.7 }}>→ {insights.remedy}</div>}
              <div style={{ fontSize: 12, opacity: 0.55, marginTop: 8 }}>
                This panel reads <span className="mono">performance_schema.events_statements_summary_by_digest</span>{" "}
                directly from the database. CloudWatch cannot provide rows-examined, so this section stays
                empty rather than implying there are no heavy queries.
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  const q = insights.queries;
  const totalExamined = q.reduce((a, x) => a + x.sumRowsExamined, 0);

  return (
    <>
      <h2 style={{ fontSize: 15, margin: "22px 0 10px", display: "flex", alignItems: "center", gap: 8 }}>
        <Search size={16} /> Top queries by rows examined
        <span style={{ opacity: 0.6, fontWeight: 400, fontSize: 12.5 }}>
          top {q.length} · {n0(totalExamined)} rows examined combined
        </span>
      </h2>

      {insights.issues.length > 0 && (
        <div className="sg-list" style={{ marginBottom: 12 }}>
          {insights.issues.map((i, n) => (
            <div key={n} className="sg-row" style={{ padding: "13px 16px" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ marginTop: 2 }}>
                  {i.severity === "critical" ? <AlertOctagon size={15} color="#c62234" />
                    : i.severity === "warning" ? <AlertTriangle size={15} color="#c2621b" />
                    : <Info size={15} color="#5d6b82" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 3 }}>
                    {i.title}
                    <span className={`sg-badge ${i.severity === "info" ? "" : "risky"}`} style={{ marginLeft: 8, fontSize: 10.5 }}>
                      {i.severity}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, opacity: 0.85, marginBottom: 4 }}>{i.evidence}</div>
                  <div style={{ fontSize: 12.5, opacity: 0.7, marginBottom: 6 }}>→ {i.action}</div>
                  {i.digestText && (
                    <pre className="mono" style={{ fontSize: 11, opacity: 0.75, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
                      {i.digestText}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="sg-row" style={{ padding: 0, overflowX: "auto" }}>
        <table className="sg-rule-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              <th>Statement</th>
              <th className="num" style={{ width: 90 }}>Calls</th>
              <th className="num" style={{ width: 125 }}>Rows examined</th>
              <th className="num" style={{ width: 105 }}>Per call</th>
              <th className="num" style={{ width: 100 }}>Exam/sent</th>
              <th className="num" style={{ width: 85 }}>Total s</th>
              <th className="num" style={{ width: 85 }}>Avg ms</th>
            </tr>
          </thead>
          <tbody>
            {q.map((x) => (
              <tr key={x.rank} onClick={() => setOpen(open === x.rank ? null : x.rank)} style={{ cursor: "pointer" }}>
                <td className="dim">{x.rank}</td>
                <td className="mono" style={{ fontSize: 11, maxWidth: 520 }}>
                  {open === x.rank
                    ? <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>{x.digestText}</pre>
                    : <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.digestText}</span>}
                </td>
                <td className="num">{n0(x.countStar)}</td>
                <td className="num"><b>{n0(x.sumRowsExamined)}</b></td>
                <td className="num">{n0(x.rowsExaminedPerCall)}</td>
                <td className="num">{x.examinedPerSent == null ? "—" : `${n0(x.examinedPerSent)}×`}</td>
                <td className="num">{x.seconds.toFixed(1)}</td>
                <td className="num">{x.avgLatencyMs.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, opacity: 0.6, marginTop: 6 }}>
        Click a row to expand the full statement. <b>Exam/sent</b> is rows examined per row returned — a high
        ratio means the engine scans many rows to find a few, which is an index problem rather than a sizing one.
        Counts are cumulative since the last performance_schema reset, not a rolling window.
      </div>
    </>
  );
}
