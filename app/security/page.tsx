"use client";
import { useMemo, useState, Suspense, Fragment } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useJson } from "@/components/useJson";
import { ErrorBox, Loading, Empty } from "@/components/Common";
import { FreshnessLine, useAutoRefresh } from "@/components/perf/AutoRefresh";
import IssueIcon, { type IssueBucket } from "@/components/IssueIcon";
import RepoFindings from "@/components/RepoFindings";
import FrameworkBadge, { detectFrameworks } from "@/components/FrameworkBadge";
import { ChevronRight } from "lucide-react";

interface Repo {
  id: number; name: string; full_name: string; owner: string;
  private: boolean; fork: boolean; archived: boolean;
  description: string | null; language: string | null;
  pushed_at: string; default_branch: string; scan_branch: string; html_url: string;
  stars: number;
}
interface Me {
  login: string; name: string | null; avatar_url: string;
  public_repos: number; total_private_repos: number | null;
  html_url: string;
}
interface Resp {
  ok: boolean;
  connected: boolean;
  fetchedAt?: string;
  archivedHidden?: number;
  excludedByAllowlist?: number;
  allowlist?: {
    source: string;
    count: number;
    fetchedAt: string | null;
    cached: boolean;
    error: string | null;
  } | null;
  me: Me | null;
  repos: Repo[];
  error?: string;
}

interface ScanJob {
  id: number;
  repoFullName: string;
  branch: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  findingsCount: number;
}
interface ScansResp {
  ok: boolean;
  jobs: ScanJob[];
}

const STATUS_STYLE: Record<string, { border: string; color: string; label: string }> = {
  success:  { border: "#34d399", color: "#34d399", label: "scanned" },
  failed:   { border: "#ef4444", color: "#ef4444", label: "failed" },
  running:  { border: "#f59e0b", color: "#f59e0b", label: "running" },
  queued:   { border: "#f59e0b", color: "#f59e0b", label: "queued" },
};

const LANG_COLOR: Record<string, string> = {
  Java: "#b07219", TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572a5",
  Go: "#00add8", Rust: "#dea584", "C#": "#178600", Ruby: "#701516",
  HTML: "#e34c26", CSS: "#563d7c", Shell: "#89e051", PHP: "#4f5d95",
  Kotlin: "#a97bff", Swift: "#fa7343", Vue: "#41b883", Dockerfile: "#384d54",
};

