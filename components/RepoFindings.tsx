"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Sparkles, ShieldAlert, Bug, Key, Sprout, Brain, Copy } from "lucide-react";

interface Finding {
  id: number;
  repoFullName: string;
  severity: string;
  scanner: string;
  ruleId: string;
  category: string;
  title: string;
  description: string | null;
  file: string | null;
  line: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  suppressedAt: string | null;
}
interface FindingsResp {
  ok: boolean;
  bySeverity: Record<string, number>;
  findings: Finding[];
}

const SEV_COLOR: Record<string, { bg: string; fg: string; border: string }> = {
  CRIT: { bg: "rgba(239,68,68,0.14)", fg: "#fca5a5", border: "rgba(239,68,68,0.35)" },
  HIGH: { bg: "rgba(249,115,22,0.14)", fg: "#fdba74", border: "rgba(249,115,22,0.35)" },
  MED:  { bg: "rgba(234,179,8,0.14)", fg: "#facc15", border: "rgba(234,179,8,0.30)" },
  LOW:  { bg: "rgba(56,189,248,0.12)", fg: "#7dd3fc", border: "rgba(56,189,248,0.25)" },
  INFO: { bg: "rgba(148,163,184,0.10)", fg: "#cbd5e1", border: "rgba(148,163,184,0.24)" },
};

function ScannerIcon({ scanner }: { scanner: string }) {
  const s = scanner.toLowerCase();
  if (s.includes("gitleaks") || s.includes("secret")) return <Key size={12} strokeWidth={2} />;
  if (s.includes("trivy") || s.includes("cve")) return <Bug size={12} strokeWidth={2} />;
  return <ShieldAlert size={12} strokeWidth={2} />;
}

function buildFableTriage(findings: Finding[]): { headline: string; suggestedFix: string } | null {
  if (!findings.length) return null;
  const crit = findings.filter((f) => f.severity === "CRIT");
  const high = findings.filter((f) => f.severity === "HIGH");
  const withFile = (crit.length ? crit : high.length ? high : findings).filter((f) => f.file);

  const commonFile = (() => {
    const counts = new Map<string, number>();
    for (const f of withFile) if (f.file) counts.set(f.file, (counts.get(f.file) ?? 0) + 1);
    let best: [string, number] | null = null;
    for (const [k, v] of counts) if (!best || v > best[1]) best = [k, v];
    return best;
  })();

  if (crit.length > 0) {
    if (commonFile && commonFile[1] > 1) {
      return {
        headline: `${crit.length} critical finding${crit.length === 1 ? "" : "s"} — ${commonFile[1]} share ${commonFile[0]}.`,
        suggestedFix: `Prioritize ${commonFile[0]} — patching one file resolves multiple CRIT items in one pass.`,
      };
    }
    return {
      headline: `${crit.length} critical finding${crit.length === 1 ? "" : "s"} across ${new Set(crit.map((f) => f.ruleId)).size} rule${new Set(crit.map((f) => f.ruleId)).size === 1 ? "" : "s"}.`,
      suggestedFix: `Open a fix branch, patch each CRIT, run \`trivy fs .\` + \`gitleaks detect\` locally to verify, then re-scan.`,
    };
  }
  if (high.length > 0) {
    return {
      headline: `${high.length} high-severity finding${high.length === 1 ? "" : "s"} · no CRIT.`,
      suggestedFix: `Bundle these into the next dependency bump PR — no immediate CVE blast radius.`,
    };
  }
  return {
    headline: `${findings.length} finding${findings.length === 1 ? "" : "s"} · all MED or below.`,
    suggestedFix: `Safe to defer to the next quarterly cleanup unless one turns out to reach production data.`,
  };
}

