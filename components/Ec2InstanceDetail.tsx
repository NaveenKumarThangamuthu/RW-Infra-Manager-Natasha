"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown, ExternalLink, Cpu, MemoryStick, Zap, HardDrive,
  AlertTriangle, Terminal, Rocket,
} from "lucide-react";
import { money } from "./format";
import { istTime } from "@/components/natasha/format";

interface Ec2InstanceDetailProps {
  instanceId: string;
  name: string;
  region: string;
  publicIp: string | null;
  privateIp: string | null;
  onClose: () => void;
}

interface SpringSvcRow {
  serviceName: string;
  displayName?: string;
  // Prometheus payload delivers "instance" as "ip:port"; older callers may still send `host`.
  instance?: string | null;
  host?: string | null;
  port?: number | null;
  pid?: number | null;
  version?: string | null;
  // Prometheus payload delivers heap as "heapUsedBytes"/"heapMaxBytes"; keep the aliases too.
  heapUsed?: number | null;
  heapMax?: number | null;
  heapUsedBytes?: number | null;
  heapMaxBytes?: number | null;
  heapPct?: number | null;
  cpuLoad?: number | null;
  cpu?: number | null;
  status?: string;
  up?: boolean;
  uptimeSec?: number | null;
  errorsLastHour?: number | null;
  job?: string;
}
interface SpringResp { services: SpringSvcRow[] }

interface RecItem {
  kind: string;
  severity: string; // "INFO" | "WARN" | "CRIT" (uppercase from engine)
  message: string;
  targetType?: string | null;
  monthlyDeltaUsd?: number | null;
  evidence?: Record<string, number | string | null>;
}
interface RecAnalysis {
  instanceId: string;
  name: string;
  region: string;
  type: string;
  state: string;
  cpuAvg24h?: number | null;
  cpuP95_24h?: number | null;
  memAvg24h?: number | null;
  memMax24h?: number | null;
  diskMaxPct?: number | null;
  diskWorstMount?: string | null;
  creditBalancePct?: number | null;
  creditBalanceMin?: number | null;
  source?: string;
  recommendations: RecItem[];
}
interface RecResp { analysis: RecAnalysis }

const KIND_TO_TYPE_ICON: Record<string, string> = {
  "cpu-upsize": "CPU",
  "cpu-downsize": "CPU",
  "cpu-credits": "CREDITS",
  "memory-upsize": "MEMORY",
  "memory-downsize": "MEMORY",
  "disk-full": "DISK",
  "downsize": "CPU",
  "upsize": "CPU",
};
function inferTypeKey(kind: string): string {
  const k = kind.toLowerCase();
  if (k.includes("modernize")) return "MODERNIZE";
  if (k.includes("cpu")) return "CPU";
  if (k.includes("mem") || k.includes("heap")) return "MEMORY";
  if (k.includes("credit")) return "CREDITS";
  if (k.includes("disk")) return "DISK";
  if (k.includes("error")) return "ERROR";
  return KIND_TO_TYPE_ICON[kind] ?? "INFO";
}
function fmtDelta(usd: number | null | undefined): string {
  if (usd == null || !isFinite(usd)) return "";
  const sign = usd > 0 ? "+" : "";
  return `${sign}$${Math.abs(usd) < 1 ? usd.toFixed(2) : usd.toFixed(0)}/mo`;
}
function titleFromKind(kind: string, target?: string | null): string {
  const map: Record<string, string> = {
    "cpu-upsize":     `Upsize CPU${target ? ` → ${target}` : ""}`,
    "cpu-downsize":   `Downsize CPU${target ? ` → ${target}` : ""}`,
    "cpu-credits":    "CPU credit balance low",
    "memory-upsize":  `Upsize memory${target ? ` → ${target}` : ""}`,
    "memory-downsize":`Downsize memory${target ? ` → ${target}` : ""}`,
    "disk-full":      "Disk approaching full",
    "downsize":       `Downsize instance${target ? ` → ${target}` : ""}`,
    "upsize":         `Upsize instance${target ? ` → ${target}` : ""}`,
    "rightsizing-downsize": `Rightsize${target ? ` → ${target}` : ""}`,
    "modernize":      `Modernize family${target ? ` → ${target}` : ""}`,
    "stopped":        "Instance stopped",
    "ok":             "Healthy",
  };
  return map[kind] ?? kind.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface LogDetailEntry { at: string | null; message: string; host?: string | null }
interface LogDetailsResp {
  entries: LogDetailEntry[]; total: number; truncated: boolean;
}

type TabKey = "services" | "recs" | "errors";

const TYPE_ICON: Record<string, React.ReactNode> = {
  HEAP: <MemoryStick size={13} />,
  MEMORY: <MemoryStick size={13} />,
  CPU: <Cpu size={13} />,
  CREDITS: <Zap size={13} />,
  DISK: <HardDrive size={13} />,
  ERROR: <AlertTriangle size={13} />,
  MODERNIZE: <Rocket size={13} />,
};
const SEV_META: Record<string, { fg: string; bg: string; border: string }> = {
  crit:  { fg: "#fca5a5", bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.28)" },
  warn:  { fg: "#facc15", bg: "rgba(234,179,8,0.10)", border: "rgba(234,179,8,0.25)" },
  info:  { fg: "#7dd3fc", bg: "rgba(56,189,248,0.10)", border: "rgba(56,189,248,0.24)" },
};

function useJsonOnce<T>(url: string | null): { data: T | null; error: string | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(url));
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setLoading(true); setError(null);
    fetch(url).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!alive) return;
      if (!r.ok) { setError(j.error ?? `HTTP ${r.status}`); return; }
      setData(j as T);
    }).catch((e) => alive && setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [url]);
  return { data, error, loading };
}

