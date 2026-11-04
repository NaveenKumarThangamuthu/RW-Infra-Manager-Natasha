"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useJson } from "@/components/useJson";
import { ErrorBox, Loading } from "@/components/Common";
import { FreshnessLine, useAutoRefresh } from "@/components/perf/AutoRefresh";

interface ScanJob {
  id: number;
  repoFullName: string;
  branch: string;
  status: string;
  triggeredBy: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  commitSha: string | null;
  errorMessage: string | null;
  findingsCount: number;
}
interface ScansResp { ok: boolean; fetchedAt?: string; jobs: ScanJob[]; error?: string }

interface Finding {
  id: number;
  scanner: string;
  severity: string;
  category: string;
  ruleId: string;
  title: string;
  description: string | null;
  file: string | null;
  line: number | null;
  fingerprint: string;
  repoFullName: string;
  branch: string;
  firstSeenAt: string;
  lastSeenAt: string;
  suppressedAt: string | null;
}
interface FindingsResp { ok: boolean; fetchedAt?: string; bySeverity: Record<string, number>; findings: Finding[]; error?: string }

const STATUS_PILL: Record<string, { border: string; color: string }> = {
  success: { border: "#34d399", color: "#34d399" },
  failed:  { border: "#ef4444", color: "#ef4444" },
  running: { border: "#f59e0b", color: "#f59e0b" },
  queued:  { border: "#f59e0b", color: "#f59e0b" },
};
const SEV_PILL: Record<string, { border: string; color: string }> = {
  CRIT: { border: "#ef4444", color: "#ef4444" },
  HIGH: { border: "#f97316", color: "#f97316" },
  MED:  { border: "#f59e0b", color: "#f59e0b" },
  LOW:  { border: "#3b82f6", color: "#3b82f6" },
  INFO: { border: "#64748b", color: "#94a3b8" },
};
const CAT_LABEL: Record<string, string> = { CVE: "CVE", SECRET: "Secret", IAC: "IaC", SPRING_HYGIENE: "Spring", OTHER: "Other" };

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export default function Page({ params }: { params: { owner: string; name: string } }) {
  const { owner, name } = params;
  const repoFull = `${owner}/${name}`;
  const repoFullEnc = encodeURIComponent(repoFull);

  const scansFetch = useJson<ScansResp>(`/api/security/scans?repo=${repoFullEnc}`);
  const findingsFetch = useJson<FindingsResp>(`/api/security/findings?repo=${repoFullEnc}`);
  useAutoRefresh(() => { scansFetch.reload(); findingsFetch.reload(); }, 30_000);

  const jobs = scansFetch.data?.jobs ?? [];
  const findings = findingsFetch.data?.findings ?? [];
  const bySev = findingsFetch.data?.bySeverity ?? {};

  const latest = jobs[0];

  const [severityFilter, setSeverityFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [q, setQ] = useState("");

  const filteredFindings = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return findings.filter((f) => {
      if (severityFilter && f.severity !== severityFilter) return false;
      if (categoryFilter && f.category !== categoryFilter) return false;
      if (needle && !`${f.title} ${f.ruleId} ${f.file ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [findings, severityFilter, categoryFilter, q]);

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const triggerScan = async () => {
    setScanning(true);
    setScanError(null);
    try {
      const branch = latest?.branch ?? "main";
      const res = await fetch("/api/security/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, name, branch }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Scan failed (${res.status})`);
      scansFetch.reload();
      findingsFetch.reload();
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            <Link href="/security" style={{ color: "#94a3b8", textDecoration: "none" }}>Repositories</Link>
            {" / "}
            <span>{repoFull}</span>
          </h1>
          <p className="page-sub">
            Scan history and findings for this repository.
            {" "}
            <a href={`https://github.com/${repoFull}`} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa" }}>
              View on GitHub ↗
            </a>
          </p>
        </div>
        <button className="btn-primary" type="button" onClick={triggerScan} disabled={scanning} style={{ cursor: scanning ? "wait" : "pointer" }}>
          {scanning ? "Scanning…" : "Scan now"}
        </button>
      </div>

      {scanError && <ErrorBox message={scanError} />}

      <FreshnessLine
        fetchedAt={scansFetch.data?.fetchedAt ?? null}
        loading={scansFetch.loading || findingsFetch.loading}
        intervalLabel="30s"
      />

      <div className="card-row" style={{ marginBottom: 18 }}>
        <div className="card">
          <div className="card-label">Last scan</div>
          <div className="card-value" style={{ fontSize: 18 }}>
            {latest ? (
              <span className="pill" style={{ borderColor: STATUS_PILL[latest.status]?.border ?? "#64748b", color: STATUS_PILL[latest.status]?.color ?? "#64748b" }}>
                {latest.status}
              </span>
            ) : <span className="muted">never</span>}
          </div>
          {latest && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{new Date(latest.startedAt).toLocaleString()}</div>}
        </div>
        <div className="card"><div className="card-label">Critical</div><div className="card-value" style={{ color: SEV_PILL.CRIT.color }}>{bySev.CRIT ?? 0}</div></div>
        <div className="card"><div className="card-label">High</div><div className="card-value" style={{ color: SEV_PILL.HIGH.color }}>{bySev.HIGH ?? 0}</div></div>
        <div className="card"><div className="card-label">Medium</div><div className="card-value" style={{ color: SEV_PILL.MED.color }}>{bySev.MED ?? 0}</div></div>
        <div className="card"><div className="card-label">Low / Info</div><div className="card-value" style={{ color: SEV_PILL.LOW.color }}>{(bySev.LOW ?? 0) + (bySev.INFO ?? 0)}</div></div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Findings ({filteredFindings.length}{filteredFindings.length !== findings.length ? ` of ${findings.length}` : ""})</h2>

        <div className="filterbar">
          <input className="input" placeholder="Search rule / file / title" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
            <option value="">All severity</option>
            <option value="CRIT">Critical</option>
            <option value="HIGH">High</option>
            <option value="MED">Medium</option>
            <option value="LOW">Low</option>
            <option value="INFO">Info</option>
          </select>
          <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            <option value="CVE">CVE</option>
            <option value="SECRET">Secret</option>
            <option value="IAC">IaC</option>
            <option value="SPRING_HYGIENE">Spring hygiene</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        {findingsFetch.error ? <ErrorBox message={findingsFetch.error} />
          : findingsFetch.loading && !findingsFetch.data ? <Loading />
            : findings.length === 0 ? (
              <p className="note">No findings yet. {jobs.length === 0 ? "Run a scan to populate." : "Last scan completed clean."}</p>
            ) : filteredFindings.length === 0 ? (
              <p className="note">No findings match the current filter.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Severity</th>
                      <th>Category</th>
                      <th>Rule</th>
                      <th>Title</th>
                      <th>Location</th>
                      <th>Scanner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFindings.map((f) => {
                      const sev = SEV_PILL[f.severity] ?? SEV_PILL.INFO;
                      return (
                        <tr key={f.id} style={f.suppressedAt ? { opacity: 0.45 } : undefined}>
                          <td><span className="pill" style={{ borderColor: sev.border, color: sev.color }}>{f.severity}</span></td>
                          <td className="muted">{CAT_LABEL[f.category] ?? f.category}</td>
                          <td className="mono" style={{ fontSize: 12 }}>{f.ruleId}</td>
                          <td>{f.title}</td>
                          <td className="mono" style={{ fontSize: 12 }}>
                            {f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : <span className="muted">—</span>}
                          </td>
                          <td className="muted">{f.scanner}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Scan history</h2>
        {scansFetch.error ? <ErrorBox message={scansFetch.error} />
          : scansFetch.loading && !scansFetch.data ? <Loading />
            : jobs.length === 0 ? (
              <p className="note">No scans have run for this repository yet.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Branch</th>
                      <th>Status</th>
                      <th>Trigger</th>
                      <th>By</th>
                      <th>Duration</th>
                      <th>Findings</th>
                      <th>Commit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => {
                      const style = STATUS_PILL[j.status] ?? { border: "#64748b", color: "#64748b" };
                      return (
                        <tr key={j.id}>
                          <td className="muted" style={{ fontSize: 12 }}>{new Date(j.startedAt).toLocaleString()}</td>
                          <td className="mono">{j.branch}</td>
                          <td>
                            <span className="pill" style={{ borderColor: style.border, color: style.color }} title={j.errorMessage ?? undefined}>
                              {j.status}
                            </span>
                          </td>
                          <td className="muted">{j.trigger}</td>
                          <td className="muted" style={{ fontSize: 12 }}>{j.triggeredBy}</td>
                          <td className="mono">{fmtDuration(j.durationMs)}</td>
                          <td><strong>{j.findingsCount}</strong></td>
                          <td className="mono" style={{ fontSize: 11 }}>{j.commitSha ? j.commitSha.slice(0, 7) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
      </div>
    </>
  );
}
