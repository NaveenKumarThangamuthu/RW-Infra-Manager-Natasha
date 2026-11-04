"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Shield, RefreshCw, ExternalLink, FileText, CheckCircle2,
  AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, Search,
  ChevronRight, TrendingUp, TrendingDown, Minus,
} from "lucide-react";

type Sev = "BLOCKER" | "CRITICAL" | "MAJOR" | "MINOR" | "INFO";
type IssueType = "BUG" | "VULNERABILITY" | "CODE_SMELL" | "SECURITY_HOTSPOT";

interface TopIssue { severity: Sev; type: IssueType; message: string; rule: string; component: string; line: number | null }
interface Trend {
  priorAt: string;
  bugs: number; criticals: number; blockers: number;
  smells: number; hotspots: number; vulns: number;
}
interface Service {
  repo: string;
  branch: string;
  sonarProject: string | null;
  gate: string | null;
  lastAnalysis: string | null;
  health: { key: "good" | "fair" | "poor" | "critical" | "unknown"; label: string; cls: string };
  measures: Record<string, string> | null;
  severityBreakdown: Partial<Record<Sev, number>> | null;
  typeBreakdown: Partial<Record<IssueType, number>> | null;
  totalIssues: number;
  topIssues: TopIssue[];
  trend?: Trend | null;
}
interface DataResp {
  ok: boolean;
  hasData: boolean;
  generatedAt?: string;
  scope?: string;
  versionFilter?: string | null;
  totals?: { bugs: number; vulns: number; hotspots: number; smells: number; ncloc: number; scanned: number; notScanned: number };
  healthDistribution?: Record<string, number>;
  branches?: Array<{ branch: string; count: number; scanned: number; bugs: number; vulns: number; hotspots: number; smells: number; ncloc: number }>;
  services?: Service[];
  error?: string;
}
interface LatestResp {
  ok: boolean; hasReport: boolean;
  date?: string; generatedAt?: string;
  indexHtml?: string; productionHtml?: string; productionPdf?: string;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmt = (v: unknown) => num(v).toLocaleString("en-IN");
const pct = (v: unknown) => v === null || v === undefined || v === "" ? "—" : `${Number(v).toFixed(1)}%`;
const ratingLetter = (v: unknown) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Math.round(Number(v));
  return ({ 1: "A", 2: "B", 3: "C", 4: "D", 5: "E" } as Record<number, string>)[n] || "—";
};
function fmtIST(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true });
}
function relTime(iso?: string) {
  if (!iso) return "—";
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

type SortKey = "health" | "repo" | "gate" | "blocker" | "critical" | "bugs" | "vulns" | "hotspots" | "smells" | "coverage" | "ncloc";
type SortDir = "asc" | "desc";

const HEALTH_ORDER: Record<string, number> = { critical: 0, poor: 1, fair: 2, good: 3, unknown: 4 };

export default function SonarPage() {
  const [data, setData] = useState<DataResp | null>(null);
  const [latest, setLatest] = useState<LatestResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [q, setQ] = useState("");
  const [showOnly, setShowOnly] = useState<"all" | "critical" | "scanned" | "notScanned">("all");
  const [sortKey, setSortKey] = useState<SortKey>("health");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expanded, setExpanded] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const [d, l] = await Promise.all([
        fetch("/api/sonar/data", { cache: "no-store" }).then((r) => r.ok ? r.json() : null),
        fetch("/api/sonar/latest", { cache: "no-store" }).then((r) => r.ok ? r.json() : null),
      ]);
      setData(d);
      setLatest(l);
    } catch (e) {
      setMsg({ type: "err", text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadAll(); }, []);

  async function refreshNow() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/sonar/refresh", { method: "POST" });
      const j = await r.json();
      if (j.ok) setMsg({ type: "ok", text: `Refreshed in ${(j.ranMs / 1000).toFixed(1)}s.` });
      else setMsg({ type: "err", text: j.error || `Refresh failed (exit ${j.scriptExit}).` });
    } catch (e) {
      setMsg({ type: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
      loadAll();
    }
  }

  const filtered = useMemo(() => {
    const all = data?.services ?? [];
    const search = q.trim().toLowerCase();
    let rows = all;
    if (search) rows = rows.filter((s) => s.repo.toLowerCase().includes(search) || s.branch.toLowerCase().includes(search));
    if (showOnly === "critical") rows = rows.filter((s) => s.health.key === "critical" || s.health.key === "poor");
    if (showOnly === "scanned") rows = rows.filter((s) => s.sonarProject);
    if (showOnly === "notScanned") rows = rows.filter((s) => !s.sonarProject);
    return rows;
  }, [data, q, showOnly]);

  const sorted = useMemo(() => {
    const sign = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = keyValue(a, sortKey);
      const vb = keyValue(b, sortKey);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sign;
      return String(va).localeCompare(String(vb)) * sign;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "health" || k === "repo" ? "asc" : "desc"); }
  }

  const totals = data?.totals;
  const health = data?.healthDistribution ?? {};

  return (
    <>
      <div className="sonar-hero">
        <div className="sonar-hero-inner">
          <div>
            <div className="sonar-eyebrow"><Shield size={12} /> RW 3.0 · CODE QUALITY</div>
            <h1 className="sonar-title">Sonar Code Quality Report</h1>
            <p className="sonar-lede">
              A live snapshot of code health, defect load and security posture across the RW 3.0 service portfolio. Every service listed on the Summary sheet with Version = 3 is cross-referenced against the internal SonarQube server.
            </p>
            <div className="sonar-prepared">Prepared by <strong>Natasha Infra Manager</strong></div>
          </div>
          <div className="sonar-hero-meta">
            <div className="sonar-hero-meta-row"><span>Report ID</span><strong>SONAR-{new Date().toISOString().slice(0,10).replace(/-/g,"")}</strong></div>
            <div className="sonar-hero-meta-row"><span>Prepared on</span><strong>{new Date().toISOString().slice(0,10)}</strong></div>
            <div className="sonar-hero-meta-row"><span>Data source</span><strong>SonarQube (Community Edition)</strong></div>
            {data?.generatedAt && <div className="sonar-hero-meta-row"><span>Last scan</span><strong>{relTime(data.generatedAt)}</strong></div>}
          </div>
        </div>
      </div>

      {msg && (
        <div className={`sonar-banner ${msg.type}`}>
          {msg.type === "ok" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          <span>{msg.text}</span>
        </div>
      )}

      <div className="panel sonar-actions-panel">
        <div className="sonar-actions">
          <div className="sonar-latest">
            {loading ? "Loading latest scan…"
             : data?.generatedAt
               ? <>Latest scan generated <strong>{fmtIST(data.generatedAt)} IST</strong> · {relTime(data.generatedAt)}</>
               : "No scan on disk yet."}
          </div>
          <div className="sonar-actions-right">
            {latest?.productionPdf && (
              <a href={latest.productionPdf} target="_blank" rel="noopener" className="sonar-btn">
                <FileText size={13} /> PDF report
              </a>
            )}
            {latest?.productionHtml && (
              <a href={latest.productionHtml} target="_blank" rel="noopener" className="sonar-btn">
                <ExternalLink size={13} /> Full HTML view
              </a>
            )}
            <button onClick={refreshNow} disabled={busy} className="sonar-btn sonar-btn-primary">
              <RefreshCw size={13} className={busy ? "sonar-spin" : ""} />
              {busy ? "Refreshing…" : "Refresh now"}
            </button>
          </div>
        </div>
      </div>

      {totals && (
        <>
          <div className="sonar-exec">
            <div className="sonar-exec-label">Executive summary</div>
            <p>
              Across <strong>{data?.services?.length ?? 0} services</strong> in the RW 3.0 bucket,{" "}
              <strong>{totals.scanned} ({Math.round((totals.scanned / (data?.services?.length || 1)) * 100)}%)</strong> are actively scanned by SonarQube;{" "}
              <strong>{totals.notScanned} are not yet enrolled</strong>. Health distribution:{" "}
              <strong>{num(health.critical)} needing urgent attention</strong>,{" "}
              <strong>{num(health.poor)} at high risk</strong>,{" "}
              {num(health.fair)} with some risk, {num(health.good)} healthy.
            </p>
            <p>
              The scanned code base holds <strong>{fmt(totals.bugs)} known bugs</strong>,{" "}
              <strong>{fmt(totals.vulns)} security vulnerabilities</strong>,{" "}
              <strong>{fmt(totals.hotspots)} security hotspots</strong>, and{" "}
              <strong>{fmt(totals.smells)} maintainability issues</strong> across{" "}
              <strong>{fmt(totals.ncloc)}</strong> lines of production code.
            </p>
          </div>

          <div className="sonar-kpi-row">
            <KPI label="Services scanned"       value={fmt(totals.scanned)}    hint="Actively covered by SonarQube" />
            <KPI label="Not yet scanned"        value={fmt(totals.notScanned)} hint="Awaiting Sonar onboarding" />
            <KPI label="Bugs"                   value={fmt(totals.bugs)}       hint="Runtime defects" />
            <KPI label="Vulnerabilities"        value={fmt(totals.vulns)}      hint="Known security weaknesses" />
            <KPI label="Security hotspots"      value={fmt(totals.hotspots)}   hint="Sensitive code · needs review" />
            <KPI label="Maintainability issues" value={fmt(totals.smells)}     hint="Code smells" />
            <KPI label="Lines of code"          value={fmt(totals.ncloc)}      hint="Source lines (no comments)" />
          </div>
        </>
      )}

      <div className="panel sonar-table-panel">
        <div className="sonar-table-head">
          <div>
            <h2>Service-by-service breakdown</h2>
            <div className="desc small">Composite health chip = SonarQube quality gate + open blocker/critical count. Click any row to see its top open issues. Column headers sort.</div>
          </div>
        </div>
        <div className="sonar-toolbar">
          <div className="sonar-toolbar-inner">
            <div className="sonar-search">
              <Search size={13} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter services…" />
            </div>
            <div className="sonar-filter-chips">
              <button className={showOnly === "all" ? "active" : ""} onClick={() => setShowOnly("all")}>All ({data?.services?.length ?? 0})</button>
              <button className={showOnly === "critical" ? "active" : ""} onClick={() => setShowOnly("critical")}>At risk ({(num(health.critical) + num(health.poor))})</button>
              <button className={showOnly === "scanned" ? "active" : ""} onClick={() => setShowOnly("scanned")}>Scanned ({totals?.scanned ?? 0})</button>
              <button className={showOnly === "notScanned" ? "active" : ""} onClick={() => setShowOnly("notScanned")}>Not scanned ({totals?.notScanned ?? 0})</button>
            </div>
            <div className="sonar-toolbar-count">{sorted.length} shown</div>
          </div>
        </div>

        <div className="sonar-table-scroll">
          <table className="sonar-svc-table">
            <colgroup>
              <col style={{ width: 110 }} /><col /><col style={{ width: 130 }} /><col style={{ width: 84 }} />
              <col style={{ width: 60 }} /><col style={{ width: 60 }} />
              <col style={{ width: 62 }} /><col style={{ width: 62 }} /><col style={{ width: 68 }} /><col style={{ width: 68 }} />
              <col style={{ width: 72 }} /><col style={{ width: 92 }} /><col style={{ width: 110 }} />
            </colgroup>
            <thead>
              <tr>
                <Th k="health" cur={sortKey} dir={sortDir} onClick={toggleSort}>Health</Th>
                <Th k="repo" cur={sortKey} dir={sortDir} onClick={toggleSort}>Service</Th>
                <th>Branch</th>
                <Th k="gate" cur={sortKey} dir={sortDir} onClick={toggleSort}>Gate</Th>
                <Th k="blocker" cur={sortKey} dir={sortDir} onClick={toggleSort} num>Blocker</Th>
                <Th k="critical" cur={sortKey} dir={sortDir} onClick={toggleSort} num>Critical</Th>
                <Th k="bugs" cur={sortKey} dir={sortDir} onClick={toggleSort} num>Bugs</Th>
                <Th k="vulns" cur={sortKey} dir={sortDir} onClick={toggleSort} num>Vulns</Th>
                <Th k="hotspots" cur={sortKey} dir={sortDir} onClick={toggleSort} num>Hotspots</Th>
                <Th k="smells" cur={sortKey} dir={sortDir} onClick={toggleSort} num>Smells</Th>
                <Th k="coverage" cur={sortKey} dir={sortDir} onClick={toggleSort} num>Coverage</Th>
                <Th k="ncloc" cur={sortKey} dir={sortDir} onClick={toggleSort} num>Lines of code</Th>
                <th>Ratings</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={13} className="sonar-empty">No services match the current filter.</td></tr>
              )}
              {sorted.map((s) => {
                const key = s.repo + "@" + s.branch;
                return (
                  <Row
                    key={key}
                    s={s}
                    expanded={expanded === key}
                    onToggle={() => setExpanded(expanded === key ? null : key)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel sonar-glossary-panel">
        <h2>What the metrics mean</h2>
        <div className="desc small">Quick glossary — please read once before scanning the numbers above.</div>
        <div className="sonar-glossary">
          <Gloss term="Bugs" def="Defects that will misbehave at runtime (crashes, wrong results). Real risk to customers." />
          <Gloss term="Vulnerabilities" def="Security weaknesses. Attackers could exploit these to compromise data or the service." />
          <Gloss term="Security hotspots" def="Sensitive code (auth, secrets, crypto). Needs a human security review — not necessarily broken." />
          <Gloss term="Code smells" def="Maintainability issues. Slow the team down over time; don't break anything today." />
          <Gloss term="Quality gate" def="Sonar's pass/fail verdict on the last analysis. Fail = one of the team's thresholds was breached." />
          <Gloss term="Lines of code (NCLOC)" def="Real source lines; blank lines and comments excluded. A measure of how big the codebase is." />
          <Gloss term="Coverage" def="Share of code exercised by automated tests. Higher = safer to change." />
          <Gloss term="Ratings (A → E)" def="Sonar's 5-grade grade. A clean, E many issues. Three ratings shown: Reliability · Security · Maintainability." />
        </div>
      </div>

      <div className="foot small">
        <strong>Prepared by Natasha Infra Manager</strong> · Data pulled directly from the internal SonarQube server · Confidential · For internal stakeholder review only
      </div>

      <style jsx>{`
        .sonar-hero {
          margin: -8px 0 22px;
          padding: 32px 30px 26px;
          border-radius: 16px;
          background: linear-gradient(135deg, rgba(129,140,248,0.14), rgba(52,211,153,0.06));
          border: 1px solid rgba(129,140,248,0.22);
        }
        .sonar-hero-inner { display: flex; justify-content: space-between; align-items: flex-start; gap: 30px; flex-wrap: wrap; }
        .sonar-eyebrow {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 11px; letter-spacing: 0.14em; font-weight: 700;
          color: var(--accent); text-transform: uppercase; margin-bottom: 12px;
        }
        .sonar-title { margin: 0 0 8px; font-size: 30px; letter-spacing: -0.02em; font-weight: 800; }
        .sonar-lede { color: var(--muted); font-size: 14px; max-width: 720px; margin: 0 0 14px; line-height: 1.55; }
        .sonar-prepared {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 12.5px; padding: 5px 12px; border-radius: 999px;
          background: rgba(129,140,248,0.12); border: 1px solid rgba(129,140,248,0.28);
          color: var(--muted);
        }
        .sonar-prepared strong { color: var(--accent); font-weight: 600; }
        .sonar-hero-meta { text-align: right; color: var(--muted); font-size: 12.5px; line-height: 1.9; }
        .sonar-hero-meta-row { display: flex; gap: 12px; justify-content: flex-end; }
        .sonar-hero-meta-row span { color: var(--muted-soft); }
        .sonar-hero-meta-row strong { color: var(--text); font-weight: 500; }
        @media (max-width: 800px) {
          .sonar-hero-meta { text-align: left; }
          .sonar-hero-meta-row { justify-content: flex-start; }
        }

        .sonar-banner {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 8px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 14px;
        }
        .sonar-banner.ok { background: rgba(52,211,153,0.1); color: #34d399; border: 1px solid #065f46; }
        .sonar-banner.err { background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid #7f1d1d; }

        .sonar-actions-panel { padding: 14px 20px; }
        .sonar-actions { display: flex; justify-content: space-between; align-items: center; gap: 14px; flex-wrap: wrap; }
        .sonar-latest { color: var(--muted); font-size: 13px; }
        .sonar-latest strong { color: var(--text); font-weight: 600; }
        .sonar-actions-right { display: flex; gap: 8px; flex-wrap: wrap; }
        .sonar-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 12px; border-radius: 8px; font-size: 13px; font-weight: 500;
          background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
          text-decoration: none; cursor: pointer; transition: all 0.15s ease;
        }
        .sonar-btn:hover { border-color: var(--accent); color: var(--accent); }
        .sonar-btn-primary { background: var(--accent); color: white; border-color: var(--accent); }
        .sonar-btn-primary:hover { color: white; background: var(--accent-2); border-color: var(--accent-2); }
        .sonar-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
        .sonar-spin { animation: sonar-spin 1s linear infinite; }
        @keyframes sonar-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }

        .sonar-exec {
          background: linear-gradient(135deg, rgba(129,140,248,0.08), rgba(52,211,153,0.03));
          border: 1px solid rgba(129,140,248,0.2);
          border-radius: 14px; padding: 20px 24px; margin-bottom: 22px;
        }
        .sonar-exec-label { font-size: 11px; letter-spacing: 0.06em; font-weight: 700; color: var(--accent); text-transform: uppercase; margin-bottom: 8px; }
        .sonar-exec p { color: var(--text); margin: 8px 0; line-height: 1.65; font-size: 14px; }
        .sonar-exec strong { font-weight: 600; }

        .sonar-kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 22px; }

        .sonar-table-panel { padding: 20px 24px 6px; }
        .sonar-table-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
        .sonar-toolbar {
          position: sticky; top: 0; z-index: 6;
          margin: 0 -24px 12px;
          padding: 10px 24px;
          background: rgba(20, 26, 46, 0.85);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          border-bottom: 1px solid var(--border);
        }
        .sonar-toolbar-inner { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .sonar-toolbar-count { margin-left: auto; color: var(--muted); font-size: 12px; }
        :global(html[data-theme="light"]) .sonar-toolbar { background: rgba(248, 250, 252, 0.9); }
        .sonar-search { display: inline-flex; align-items: center; gap: 6px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 4px 10px; }
        .sonar-search input { background: transparent; border: 0; color: var(--text); outline: none; font-size: 13px; width: 220px; }
        .sonar-filter-chips { display: inline-flex; gap: 4px; }
        .sonar-filter-chips button { background: var(--panel-2); color: var(--muted); border: 1px solid var(--border); padding: 5px 10px; border-radius: 8px; font-size: 12px; cursor: pointer; }
        .sonar-filter-chips button:hover { color: var(--text); }
        .sonar-filter-chips button.active { background: var(--accent); color: white; border-color: var(--accent); }
        .sonar-table-scroll { overflow-x: auto; overflow-y: auto; max-height: calc(100vh - 260px); min-height: 300px; border-radius: 8px; }

        /* Row expansion */
        :global(.sonar-svc-table tbody tr[data-expanded="true"]) { background: rgba(129,140,248,0.06); }
        :global(.sonar-svc-table tbody tr[data-expandable="true"]) { cursor: pointer; }
        :global(.sonar-svc-table tbody tr[data-expandable="true"]:hover) { background: rgba(129,140,248,0.04); }
        :global(.sonar-caret) { display: inline-block; transition: transform 0.15s ease; color: var(--muted); }
        :global(.sonar-caret.open) { transform: rotate(90deg); color: var(--accent); }
        :global(.sonar-expansion) { background: rgba(20, 26, 46, 0.4); border-top: 1px dashed var(--border); border-bottom: 1px dashed var(--border); }
        :global(html[data-theme="light"]) :global(.sonar-expansion) { background: #f8fafc; }
        :global(.sonar-issue-list) { max-width: 100%; overflow-x: auto; margin: 12px 0; }
        :global(.sonar-issue-list table) { min-width: 800px; }
        :global(.sonar-issue-list th) { color: var(--muted); font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; padding: 6px 8px; }
        :global(.sonar-issue-list td) { padding: 6px 8px; font-size: 12px; vertical-align: top; }
        :global(.sonar-issue-list .msg) { color: var(--text); max-width: 460px; }
        :global(.sonar-issue-list .file) { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
        :global(.sonar-issue-list .rule) { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
        :global(.sonar-more-link) { margin-top: 8px; font-size: 12px; }

        .sonar-empty { text-align: center; color: var(--muted); padding: 20px; }
        .foot { margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--border); color: var(--muted); text-align: center; }
        .foot strong { color: var(--text); font-weight: 600; }

        .sonar-glossary { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin-top: 4px; }
      `}</style>
    </>
  );
}

function keyValue(s: Service, k: SortKey): number | string {
  switch (k) {
    case "health": return HEALTH_ORDER[s.health.key] ?? 99;
    case "repo": return s.repo.toLowerCase();
    case "gate": return s.gate === "ERROR" ? 0 : s.gate === "OK" ? 2 : 1;
    case "blocker": return num(s.severityBreakdown?.BLOCKER);
    case "critical": return num(s.severityBreakdown?.CRITICAL);
    case "bugs": return num(s.measures?.bugs);
    case "vulns": return num(s.measures?.vulnerabilities);
    case "hotspots": return num(s.measures?.security_hotspots);
    case "smells": return num(s.measures?.code_smells);
    case "coverage": return num(s.measures?.coverage);
    case "ncloc": return num(s.measures?.ncloc);
  }
}

function Th({ k, cur, dir, onClick, children, num }: { k: SortKey; cur: SortKey; dir: SortDir; onClick: (k: SortKey) => void; children: React.ReactNode; num?: boolean }) {
  const active = cur === k;
  return (
    <th
      onClick={() => onClick(k)}
      style={{ cursor: "pointer", textAlign: num ? "right" : "left", userSelect: "none" }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, opacity: active ? 1 : 0.75 }}>
        {children}
        {!active && <ArrowUpDown size={10} style={{ opacity: 0.4 }} />}
        {active && dir === "asc" && <ArrowUp size={10} />}
        {active && dir === "desc" && <ArrowDown size={10} />}
      </span>
    </th>
  );
}

function KPI({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="panel" style={{ padding: 14, margin: 0 }}>
      <div style={{ color: "var(--muted)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{value}</div>
      <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 4, lineHeight: 1.35 }}>{hint}</div>
    </div>
  );
}

function Gloss({ term, def }: { term: string; def: string }) {
  return (
    <div style={{ padding: "12px 14px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{term}</div>
      <div style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.5 }}>{def}</div>
    </div>
  );
}

function healthColor(key: string) {
  if (key === "critical") return { color: "#fca5a5", background: "rgba(239,68,68,0.14)", border: "#7f1d1d" };
  if (key === "poor")     return { color: "#fdba74", background: "rgba(249,115,22,0.14)", border: "#7c2d12" };
  if (key === "fair")     return { color: "#fcd34d", background: "rgba(245,158,11,0.14)", border: "#92400e" };
  if (key === "good")     return { color: "#6ee7b7", background: "rgba(52,211,153,0.14)", border: "#065f46" };
  return { color: "var(--muted)", background: "rgba(148,163,184,0.10)", border: "var(--border)" };
}
function ratingColor(letter: string) {
  const m: Record<string, string> = { A: "#16a34a", B: "#65a30d", C: "#d97706", D: "#ea580c", E: "#dc2626" };
  return m[letter] || "#94a3b8";
}

function Row({ s, expanded, onToggle }: { s: Service; expanded: boolean; onToggle: () => void }) {
  const h = s.health;
  const hc = healthColor(h.key);
  const sev = s.severityBreakdown || {};
  const m = s.measures || {};
  const gate = s.gate ?? "—";
  const gateOk = gate === "OK";
  const gateErr = gate === "ERROR";
  const rBug = ratingLetter(m.reliability_rating);
  const rSec = ratingLetter(m.security_rating);
  const rMaint = ratingLetter(m.sqale_rating);

  if (!s.sonarProject) {
    return (
      <tr className="sonar-not-scanned">
        <td><span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 999, fontSize: 10.5, fontWeight: 600, color: hc.color, background: hc.background, border: `1px solid ${hc.border}` }}>Not scanned</span></td>
        <td><strong>{s.repo}</strong></td>
        <td className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>{s.branch}</td>
        <td colSpan={10} style={{ color: "var(--muted)", fontStyle: "italic", fontSize: 12.5 }}>Service not yet enrolled in SonarQube</td>
      </tr>
    );
  }

  return (
    <>
      <tr
        data-expandable="true"
        data-expanded={expanded}
        onClick={(e) => {
          // Don't toggle when clicking on the service-name link
          if ((e.target as HTMLElement).closest("a")) return;
          onToggle();
        }}
      >
        <td>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <ChevronRight size={12} className={`sonar-caret ${expanded ? "open" : ""}`} />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 999, fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap", color: hc.color, background: hc.background, border: `1px solid ${hc.border}` }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: hc.color }} />
              {h.label}
            </span>
          </span>
        </td>
        <td>
          <a href={`http://192.168.16.202:9000/dashboard?id=${encodeURIComponent(s.sonarProject)}`} target="_blank" rel="noopener" style={{ color: "var(--text)", fontWeight: 600, textDecoration: "none" }}>
            {s.repo}
          </a>
        </td>
        <td className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>{s.branch}</td>
        <td>
          <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, color: gateOk ? "#6ee7b7" : gateErr ? "#fca5a5" : "#fcd34d", background: gateOk ? "rgba(52,211,153,0.1)" : gateErr ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)", border: `1px solid ${gateOk ? "#065f46" : gateErr ? "#7f1d1d" : "#92400e"}` }}>
            {gateOk ? "Passed" : gateErr ? "Failed" : gate}
          </span>
        </td>
        <td className="num"><SevChip severity="BLOCKER" count={num(sev.BLOCKER)} /></td>
        <td className="num"><SevChip severity="CRITICAL" count={num(sev.CRITICAL)} /></td>
        <td className="num">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
            {fmt(m.bugs)}
            <TrendArrow delta={s.trend?.bugs} />
          </span>
        </td>
        <td className="num">{fmt(m.vulnerabilities)}</td>
        <td className="num">{fmt(m.security_hotspots)}</td>
        <td className="num">{fmt(m.code_smells)}</td>
        <td className="num">{pct(m.coverage)}</td>
        <td className="num">{fmt(m.ncloc)}</td>
        <td>
          <span style={{ display: "inline-flex", gap: 3, whiteSpace: "nowrap" }}>
            <Rating letter={rBug} />
            <Rating letter={rSec} />
            <Rating letter={rMaint} />
          </span>
        </td>
      </tr>
      {expanded && (
        <tr className="sonar-expansion">
          <td colSpan={13}>
            <ExpandedIssues s={s} />
          </td>
        </tr>
      )}
    </>
  );
}