function matchesInstance(svc: SpringSvcRow, instanceId: string, publicIp: string | null, privateIp: string | null, name: string): boolean {
  // Prometheus reports the endpoint as "10.0.5.42:8080"; older shapes used a bare hostname.
  // Strip the ":port" and match either IPv4 exactly against the EC2 IPs, or fall back to
  // substring matches against name/instanceId.
  const raw = (svc.instance ?? svc.host ?? "").toLowerCase();
  if (!raw) return false;
  const hostOnly = raw.split(":")[0];
  if (publicIp && hostOnly === publicIp.toLowerCase()) return true;
  if (privateIp && hostOnly === privateIp.toLowerCase()) return true;
  if (publicIp && raw.includes(publicIp.toLowerCase())) return true;
  if (privateIp && raw.includes(privateIp.toLowerCase())) return true;
  if (name && raw.includes(name.toLowerCase())) return true;
  return raw.includes(instanceId.toLowerCase());
}

function HeapBar({ used, max }: { used?: number | null; max?: number | null }) {
  if (used == null || max == null || max <= 0) return <span className="muted small">—</span>;
  const pct = Math.min(100, (used / max) * 100);
  const color = pct > 85 ? "#ef4444" : pct > 70 ? "#facc15" : "#34d399";
  return (
    <div className="spring-heap-bar" title={`${(used / (1024 * 1024)).toFixed(0)} MiB / ${(max / (1024 * 1024)).toFixed(0)} MiB`}>
      <div className="spring-heap-fill" style={{ width: `${pct}%`, background: color }} />
      <div className="spring-heap-label">{pct.toFixed(0)}%</div>
    </div>
  );
}