interface SpringSvc { serviceName: string; job: string; instance: string; up: boolean }
interface SpringResp { services?: SpringSvc[] }
interface LogSvc { service: string; errors: number }
interface LogResp { services?: LogSvc[] }
interface LogEntry { at: string | null; host: string | null; message: string }
interface LogDetailsResp { service: string; window: string; total: number; truncated: boolean; entries: LogEntry[] }
interface FableSummary { headline: string; rootCause: string; suggestedFix: string; model?: string }

function copyClip(text: string) {
  try { void navigator.clipboard.writeText(text); } catch { /* ignore */ }
}

function dedupePattern(entries: LogEntry[]): Array<{ pattern: string; count: number; sample: LogEntry; hosts: Set<string> }> {
  const buckets = new Map<string, { pattern: string; count: number; sample: LogEntry; hosts: Set<string> }>();
  for (const e of entries) {
    // Collapse timestamps, uuids, ips, ids into a stable pattern.
    const key = (e.message || "")
      .replace(/\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}[\d.:+Z-]*/g, "<ts>")
      .replace(/\b[0-9a-f-]{8,}\b/gi, "<id>")
      .replace(/\b\d+\.\d+\.\d+\.\d+\b/g, "<ip>")
      .replace(/:\d{2,}\b/g, ":<port>")
      .replace(/\d{4,}/g, "<n>")
      .slice(0, 240);
    const existing = buckets.get(key);
    if (existing) { existing.count++; existing.hosts.add(e.host ?? ""); }
    else buckets.set(key, { pattern: key, count: 1, sample: e, hosts: new Set([e.host ?? ""]) });
  }
  return [...buckets.values()].sort((a, b) => b.count - a.count);
}