function TrendArrow({ delta }: { delta: number | undefined }) {
  if (delta === undefined || delta === null) return null;
  if (delta === 0) return <span style={{ color: "var(--muted-soft)", fontSize: 10 }} title="No change since last scan"><Minus size={11} /></span>;
  const better = delta < 0; // fewer bugs = better
  const color = better ? "#34d399" : "#f87171";
  const Icon = better ? TrendingDown : TrendingUp;
  const sign = delta > 0 ? "+" : "";
  return (
    <span style={{ color, display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, fontWeight: 600 }} title={`${sign}${delta} vs last scan`}>
      <Icon size={11} />
      {sign}{delta}
    </span>
  );
}

function ExpandedIssues({ s }: { s: Service }) {
  const issues = s.topIssues ?? [];
  if (!issues.length) {
    return (
      <div style={{ padding: "14px 20px", color: "var(--muted)", fontSize: 13 }}>
        No open issues to show for this service.
      </div>
    );
  }
  return (
    <div style={{ padding: "12px 16px 4px" }}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Top {issues.length} of {fmt(s.totalIssues)} open issues (highest severity first)</span>
        <a href={`http://192.168.16.202:9000/project/issues?id=${encodeURIComponent(s.sonarProject!)}&resolved=false`} target="_blank" rel="noopener" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          See all in SonarQube <ExternalLink size={11} />
        </a>
      </div>
      <div className="sonar-issue-list">
        <table>
          <thead>
            <tr>
              <th style={{ width: 82 }}>Severity</th>
              <th style={{ width: 120 }}>Type</th>
              <th>Message</th>
              <th style={{ width: 200 }}>File</th>
              <th style={{ width: 140 }}>Rule</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((i, idx) => (
              <tr key={idx}>
                <td><SevChip severity={i.severity} count={1} labelOverride={i.severity} /></td>
                <td><TypeChip type={i.type} /></td>
                <td className="msg">{i.message}</td>
                <td className="file">{i.component}{i.line ? `:${i.line}` : ""}</td>
                <td className="rule">{i.rule}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TypeChip({ type }: { type: IssueType }) {
  const map: Record<IssueType, { bg: string; color: string; border: string }> = {
    BUG:              { bg: "rgba(220,38,38,0.14)", color: "#fca5a5", border: "#7f1d1d" },
    VULNERABILITY:    { bg: "rgba(239,68,68,0.14)", color: "#fecaca", border: "#991b1b" },
    CODE_SMELL:       { bg: "rgba(245,158,11,0.14)", color: "#fcd34d", border: "#92400e" },
    SECURITY_HOTSPOT: { bg: "rgba(139,92,246,0.14)", color: "#ddd6fe", border: "#5b21b6" },
  };
  const s = map[type] || { bg: "rgba(129,140,248,0.14)", color: "#c7d2fe", border: "#3730a3" };
  return <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 4, fontSize: 10.5, fontWeight: 600, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{type.replace("_", " ")}</span>;
}

function SevChip({ severity, count, labelOverride }: { severity: Sev; count: number; labelOverride?: string }) {
  if (!labelOverride && !count) return <span style={{ color: "var(--muted-soft)" }}>0</span>;
  const bg = severity === "BLOCKER" ? "#450a0a" : severity === "CRITICAL" ? "#dc2626" : severity === "MAJOR" ? "#ea580c" : severity === "MINOR" ? "#0284c7" : "#94a3b8";
  return <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 4, background: bg, color: "white", fontWeight: 700, fontSize: 11 }}>{labelOverride ?? fmt(count)}</span>;
}

function Rating({ letter }: { letter: string }) {
  const c = ratingColor(letter);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 22, height: 22, borderRadius: 5, fontSize: 11.5, fontWeight: 800,
      background: letter === "—" ? "#334155" : c, color: "white",
    }}>{letter}</span>
  );
}