export default function Ec2InstanceDetail({ instanceId, name, region, publicIp, privateIp, onClose }: Ec2InstanceDetailProps) {
  const [tab, setTab] = useState<TabKey>("services");
  const { data: spring } = useJsonOnce<SpringResp>("/api/perf/spring");
  const { data: rec, loading: recLoading, error: recError } = useJsonOnce<RecResp>(`/api/perf/ec2/${encodeURIComponent(instanceId)}/recommend`);

  const services = useMemo(() => {
    if (!spring?.services) return [];
    return spring.services.filter((s) => matchesInstance(s, instanceId, publicIp, privateIp, name));
  }, [spring, instanceId, publicIp, privateIp, name]);

  // The error list shows one service at a time: the first one matched to this host.
  const noisiest = services[0] ?? null;
  const errorsUrl = noisiest ? `/api/perf/spring/logs/details?service=${encodeURIComponent(noisiest.serviceName)}&window=24h` : null;
  const { data: errors, loading: errorsLoading } = useJsonOnce<LogDetailsResp>(tab === "errors" ? errorsUrl : null);

  return (
    <div className="repo-detail ec2-detail">
      <div className="repo-detail-head">
        <div>
          <div className="repo-detail-title">
            <Terminal size={16} strokeWidth={1.75} />
            <strong>{name}</strong>
            <span className="mono muted small">{instanceId}</span>
            <span className="muted small">· {region}</span>
          </div>
          <div className="ec2-detail-meta muted small">
            {publicIp && <>Public <span className="mono">{publicIp}</span> · </>}
            {privateIp && <>Private <span className="mono">{privateIp}</span></>}
          </div>
        </div>
        <div className="repo-detail-actions">
          <Link href={`/perf/ec2/${encodeURIComponent(instanceId)}`} className="btn-ghost">
            <ExternalLink size={13} /> Full page
          </Link>
          <button className="btn-ghost" onClick={onClose}>
            <ChevronDown size={14} className="drawer-close-caret" /> Close
          </button>
        </div>
      </div>

      <div className="ec2-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "services"} className={`ec2-tab ${tab === "services" ? "active" : ""}`} onClick={() => setTab("services")}>
          Services <span className="ec2-tab-count">({services.length})</span>
        </button>
        <button role="tab" aria-selected={tab === "recs"} className={`ec2-tab ${tab === "recs" ? "active" : ""}`} onClick={() => setTab("recs")}>
          Recommendations {rec ? <span className="ec2-tab-count">({rec.analysis.recommendations.length})</span> : null}
        </button>
        <button role="tab" aria-selected={tab === "errors"} className={`ec2-tab ${tab === "errors" ? "active" : ""}`} onClick={() => setTab("errors")}>
          Errors
        </button>
      </div>

      {tab === "services" && (
        <div className="ec2-tab-panel">
          {services.length === 0 ? (
            <div className="anomaly-banner-clean muted">
              No Spring-registered services found reporting from this host in the last snapshot.
              This is normal for MongoDB, Jenkins, or non-Spring hosts.
            </div>
          ) : (
            <>
              <div className="fable-triage">
                <div className="fable-triage-head">Note</div>
                <div className="fable-triage-fix">
                  {services.length === 1
                    ? `Single service on this host — restarting the instance is a full outage for ${services[0].displayName ?? services[0].serviceName}.`
                    : `${services.length} services share this host. A rolling restart of the host will cascade — coordinate downtime across teams.`}
                </div>
              </div>
              <div className="repo-detail-table-wrap">
                <table className="repo-findings-table">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Status</th>
                      <th>Port</th>
                      <th>Heap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {services.map((s) => {
                      const isUp = s.up ?? s.status === "UP";
                      const heapUsed = s.heapUsedBytes ?? s.heapUsed ?? null;
                      const heapMax = s.heapMaxBytes ?? s.heapMax ?? null;
                      const portFromInstance = (() => {
                        const p = (s.instance ?? "").split(":")[1];
                        return p ? Number(p) : null;
                      })();
                      const port = s.port ?? portFromInstance;
                      const rowKey = `${s.serviceName}::${s.instance ?? s.host ?? ""}`;
                      return (
                        <tr key={rowKey}>
                          <td><strong>{s.displayName ?? s.serviceName}</strong></td>
                          <td>
                            <span className={`pill ${isUp ? "running" : "stopped"}`}>{isUp ? "UP" : "DOWN"}</span>
                          </td>
                          <td className="mono small">{port ?? "—"}</td>
                          <td><HeapBar used={heapUsed} max={heapMax} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "recs" && (
        <div className="ec2-tab-panel">
          {recLoading && <div className="muted small">Analyzing instance…</div>}
          {recError && <div className="anomaly-banner-clean">{recError}</div>}

          {rec && (
            <>
              {/* 24h metrics snapshot */}
              <div className="ec2-rec-metrics">
                <MetricPill label="CPU avg" value={rec.analysis.cpuAvg24h} unit="%" precision={1} hotAt={70} critAt={90} />
                <MetricPill label="CPU p95" value={rec.analysis.cpuP95_24h} unit="%" precision={0} hotAt={80} critAt={95} />
                <MetricPill label="RAM avg" value={rec.analysis.memAvg24h} unit="%" precision={0} hotAt={75} critAt={90} />
                <MetricPill label="RAM peak" value={rec.analysis.memMax24h} unit="%" precision={0} hotAt={80} critAt={95} />
                <MetricPill label="Disk peak" value={rec.analysis.diskMaxPct} unit="%" precision={0} hotAt={75} critAt={90} title={rec.analysis.diskWorstMount ?? undefined} />
                {rec.analysis.creditBalancePct != null && (
                  <MetricPill label="Credits" value={rec.analysis.creditBalancePct} unit="%" precision={0} lowAt={40} critLowAt={20} invert />
                )}
                <div className="ec2-rec-metric-type">
                  <div className="ec2-rec-metric-type-label">Type</div>
                  <div className="ec2-rec-metric-type-val mono">{rec.analysis.type}</div>
                </div>
              </div>

              {rec.analysis.recommendations.length === 0 && (
                <div className="anomaly-banner-clean" style={{ marginTop: 12 }}>
                  <span className="live-dot" /> No recommendations — this instance is well-sized based on the last 24h of metrics.
                </div>
              )}

              {rec.analysis.recommendations.length > 0 && (
                <>
                  <div className="ec2-rec-grid" style={{ marginTop: 12 }}>
                    {rec.analysis.recommendations.map((r, i) => {
                      const typeKey = inferTypeKey(r.kind);
                      const icon = TYPE_ICON[typeKey] ?? <AlertTriangle size={13} />;
                      const sev = (r.severity ?? "info").toLowerCase();
                      const meta = SEV_META[sev] ?? SEV_META.info;
                      const isDowngrade = r.kind.toLowerCase().includes("downsize");
                      const isUpgrade   = r.kind.toLowerCase().includes("upsize");
                      const delta = r.monthlyDeltaUsd;
                      return (
                        <div key={i} className="ec2-rec-card" style={{ borderColor: meta.border, background: meta.bg }}>
                          <div className="ec2-rec-head">
                            <span className="ec2-rec-type" style={{ color: meta.fg }}>{icon} {typeKey}</span>
                            <span className="sev-chip" style={{ background: meta.bg, color: meta.fg, borderColor: meta.border }}>{sev.toUpperCase()}</span>
                          </div>
                          <div className="ec2-rec-title">
                            {titleFromKind(r.kind, r.targetType)}
                          </div>
                          <div className="ec2-rec-detail">{r.message}</div>
                          <div className="ec2-rec-footer">
                            {r.targetType && (
                              <span className="ec2-rec-target mono">
                                {isDowngrade ? "⬇ " : isUpgrade ? "⬆ " : "→ "}{r.targetType}
                              </span>
                            )}
                            {delta != null && (
                              <span className={`ec2-rec-delta ${delta < 0 ? "delta-save" : delta > 0 ? "delta-cost" : ""}`}>
                                {fmtDelta(delta)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Totals */}
                  {(() => {
                    const totalDelta = rec.analysis.recommendations.reduce((a, r) => a + (r.monthlyDeltaUsd ?? 0), 0);
                    const savingsOnly = rec.analysis.recommendations.reduce((a, r) => a + Math.min(0, r.monthlyDeltaUsd ?? 0), 0);
                    return (
                      <div className="ec2-rec-totals">
                        <div>
                          <span className="ec2-rec-total-label">Net if all applied</span>
                          <span className={`ec2-rec-total-val ${totalDelta < 0 ? "delta-save" : ""}`}>{fmtDelta(totalDelta)}</span>
                        </div>
                        {savingsOnly < 0 && (
                          <div>
                            <span className="ec2-rec-total-label">Savings only</span>
                            <span className="ec2-rec-total-val delta-save">{fmtDelta(savingsOnly)}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="fable-triage" style={{ marginTop: 12 }}>
                    <div className="fable-triage-head">Note</div>
                    <div className="fable-triage-fix">
                      {(() => {
                        const recs = rec.analysis.recommendations;
                        const crit = recs.filter((r) => (r.severity ?? "").toLowerCase() === "crit").length;
                        const warn = recs.filter((r) => (r.severity ?? "").toLowerCase() === "warn").length;
                        const upsize   = recs.filter((r) => r.kind.toLowerCase().includes("upsize"));
                        const downsize = recs.filter((r) => r.kind.toLowerCase().includes("downsize"));
                        if (crit) return `${crit} CRIT — patch today; bundle WARN items into the next deploy.`;
                        if (upsize.length && downsize.length === 0) return `${upsize.length} upsize action${upsize.length === 1 ? "" : "s"} — this box is under load. Bump before the next traffic peak.`;
                        if (downsize.length && upsize.length === 0) return `${downsize.length} downsize opportunit${downsize.length === 1 ? "y" : "ies"} — instance is over-provisioned. Rightsize during next maintenance window.`;
                        if (warn) return `${warn} WARN — bundle into the next deploy or dependency bump.`;
                        return `Everything is INFO-level. Safe to defer to quarterly cleanup.`;
                      })()}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {tab === "errors" && (
        <div className="ec2-tab-panel">
          {errorsUrl && errorsLoading && <div className="muted small">Loading ERROR entries…</div>}
          {errors && errors.entries.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <h3 className="panel-h3" style={{ margin: "0 0 8px" }}>Recent errors · {noisiest?.displayName ?? noisiest?.serviceName} · last 24h</h3>
              <div className="repo-detail-table-wrap">
                <table className="repo-findings-table">
                  <thead>
                    <tr><th>Message</th><th style={{ width: 120 }}>Time (IST)</th></tr>
                  </thead>
                  <tbody>
                    {errors.entries.slice(0, 8).map((e, i) => (
                      <tr key={i}>
                        <td className="mono small" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 640 }}>{e.message.slice(0, 180)}</td>
                        <td className="muted small">{e.at ? istTime(e.at) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* AWS-side system snapshot — kernel/OS + agent + console output + CloudTrail activity */}
          <SystemSnapshotPanel instanceId={instanceId} />
        </div>
      )}
    </div>
  );
}

interface SystemSnapshotResp {
  ok: boolean;
  snapshot: {
    instanceId: string; region: string; fetchedAt: string;
    ssm: { status: string; agentVersion: string | null; platformName: string | null; platformVersion: string | null; computerName: string | null; lastPingAt: string | null; ipAddress: string | null };
    inventory: { packagesCount: number | null; packagesTopByName?: Array<{ name: string; version: string }>; error: string | null };
    console: { supported: boolean; lines: string[]; capturedAt: string | null; error: string | null };
    cloudTrail: { events: Array<{ eventTime: string; eventName: string; username: string | null; sourceIp: string | null }>; error: string | null };
    logGroups: { matched: Array<{ name: string; lastEventAt: string | null; sample: string[] }>; error: string | null };
  };
}

function SystemSnapshotPanel({ instanceId }: { instanceId: string }) {
  const { data, error, loading } = useJsonOnce<SystemSnapshotResp>(
    `/api/perf/ec2/${encodeURIComponent(instanceId)}/system-snapshot`
  );

  return (
    <div className="ec2-sys-panel" style={{ marginTop: 14 }}>
      <div className="ec2-sys-panel-head">
        <h3 className="panel-h3">AWS-side system snapshot</h3>
        <span className="chip">via SSM · CloudTrail · CloudWatch — read-only</span>
      </div>
      {loading && <div className="muted small">Fetching AWS metadata…</div>}
      {error && <div className="anomaly-banner-clean">{error}</div>}
      {data && (
        <>
          {/* KPI strip */}
          <div className="ec2-sys-kpis">
            <SysKpi label="SSM agent" value={
              data.snapshot.ssm.status === "online" ? "🟢 Online" :
              data.snapshot.ssm.status === "connection-lost" ? "🟡 Lost" :
              data.snapshot.ssm.status === "not-managed" ? "⚪ Not managed" : "❓"
            } sub={data.snapshot.ssm.agentVersion ? `v${data.snapshot.ssm.agentVersion}` : ""} />
            <SysKpi label="OS" value={
              data.snapshot.ssm.platformName
                ? `${data.snapshot.ssm.platformName} ${data.snapshot.ssm.platformVersion ?? ""}`.trim()
                : "unknown"
            } sub={data.snapshot.ssm.computerName ?? ""} mono />
            <SysKpi label="Packages" value={
              data.snapshot.inventory.packagesCount != null
                ? String(data.snapshot.inventory.packagesCount)
                : "—"
            } sub="via SSM inventory" />
            <SysKpi label="Last ping" value={
              data.snapshot.ssm.lastPingAt ? relTime(data.snapshot.ssm.lastPingAt) : "—"
            } sub={data.snapshot.ssm.ipAddress ?? ""} mono />
          </div>

          {/* Console output */}
          <div className="ec2-sys-block">
            <div className="ec2-sys-block-head">
              <span className="ec2-sys-block-title">Console output (last 30 lines)</span>
              {data.snapshot.console.capturedAt && (
                <span className="muted small">captured {relTime(data.snapshot.console.capturedAt)}</span>
              )}
            </div>
            {data.snapshot.console.lines.length > 0 ? (
              <pre className="ec2-sys-console">
                {data.snapshot.console.lines.join("\n")}
              </pre>
            ) : (
              <div className="muted small ec2-sys-empty">
                {data.snapshot.console.error ?? "no console data"}
              </div>
            )}
          </div>

          {/* CloudTrail */}
          <div className="ec2-sys-block">
            <div className="ec2-sys-block-head">
              <span className="ec2-sys-block-title">CloudTrail activity · last 1h</span>
              <span className="muted small">{data.snapshot.cloudTrail.events.length} events</span>
            </div>
            {data.snapshot.cloudTrail.error && (
              <div className="muted small">{data.snapshot.cloudTrail.error}</div>
            )}
            {data.snapshot.cloudTrail.events.length === 0 && !data.snapshot.cloudTrail.error && (
              <div className="muted small ec2-sys-empty">No API activity touched this instance in the last hour.</div>
            )}
            {data.snapshot.cloudTrail.events.length > 0 && (
              <table className="ec2-sys-table">
                <thead>
                  <tr><th>When</th><th>Event</th><th>Actor</th><th>Source IP</th></tr>
                </thead>
                <tbody>
                  {data.snapshot.cloudTrail.events.slice(0, 12).map((e, i) => (
                    <tr key={i}>
                      <td className="mono small">{relTime(e.eventTime)}</td>
                      <td className="mono small">{e.eventName}</td>
                      <td className="mono small">{e.username ?? "—"}</td>
                      <td className="mono small">{e.sourceIp ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Related CW log groups */}
          {data.snapshot.logGroups.matched.length > 0 && (
            <div className="ec2-sys-block">
              <div className="ec2-sys-block-head">
                <span className="ec2-sys-block-title">CloudWatch log groups referencing this instance</span>
                <span className="muted small">{data.snapshot.logGroups.matched.length} groups</span>
              </div>
              <ul className="ec2-sys-lglist">
                {data.snapshot.logGroups.matched.map((lg, i) => (
                  <li key={i}>
                    <span className="mono small">{lg.name}</span>
                    {lg.lastEventAt && <span className="muted small"> · last {relTime(lg.lastEventAt)}</span>}
                    {lg.sample.length > 0 && (
                      <pre className="ec2-sys-console small">{lg.sample.join("\n")}</pre>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Honest footer — no runtime OS errors available via AWS APIs */}
          <div className="ec2-sys-banner">
            <strong>Runtime OS errors</strong> (journalctl, /var/log/syslog, dmesg) are <em>not</em> available via AWS read-only APIs.
            To surface them here, either install <b>Filebeat</b> with a `/var/log/*` prospector shipping to the existing ELK cluster,
            or install the CloudWatch Logs Agent on each instance. Ask me for the config diff when your ops team is ready.
          </div>
        </>
      )}
    </div>
  );
}

function SysKpi({ label, value, sub, mono }: { label: string; value: string; sub?: string; mono?: boolean }) {
  return (
    <div className="ec2-sys-kpi">
      <div className="ec2-sys-kpi-label">{label}</div>
      <div className={`ec2-sys-kpi-val ${mono ? "mono small" : ""}`}>{value}</div>
      {sub && <div className="ec2-sys-kpi-sub muted small">{sub}</div>}
    </div>
  );
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return iso;
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function MetricPill({
  label, value, unit, precision = 0, hotAt, critAt, lowAt, critLowAt, invert, title,
}: {
  label: string;
  value: number | null | undefined;
  unit?: string;
  precision?: number;
  hotAt?: number;
  critAt?: number;
  lowAt?: number;
  critLowAt?: number;
  invert?: boolean;
  title?: string;
}) {
  if (value == null || !isFinite(value)) {
    return (
      <div className="ec2-rec-metric" title={title}>
        <div className="ec2-rec-metric-label">{label}</div>
        <div className="ec2-rec-metric-val muted">—</div>
      </div>
    );
  }
  let tone: "cool" | "warm" | "hot" = "cool";
  if (invert) {
    if (critLowAt != null && value <= critLowAt) tone = "hot";
    else if (lowAt != null && value <= lowAt) tone = "warm";
  } else {
    if (critAt != null && value >= critAt) tone = "hot";
    else if (hotAt != null && value >= hotAt) tone = "warm";
  }
  return (
    <div className={`ec2-rec-metric ec2-rec-metric-${tone}`} title={title}>
      <div className="ec2-rec-metric-label">{label}</div>
      <div className="ec2-rec-metric-val tab-num">
        {value.toFixed(precision)}
        <span className="ec2-rec-metric-unit">{unit ?? ""}</span>
      </div>
    </div>
  );
}