function Inner() {
  const params = useSearchParams();
  const justConnected = params.get("status") === "connected";

  const { data, error, loading, reload } = useJson<Resp>("/api/security/repos");
  const { data: scansData, reload: reloadScans } = useJson<ScansResp>("/api/security/scans");
  const { data: issues } = useJson<{ repos: Record<string, IssueBucket> }>("/api/issues/summary");
  useAutoRefresh(() => { reload(); reloadScans(); }, 5 * 60_000);

  const latestByRepo = useMemo(() => {
    const m = new Map<string, ScanJob>();
    for (const j of scansData?.jobs ?? []) {
      const prev = m.get(j.repoFullName);
      if (!prev || new Date(j.startedAt) > new Date(prev.startedAt)) m.set(j.repoFullName, j);
    }
    return m;
  }, [scansData]);

  const [q, setQ] = useState("");
  const [visibility, setVisibility] = useState<"" | "public" | "private">("");
  const [openRepo, setOpenRepo] = useState<string | null>(null);
  const [stackFilter, setStackFilter] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncErr, setSyncErr] = useState<string | null>(null);

  const [bulkScanRunning, setBulkScanRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; failed: number; current: string | null }>(
    { done: 0, total: 0, failed: 0, current: null }
  );
  const [skipRecent, setSkipRecent] = useState(true);

  const syncRepos = async () => {
    setSyncing(true); setSyncMsg(null); setSyncErr(null);
    try {
      const res = await fetch("/api/security/repos/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Sync failed (${res.status})`);
      setSyncMsg(`Synced ${body.fetched} repos (${body.inserted} new, ${body.updated} updated).`);
      reload(); reloadScans();
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const bulkScanAll = async () => {
    if (bulkScanRunning) return;
    const targets = filtered.filter((r) => {
      if (!skipRecent) return true;
      const job = latestByRepo.get(r.full_name);
      if (!job) return true; // never scanned → include
      const ageH = (Date.now() - new Date(job.startedAt).getTime()) / 3600_000;
      return ageH > 24; // skip if scanned in last 24h
    });
    if (targets.length === 0) {
      setSyncMsg("Nothing to scan — everything scanned in the last 24h. Uncheck 'Skip recent' to rescan.");
      return;
    }
    if (!confirm(`Scan ${targets.length} repo${targets.length > 1 ? "s" : ""}? This will clone each repo and run Trivy + Gitleaks. Estimated ~${Math.ceil(targets.length * 12 / 60)} min at 3 parallel scans.`)) return;

    setBulkScanRunning(true);
    setBulkProgress({ done: 0, total: targets.length, failed: 0, current: null });
    let done = 0;
    let failed = 0;
    const CONCURRENCY = 3;
    const queue = [...targets];

    const worker = async () => {
      while (queue.length > 0) {
        const repo = queue.shift();
        if (!repo) break;
        setBulkProgress((p) => ({ ...p, current: repo.full_name }));
        try {
          const res = await fetch("/api/security/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ repo: repo.full_name, branch: repo.scan_branch || repo.default_branch }),
          });
          if (!res.ok) failed++;
        } catch { failed++; }
        done++;
        setBulkProgress({ done, total: targets.length, failed, current: null });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setBulkScanRunning(false);
    setBulkProgress((p) => ({ ...p, current: null }));
    reloadScans();
    setSyncMsg(`Bulk scan complete: ${done} scanned, ${failed} failed.`);
  };

  const repos = data?.repos ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return repos.filter((r) => {
      if (visibility === "public" && r.private) return false;
      if (visibility === "private" && !r.private) return false;
      if (needle && !`${r.full_name} ${r.description ?? ""} ${r.language ?? ""}`.toLowerCase().includes(needle)) return false;
      if (stackFilter) {
        const keys = detectFrameworks({ language: r.language, name: r.name, fullName: r.full_name, description: r.description });
        if (!keys.includes(stackFilter)) return false;
      }
      return true;
    });
  }, [repos, q, visibility, stackFilter]);

  if (data && !data.connected) {
    return <NotConnected />;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Repositories</h1>
          <p className="page-sub">
            Active GitHub repositories accessible by your connected account. Archived repos are
            excluded — they're not scannable and just add noise.
            {data?.me && (
              <>
                {" "}Signed in as <strong>@{data.me.login}</strong>.
              </>
            )}
            {data?.archivedHidden ? (
              <>
                {" "}
                <span className="muted">({data.archivedHidden} archived hidden)</span>
              </>
            ) : null}
            {data?.allowlist && data.excludedByAllowlist ? (
              <>
                {" "}
                <span className="chip chip-allowlist" title={`Only repos listed in "${data.allowlist.source}" tab of the Running Services List sheet are shown. ${data.excludedByAllowlist} repos filtered out.`}>
                  📋 Filtered by Google Sheet · {data.allowlist.count} allowed · {data.excludedByAllowlist} hidden
                </span>
              </>
            ) : null}
            {data?.allowlist?.error ? (
              <>
                {" "}
                <span className="chip" style={{ color: "#f59e0b" }} title={data.allowlist.error}>⚠ allowlist unavailable — showing all repos</span>
              </>
            ) : null}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label className="ec2-problems-toggle" title="Skip repos scanned in the last 24 hours">
            <input type="checkbox" checked={skipRecent} onChange={(e) => setSkipRecent(e.target.checked)} disabled={bulkScanRunning} />
            <span>Skip &lt;24h</span>
          </label>
          <button
            type="button"
            className="btn-primary"
            onClick={bulkScanAll}
            disabled={bulkScanRunning}
            style={{ cursor: bulkScanRunning ? "wait" : "pointer", background: bulkScanRunning ? "#4b5563" : "linear-gradient(135deg, #6366f1, #a855f7)" }}
            title="Trigger a Trivy + Gitleaks scan on every visible repo (3 in parallel)."
          >
            {bulkScanRunning
              ? `Scanning ${bulkProgress.done}/${bulkProgress.total}${bulkProgress.current ? ` · ${bulkProgress.current.split("/")[1] ?? bulkProgress.current}` : ""}${bulkProgress.failed > 0 ? ` · ${bulkProgress.failed} failed` : ""}`
              : `🛡 Scan all (${filtered.length})`}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={syncRepos}
            disabled={syncing || bulkScanRunning}
            style={{ cursor: syncing ? "wait" : "pointer" }}
            title="Fetch all repos from GitHub and store them in the database."
          >
            {syncing ? "Syncing…" : "↻ Sync repos"}
          </button>
          <form method="POST" action="/api/auth/github/disconnect">
            <button className="btn-signout" type="submit" style={{ cursor: "pointer" }}>
              Disconnect GitHub
            </button>
          </form>
        </div>
      </div>

      {syncMsg && (
        <div className="panel" style={{ borderColor: "#34d399", background: "rgba(52,211,153,0.06)" }}>
          <strong style={{ color: "#34d399" }}>✓</strong> {syncMsg}
        </div>
      )}
      {syncErr && <ErrorBox message={syncErr} />}

      <FreshnessLine fetchedAt={data?.fetchedAt ?? null} loading={loading} intervalLabel="5 min" />

      {justConnected && (
        <div className="panel" style={{ borderColor: "#34d399", background: "rgba(52,211,153,0.06)" }}>
          <strong style={{ color: "#34d399" }}>✓ Connected.</strong> Your repositories are listed below.
          Scanning begins as soon as the security backend is online.
        </div>
      )}

      {data?.me && (
        <div className="card-row" style={{ marginBottom: 14 }}>
          <div className="card"><div className="card-label">Account</div><div className="card-value" style={{ fontSize: 18 }}>@{data.me.login}</div></div>
          <div className="card"><div className="card-label">Public repos</div><div className="card-value">{data.me.public_repos}</div></div>
          {data.me.total_private_repos !== null && (
            <div className="card"><div className="card-label">Private repos</div><div className="card-value">{data.me.total_private_repos}</div></div>
          )}
          <div className="card"><div className="card-label">Total accessible</div><div className="card-value">{repos.length}</div></div>
        </div>
      )}

      <div className="panel">
        <div className="filterbar">
          <input className="input" placeholder="Search repos" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as "" | "public" | "private")}>
            <option value="">All visibility</option>
            <option value="public">Public only</option>
            <option value="private">Private only</option>
          </select>
          {stackFilter && (
            <button className="stack-filter-active" onClick={() => setStackFilter(null)} title="Clear stack filter">
              <span className="stack-filter-label">Stack:</span>
              <FrameworkBadge keys={[stackFilter]} compact />
              <span className="stack-filter-x">×</span>
            </button>
          )}
        </div>

        {error ? <ErrorBox message={error} />
          : loading && !data ? <Loading />
            : filtered.length === 0 ? <Empty text="No repos match." />
              : (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Repository</th>
                        <th>Language</th>
                        <th>Stack</th>
                        <th>Visibility</th>
                        <th>Scan branch</th>
                        <th>Last push</th>
                        <th>Scan status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => {
                        const isOpen = openRepo === r.full_name;
                        return (
                        <Fragment key={r.id}>
                        <tr
                          className={`repo-row ${isOpen ? "repo-row-open" : ""}`}
                          onClick={() => setOpenRepo(isOpen ? null : r.full_name)}
                          style={{ cursor: "pointer" }}
                        >
                          <td>
                            <span className={`repo-caret ${isOpen ? "open" : ""}`} aria-hidden>
                              <ChevronRight size={13} />
                            </span>
                            <Link href={`/security/${r.owner}/${r.name}`} style={{ textDecoration: "none" }} onClick={(e) => e.stopPropagation()}>
                              <strong style={{ color: "#e5e7eb" }}>{r.full_name}</strong>
                            </Link>
                            <IssueIcon bucket={issues?.repos?.[r.full_name]} />
                            {" "}
                            <a href={r.html_url} target="_blank" rel="noopener noreferrer" title="View on GitHub" className="muted" style={{ fontSize: 11, marginLeft: 4 }} onClick={(e) => e.stopPropagation()}>↗</a>
                            {r.description && <div className="muted" style={{ fontSize: 12, marginTop: 2, maxWidth: 480 }}>{r.description}</div>}
                          </td>
                          <td>
                            {r.language ? (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: LANG_COLOR[r.language] ?? "#94a3b8" }} />
                                {r.language}
                              </span>
                            ) : <span className="muted">-</span>}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <span className="fw-badges-row">
                              {detectFrameworks({ language: r.language, name: r.name, fullName: r.full_name, description: r.description }).map((k) => (
                                <button
                                  key={k}
                                  type="button"
                                  className="fw-badge-btn"
                                  onClick={() => setStackFilter((cur) => cur === k ? null : k)}
                                  title={`Filter to ${k}`}
                                >
                                  <FrameworkBadge keys={[k]} compact />
                                </button>
                              ))}
                            </span>
                          </td>
                          <td>
                            <span className="pill" style={{ borderColor: r.private ? "#f59e0b" : "#34d399", color: r.private ? "#f59e0b" : "#34d399" }}>
                              {r.private ? "private" : "public"}
                            </span>
                            {r.fork && <span className="pill" style={{ marginLeft: 4, borderColor: "#64748b", color: "#94a3b8" }}>fork</span>}
                          </td>
                          <td className="mono">
                            {r.scan_branch}
                            {r.scan_branch !== r.default_branch && (
                              <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>(default: {r.default_branch})</span>
                            )}
                          </td>
                          <td className="muted" style={{ fontSize: 12 }}>{new Date(r.pushed_at).toLocaleDateString()}</td>
                          <td>{(() => {
                            const job = latestByRepo.get(r.full_name);
                            const style = job ? STATUS_STYLE[job.status] : null;
                            const border = style?.border ?? "#64748b";
                            const color = style?.color ?? "#64748b";
                            const label = style?.label ?? "not scanned";
                            return (
                              <span className="pill" style={{ borderColor: border, color }} title={job ? `${job.status} • ${new Date(job.startedAt).toLocaleString()}` : "no scan yet"}>
                                {label}
                                {job && job.status === "success" && job.findingsCount > 0 && (
                                  <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>({job.findingsCount})</span>
                                )}
                              </span>
                            );
                          })()}</td>
                        </tr>
                        {isOpen && (
                          <tr className="repo-detail-row">
                            <td colSpan={7}>
                              <RepoFindings repoFullName={r.full_name} htmlUrl={r.html_url} onClose={() => setOpenRepo(null)} />
                            </td>
                          </tr>
                        )}
                        </Fragment>
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

function NotConnected() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Security</h1>
          <p className="page-sub">
            Connect your GitHub account to enumerate repositories and run vulnerability, secret,
            and configuration scans across them.
          </p>
        </div>
      </div>

      <div className="card-row" style={{ marginBottom: 18 }}>
        <FeatureCard ico="🛡" title="Vulnerability scans" body="Trivy + OWASP Dependency-Check across every connected repo. CVEs deduped by SHA-256 fingerprint." />
        <FeatureCard ico="🔑" title="Secret detection" body="Gitleaks scans every commit. Findings flagged in real time on push via webhook." />
        <FeatureCard ico="⚡" title="JVM heap & Spring hygiene" body="Heap sizing vs container limits, Spring Boot version, Java EOL window — surfaced as findings." />
        <FeatureCard ico="🚨" title="Alerts" body="Critical findings ping Slack and SMTP. Per-repo recipients. Suppression with audit trail." />
      </div>

      <div className="panel" style={{ textAlign: "center", padding: 32 }}>
        <h2 style={{ marginTop: 0 }}>Connect a GitHub account to get started</h2>
        <p className="note" style={{ maxWidth: 480, margin: "8px auto 18px" }}>
          One-click OAuth — no manual token paste. Scopes: <span className="mono">repo</span>,{" "}
          <span className="mono">read:user</span>, <span className="mono">read:org</span>.
          Tokens are stored encrypted and never visible to JavaScript.
        </p>
        <Link className="btn-primary" href="/security/connect" style={{ display: "inline-block", textDecoration: "none" }}>
          Connect with GitHub
        </Link>
      </div>
    </>
  );
}

function FeatureCard({ ico, title, body }: { ico: string; title: string; body: string }) {
  return (
    <div className="card">
      <div style={{ fontSize: 22, marginBottom: 8 }}>{ico}</div>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>{body}</div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Inner />
    </Suspense>
  );
}