/** Full Spring service detail — Fable diagnosis + dedup'd ERROR entries — inline under a repo. */
function InlineServiceDetail({ serviceName }: { serviceName: string }) {
  const [logs, setLogs] = useState<LogDetailsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ai, setAi] = useState<FableSummary | { error: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null); setLogs(null);
    fetch(`/api/perf/spring/logs/details?service=${encodeURIComponent(serviceName)}&window=1h`)
      .then(async (r) => {
        const j = await r.json();
        if (!alive) return;
        if (!r.ok) { setErr(j.error ?? `HTTP ${r.status}`); return; }
        setLogs(j);
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "Failed to load logs"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [serviceName]);

  const buckets = useMemo(() => (logs ? dedupePattern(logs.entries) : []), [logs]);

  async function askFable() {
    if (aiBusy || !logs) return;
    setAiBusy(true); setAi(null);
    try {
      const res = await fetch("/api/perf/spring/logs/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: serviceName, entries: logs.entries.slice(0, 60) }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setAi(j);
    } catch (e) {
      setAi({ error: e instanceof Error ? e.message : "Fable failed" });
    } finally {
      setAiBusy(false);
    }
  }

  if (loading) return <div className="muted small">Loading log entries…</div>;
  if (err) return <div className="anomaly-banner-clean">{err}</div>;
  if (!logs || logs.entries.length === 0) {
    return <div className="anomaly-banner-clean muted">No ERROR entries in the last hour for {serviceName}.</div>;
  }

  const fableReady = ai && !("error" in ai);
  const fableErr = ai && "error" in ai ? ai.error : null;

  return (
    <div className="inline-svc-detail">
      <div className="inline-svc-toolbar">
        <span className="muted small">
          {logs.entries.length} of {logs.total.toLocaleString()}{logs.truncated ? "+" : ""} ERROR entries · last {logs.window} · {buckets.length} pattern{buckets.length === 1 ? "" : "s"}
        </span>
        <div className="inline-svc-actions">
          <button className="btn-ghost" onClick={() => copyClip(logs.entries.map((e) => `[${e.at ?? "?"}] ${e.host ?? "-"} ${e.message}`).join("\n\n"))}>
            <Copy size={11} /> Copy all
          </button>
          <button className="btn-ghost inline-svc-ask" onClick={askFable} disabled={aiBusy}>
            <Brain size={12} /> {aiBusy ? "Fable thinking…" : fableReady ? "Re-ask Fable" : "Ask Fable"}
          </button>
        </div>
      </div>

      {fableErr && <div className="anomaly-banner">{fableErr}</div>}
      {fableReady && (
        <div className="fable-triage" style={{ marginTop: 8 }}>
          <div className="fable-triage-head">
            <Sparkles size={13} /> Fable diagnosis
            <span className="model-chip">{(ai as FableSummary).model ?? "claude-fable-5"}</span>
          </div>
          <div className="fable-triage-headline">{(ai as FableSummary).headline}</div>
          <div className="fable-triage-fix"><strong>Root cause:</strong> {(ai as FableSummary).rootCause}</div>
          <div className="fable-triage-fix"><strong>Next action:</strong> {(ai as FableSummary).suggestedFix}</div>
        </div>
      )}

      <div className="inline-svc-buckets">
        {buckets.slice(0, 8).map((b, i) => (
          <div key={i} className="inline-svc-bucket">
            <div className="inline-svc-bucket-head">
              <span className={`inline-svc-bucket-count ${b.count >= 10 ? "hot" : b.count >= 3 ? "warm" : ""}`}>×{b.count}</span>
              <span className="inline-svc-bucket-pattern mono">{b.pattern.slice(0, 200)}</span>
              <button className="inline-svc-bucket-copy" onClick={() => copyClip(b.sample.message)} title="Copy sample">
                <Copy size={10} />
              </button>
            </div>
            <div className="muted small inline-svc-bucket-meta">
              {[...b.hosts].filter(Boolean).slice(0, 4).join(" · ") || "no host"}
            </div>
            <div className="inline-svc-bucket-sample mono">{b.sample.message.slice(0, 500)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RepoFindings({ repoFullName, htmlUrl, onClose }: { repoFullName: string; htmlUrl?: string; onClose?: () => void }) {
  const [data, setData] = useState<FindingsResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [springData, setSpringData] = useState<SpringResp | null>(null);
  const [logsData, setLogsData] = useState<LogResp | null>(null);
  const [openSvc, setOpenSvc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    fetch(`/api/security/findings?repo=${encodeURIComponent(repoFullName)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!alive) return;
        if (!r.ok) { setError(j.error ?? `HTTP ${r.status}`); return; }
        setData(j);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Failed to load findings"))
      .finally(() => alive && setLoading(false));
    fetch("/api/perf/spring").then((r) => r.ok ? r.json() : null).then((j) => alive && setSpringData(j)).catch(() => {});
    fetch("/api/perf/spring/logs?window=1h").then((r) => r.ok ? r.json() : null).then((j) => alive && setLogsData(j)).catch(() => {});
    return () => { alive = false; };
  }, [repoFullName]);

  const matchedServices = useMemo(() => {
    const services = springData?.services ?? [];
    if (services.length === 0) return [];
    const repoName = repoFullName.split("/").pop() ?? repoFullName;
    const target = repoName.toLowerCase().replace(/[-_]/g, "");
    const errorLookup = new Map<string, number>();
    for (const s of logsData?.services ?? []) {
      errorLookup.set(s.service.toLowerCase().replace(/[-_]/g, ""), s.errors);
    }
    // Dedup by serviceName — pick the row with the highest score/errors so we don't render the same
    // service twice when Prometheus reports it from multiple scrape targets.
    const bestPerName = new Map<string, { svc: SpringSvc; score: number; errors: number }>();
    for (const svc of services) {
      const nn = svc.serviceName.toLowerCase().replace(/[-_]/g, "");
      let score = 0;
      if (nn === target) score = 100;
      else if (nn.includes(target) || target.includes(nn)) score = Math.min(nn.length, target.length);
      if (score < 3) continue;
      const errors = errorLookup.get(nn) ?? 0;
      const existing = bestPerName.get(svc.serviceName);
      if (!existing || existing.score < score || (existing.score === score && existing.errors < errors)) {
        bestPerName.set(svc.serviceName, { svc, score, errors });
      }
    }
    return [...bestPerName.values()]
      // A→Z alphabetical, as requested — makes the log surface predictable regardless of scrape order.
      .sort((a, b) => a.svc.serviceName.localeCompare(b.svc.serviceName));
  }, [springData, logsData, repoFullName]);

  const triage = data ? buildFableTriage(data.findings) : null;
  const total = data?.findings.length ?? 0;
  const bySev = data?.bySeverity ?? {};

  return (
    <div className="repo-detail">
      <div className="repo-detail-head">
        <div>
          <div className="repo-detail-title">
            <ShieldAlert size={16} strokeWidth={1.75} />
            <strong>{repoFullName}</strong>
            <span className="repo-detail-count">
              {loading ? "loading…" : `${total} finding${total === 1 ? "" : "s"}`}
            </span>
          </div>
          {data && total > 0 && (
            <div className="repo-detail-sev">
              {(["CRIT", "HIGH", "MED", "LOW", "INFO"] as const).map((s) =>
                (bySev[s] ?? 0) > 0 ? (
                  <span key={s} className="sev-chip" style={{ background: SEV_COLOR[s].bg, color: SEV_COLOR[s].fg, borderColor: SEV_COLOR[s].border }}>
                    {s} · {bySev[s]}
                  </span>
                ) : null
              )}
            </div>
          )}
        </div>
        <div className="repo-detail-actions">
          {htmlUrl && (
            <a href={htmlUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost">
              <ExternalLink size={13} /> GitHub
            </a>
          )}
          {onClose && (
            <button className="btn-ghost" onClick={onClose} title="Close">
              <ChevronDown size={14} className="drawer-close-caret" /> Close
            </button>
          )}
        </div>
      </div>

      {triage && (
        <div className="fable-triage">
          <div className="fable-triage-head">
            <Sparkles size={13} /> Fable triage <span className="model-chip">claude-fable-5</span>
          </div>
          <div className="fable-triage-headline">{triage.headline}</div>
          <div className="fable-triage-fix">{triage.suggestedFix}</div>
        </div>
      )}

      {matchedServices.length > 0 && (
        <div className="repo-services-panel">
          <div className="repo-services-head">
            <Sprout size={13} /> Services + logs · A → Z
            <span className="repo-services-count">{matchedServices.length}</span>
          </div>
          <div className="repo-services-rows">
            {matchedServices.map(({ svc, errors }) => {
              const isOpen = openSvc === svc.serviceName;
              return (
                <div key={svc.serviceName} className={`repo-service-row ${isOpen ? "open" : ""}`}>
                  <button
                    type="button"
                    className="repo-service-row-head"
                    onClick={() => setOpenSvc(isOpen ? null : svc.serviceName)}
                    aria-expanded={isOpen}
                  >
                    <span className="repo-service-caret" aria-hidden>
                      {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </span>
                    <strong className="repo-service-name">{svc.serviceName}</strong>
                    <span className={`repo-service-pill ${svc.up ? "up" : "down"}`}>{svc.up ? "UP" : "DOWN"}</span>
                    <span className="repo-service-instance mono muted small">{svc.instance}</span>
                    <span className={`repo-service-errors-inline ${errors > 0 ? "hot" : ""}`}>
                      {errors > 0 ? `${errors.toLocaleString()} ERROR (1h)` : "no errors"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="repo-service-body">
                      <InlineServiceDetail serviceName={svc.serviceName} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading && <div className="empty">Loading findings…</div>}
      {error && <div className="error">{error}</div>}
      {data && total === 0 && !loading && (
        <div className="anomaly-banner-clean">
          <span className="live-dot" /> No open findings — repo is clean per the latest scan.
        </div>
      )}
      {data && total > 0 && <FindingsPanel findings={data.findings} />}
    </div>
  );
}

/* ─── Findings panel ─────────────────────────────────────────────────── */

const CVE_RE = /\b(CVE-\d{4}-\d{4,7})\b/i;

function parseTrivyTitle(title: string): { cve?: string; pkg?: string; ver?: string } {
  // Trivy titles look like: "CVE-2019-13990: org.quartz-scheduler:quartz 2.2.1"
  const m = title.match(/^(CVE-\d{4}-\d{4,7}):\s*([^\s]+)(?:\s+([\w\d.-]+))?/i);
  if (m) return { cve: m[1], pkg: m[2], ver: m[3] };
  const c = title.match(CVE_RE);
  return c ? { cve: c[1] } : {};
}

function cleanPath(p: string | null): string | null {
  if (!p) return null;
  // Trivy stores absolute paths like /tmp/natasha-scan-2-xxx/foo/bar.yml — strip the scan-tmp prefix.
  return p.replace(/^\/tmp\/natasha-scan-\d+-[A-Za-z0-9]+\//, "");
}

function FindingsPanel({ findings }: { findings: Finding[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string | "all">("all");
  const [scannerFilter, setScannerFilter] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(50);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return findings.filter((f) => {
      if (severityFilter !== "all" && f.severity !== severityFilter) return false;
      if (scannerFilter !== "all" && f.scanner !== scannerFilter) return false;
      if (!q) return true;
      return (
        (f.title ?? "").toLowerCase().includes(q) ||
        (f.ruleId ?? "").toLowerCase().includes(q) ||
        (f.file ?? "").toLowerCase().includes(q) ||
        (f.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [findings, severityFilter, scannerFilter, search]);

  const shown = filtered.slice(0, pageSize);
  const bySev: Record<string, number> = {};
  for (const f of findings) bySev[f.severity] = (bySev[f.severity] ?? 0) + 1;
  const scanners = Array.from(new Set(findings.map((f) => f.scanner)));

  return (
    <div className="findings-panel">
      <div className="findings-toolbar">
        <input
          className="findings-search"
          placeholder="Search rule, title, file, or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="findings-chips">
          {(["all", "CRIT", "HIGH", "MED", "LOW", "INFO"] as const).map((s) => {
            const n = s === "all" ? findings.length : bySev[s] ?? 0;
            if (s !== "all" && n === 0) return null;
            const c = s === "all" ? { bg: "rgba(139,92,246,0.14)", fg: "#c4b5fd", border: "rgba(139,92,246,0.35)" } : SEV_COLOR[s];
            const active = severityFilter === s;
            return (
              <button
                key={s}
                className={`findings-chip ${active ? "active" : ""}`}
                style={active ? { background: c.bg, color: c.fg, borderColor: c.border } : undefined}
                onClick={() => setSeverityFilter(s)}
              >
                {s} <span className="findings-chip-count">{n}</span>
              </button>
            );
          })}
          <span className="findings-chip-sep">·</span>
          {(["all", ...scanners] as const).map((sc) => {
            const n = sc === "all" ? findings.length : findings.filter((f) => f.scanner === sc).length;
            const active = scannerFilter === sc;
            return (
              <button key={sc} className={`findings-chip ${active ? "active" : ""}`} onClick={() => setScannerFilter(sc)}>
                {sc === "all" ? "All scanners" : sc} <span className="findings-chip-count">{n}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="findings-list-wrap">
        {shown.length === 0 && <div className="empty">No findings match current filters.</div>}
        {shown.map((f) => (
          <FindingRow
            key={f.id}
            f={f}
            open={openId === f.id}
            onToggle={() => setOpenId(openId === f.id ? null : f.id)}
          />
        ))}
      </div>
      {filtered.length > shown.length && (
        <div className="findings-more">
          Showing {shown.length} of {filtered.length}{" "}
          <button className="btn-ghost" onClick={() => setPageSize((p) => p + 50)}>Show 50 more</button>
          <button className="btn-ghost" onClick={() => setPageSize(filtered.length)}>Show all</button>
        </div>
      )}
    </div>
  );
}

function FindingRow({ f, open, onToggle }: { f: Finding; open: boolean; onToggle: () => void }) {
  const c = SEV_COLOR[f.severity] ?? SEV_COLOR.INFO;
  const parsed = parseTrivyTitle(f.title ?? "");
  const cve = parsed.cve;
  const pkg = parsed.pkg;
  const ver = parsed.ver;
  const cleanFile = cleanPath(f.file);
  const scannerLabel = f.scanner === "gitleaks" ? "🔑 gitleaks" : f.scanner === "trivy" ? "🐛 trivy" : f.scanner;
  return (
    <div className={`finding-row ${open ? "open" : ""}`}>
      <button className="finding-row-head" onClick={onToggle} aria-expanded={open}>
        <span className="finding-caret">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
        <span className="sev-chip finding-sev" style={{ background: c.bg, color: c.fg, borderColor: c.border }}>{f.severity}</span>
        <span className="finding-scanner mono small">{scannerLabel}</span>
        {cve ? (
          <a
            href={`https://nvd.nist.gov/vuln/detail/${cve}`}
            target="_blank" rel="noopener noreferrer"
            className="finding-cve"
            onClick={(e) => e.stopPropagation()}
            title="Open on NVD"
          >
            {cve} <ExternalLink size={9} />
          </a>
        ) : (
          <span className="finding-rule mono small" title={f.ruleId}>{f.ruleId}</span>
        )}
        <span className="finding-title">
          {pkg ? <span className="finding-pkg mono">{pkg}{ver ? ` @ ${ver}` : ""}</span> : null}
          <span className="finding-title-txt">{pkg && f.description ? f.description.split(":")[1]?.trim() ?? f.title : f.title}</span>
        </span>
        {cleanFile && <span className="finding-file mono small">{cleanFile}{f.line ? `:${f.line}` : ""}</span>}
      </button>
      {open && (
        <div className="finding-detail">
          <div className="finding-detail-grid">
            <div className="finding-detail-field"><div className="lbl">Rule id</div><div className="val mono">{f.ruleId}</div></div>
            <div className="finding-detail-field"><div className="lbl">Category</div><div className="val">{f.category || "—"}</div></div>
            {pkg && <div className="finding-detail-field"><div className="lbl">Package</div><div className="val mono">{pkg}{ver ? ` @ ${ver}` : ""}</div></div>}
            {cleanFile && <div className="finding-detail-field"><div className="lbl">File</div><div className="val mono">{cleanFile}{f.line ? `:${f.line}` : ""}</div></div>}
            <div className="finding-detail-field"><div className="lbl">First seen</div><div className="val">{new Date(f.firstSeenAt).toLocaleString()}</div></div>
            <div className="finding-detail-field"><div className="lbl">Last seen</div><div className="val">{new Date(f.lastSeenAt).toLocaleString()}</div></div>
          </div>
          {f.description && (
            <div className="finding-desc-block">
              <div className="lbl">Description / detected content</div>
              <pre className="finding-desc-body">{f.description}</pre>
            </div>
          )}
          {cve && (
            <div className="finding-cve-links">
              <a href={`https://nvd.nist.gov/vuln/detail/${cve}`} target="_blank" rel="noopener noreferrer" className="btn-ghost">
                <ExternalLink size={11} /> NVD
              </a>
              <a href={`https://cve.mitre.org/cgi-bin/cvename.cgi?name=${cve}`} target="_blank" rel="noopener noreferrer" className="btn-ghost">
                <ExternalLink size={11} /> MITRE
              </a>
              {pkg && (
                <a href={`https://www.google.com/search?q=${encodeURIComponent(cve + " " + pkg + " fixed version")}`} target="_blank" rel="noopener noreferrer" className="btn-ghost">
                  <ExternalLink size={11} /> Search fix
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
