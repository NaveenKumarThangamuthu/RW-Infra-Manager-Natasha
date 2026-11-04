"use client";
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useJson } from "@/components/useJson";
import { ErrorBox, Loading, Empty } from "@/components/Common";
import { StatusPill } from "@/components/perf/AutoRefresh";
import RefreshButton from "@/components/RefreshButton";
import SnapshotAgeChip from "@/components/SnapshotAgeChip";
import IssueIcon, { type IssueBucket } from "@/components/IssueIcon";
import CsvButton from "@/components/CsvButton";
import { ArrowUpDown, ArrowUp, ArrowDown, Brain, Copy, ChevronRight, ChevronDown, ExternalLink } from "lucide-react";
import Link from "next/link";
import FrameworkBadge, { detectFrameworks } from "@/components/FrameworkBadge";

interface SpringServiceHealth {
  serviceName: string;
  job: string;
  instance: string;
  up: boolean;
  cpu: number | null;
  heapUsedBytes: number | null;
  heapMaxBytes: number | null;
  heapPct: number | null;
}
interface Resp { ok: boolean; fetchedAt: string; services: SpringServiceHealth[]; }

interface LogServiceStat {
  service: string;
  total: number;
  errors: number;
  warns: number;
  errorRate: number;
  hosts: string[];
  latestError: { at: string | null; message: string } | null;
}
interface LogResp {
  ok: boolean;
  fetchedAt: string;
  window: "1h" | "24h";
  via: "lan" | "public" | "override";
  services: LogServiceStat[];
}

interface LogEntry { at: string | null; host: string | null; file: string | null; message: string }
interface LogDetailsResp { ok: boolean; service: string; window: string; total: number; truncated: boolean; entries: LogEntry[] }
type DetailWindow = "15m" | "1h" | "6h" | "24h";
type DetailState = LogDetailsResp | { loading: true } | { error: string };

interface AISummary {
  headline: string;
  rootCause: string;
  suggestedFix: string;
  patterns: Array<{ pattern: string; count: number }>;
  model: string | null;
}
type SummaryState = AISummary | { loading: true } | { error: string };

const NUM = new Intl.NumberFormat("en-US");

// Longest common substring length — used to score name similarity when the exact-match
// index misses (e.g. "rwauthservice" vs "rwauthorizationservice" score 8, meaningfully close).
function sharedChars(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  const table = new Array<number>((b.length + 1) * 2).fill(0);
  let curRow = 0, prevRow = 1;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const v = a[i] === b[j] ? table[prevRow * (b.length + 1) + j] + 1 : 0;
      table[curRow * (b.length + 1) + j + 1] = v;
      if (v > best) best = v;
    }
    [curRow, prevRow] = [prevRow, curRow];
  }
  return best;
}

const fmtBytes = (n: number | null) => {
  if (n === null) return "-";
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB"];
  let v = n / 1024;
  for (const u of units) {
    if (v < 1024) return `${v.toFixed(1)} ${u}`;
    v /= 1024;
  }
  return `${v.toFixed(1)} TiB`;
};

function HeapCell({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="muted">—</span>;
  const color = pct > 85 ? "#f87171" : pct > 70 ? "#f59e0b" : "#34d399";
  return (
    <div className="spring-heap">
      <div className="spring-heap-bar" title={`${pct.toFixed(1)}%`}>
        <div className="spring-heap-fill" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
      <span className="spring-heap-pct tab-num" style={{ color }}>{pct.toFixed(0)}%</span>
    </div>
  );
}

function ErrorRatePill({ rate, errors }: { rate: number; errors: number }) {
  if (errors === 0) return <span className="muted">—</span>;
  const pct = rate * 100;
  const color = pct >= 10 ? "#ef4444" : pct >= 2 ? "#f97316" : pct >= 0.5 ? "#f59e0b" : "#fbbf24";
  const label = pct < 0.01 ? "<0.01%" : pct.toFixed(2) + "%";
  return <span className="sev-pill" style={{ color, borderColor: color, background: `${color}15` }}>{label}</span>;
}

/** Dedup log entries by first-line pattern, keeping timestamps and hosts. */
function dedupeEntries(entries: LogEntry[]): Array<{ key: string; count: number; sample: LogEntry; hosts: Set<string>; firstAt: string | null; lastAt: string | null }> {
  const buckets = new Map<string, { count: number; sample: LogEntry; hosts: Set<string>; firstAt: string | null; lastAt: string | null }>();
  for (const e of entries) {
    const first = (e.message ?? "").split("\n")[0] ?? "";
    const key = first
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
      .replace(/\b[0-9a-f]{16,}\b/gi, "<hash>")
      .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*Z?\b/g, "<ts>")
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "<ip>")
      .replace(/\b\d+\b/g, "<n>")
      .slice(0, 300);
    const b = buckets.get(key);
    if (b) {
      b.count++;
      if (e.host) b.hosts.add(e.host);
      if (e.at) {
        if (!b.firstAt || e.at < b.firstAt) b.firstAt = e.at;
        if (!b.lastAt || e.at > b.lastAt) b.lastAt = e.at;
      }
    } else {
      const hosts = new Set<string>();
      if (e.host) hosts.add(e.host);
      buckets.set(key, { count: 1, sample: e, hosts, firstAt: e.at, lastAt: e.at });
    }
  }
  return [...buckets.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.count - a.count);
}

function copyToClipboard(text: string) {
  try {
    void navigator.clipboard.writeText(text);
  } catch { /* ignore */ }
}

type SortKey = "service" | "status" | "cpu" | "heap" | "errors" | "warns" | "rate";
type SortDir = "asc" | "desc";

interface RepoLite { name: string; full_name: string; owner: string; language: string | null; description: string | null; html_url: string }
interface ReposResp { connected?: boolean; repos?: RepoLite[] }

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <SpringPageInner />
    </Suspense>
  );
}

interface Ec2Instance {
  instanceId: string;
  name: string;
  region: string;
  publicIp: string | null;
  privateIp: string | null;
  type?: string;
  state?: string;
}
interface Ec2HealthResp { instances: Ec2Instance[] }

function SpringPageInner() {
  const { data, error, loading, reload } = useJson<Resp>("/api/perf/spring");
  const { data: logs, error: logsErr, reload: reloadLogs } = useJson<LogResp>("/api/perf/spring/logs?window=1h");
  const { data: issues } = useJson<{ services: Record<string, IssueBucket> }>("/api/issues/summary");
  const { data: reposResp } = useJson<ReposResp>("/api/security/repos");
  const { data: ec2 } = useJson<Ec2HealthResp>("/api/perf/ec2");
  const reloadAll = useCallback(() => { reload(); reloadLogs(); }, [reload, reloadLogs]);

  const ec2ByIp = useMemo(() => {
    const m = new Map<string, Ec2Instance>();
    for (const i of ec2?.instances ?? []) {
      if (i.publicIp)  m.set(i.publicIp,  i);
      if (i.privateIp) m.set(i.privateIp, i);
    }
    return m;
  }, [ec2]);

  const reposList = reposResp?.repos ?? [];
  const repoLookup = useCallback((serviceName: string): RepoLite | null => {
    if (!reposList.length) return null;
    const svc = serviceName.toLowerCase().replace(/[-_]/g, "");
    let best: RepoLite | null = null;
    let bestScore = 0;
    for (const r of reposList) {
      const nn = r.name.toLowerCase().replace(/[-_]/g, "");
      let score = 0;
      if (nn === svc) score = 100;
      else if (nn.includes(svc) || svc.includes(nn)) score = Math.min(nn.length, svc.length);
      if (score > bestScore) { bestScore = score; best = r; }
    }
    return bestScore >= 3 ? best : null;
  }, [reposList]);

  const searchParams = useSearchParams();
  const [job, setJob] = useState("");
  const [showDownOnly, setShowDownOnly] = useState(false);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [sortKey, setSortKey] = useState<SortKey>("errors");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [detailWindow, setDetailWindow] = useState<DetailWindow>("1h");
  const [stackFilter, setStackFilter] = useState<string | null>(() => searchParams.get("stack"));

  // If the URL query changes (client-nav from another page), sync q + stack.
  useEffect(() => {
    const nextQ = searchParams.get("q") ?? "";
    const nextStack = searchParams.get("stack");
    setQ(nextQ);
    setStackFilter(nextStack);
  }, [searchParams]);

  const rows = data?.services ?? [];
  const jobs = useMemo(() => Array.from(new Set(rows.map((r) => r.job))).sort(), [rows]);

  const normKey = useCallback((s: string) => s.toLowerCase().replace(/[-_]/g, ""), []);
  const stripSuffix = useCallback((s: string) => s.replace(/service$/i, "").replace(/svc$/i, ""), []);

  const logsByService = useMemo(() => {
    const m = new Map<string, LogServiceStat>();
    for (const s of logs?.services ?? []) m.set(normKey(s.service), s);
    return m;
  }, [logs, normKey]);

  // Also index ELK services by their -service-stripped form so RW-EDI-Integrator-Service
  // (Prom) can find rw-edi-integrator (ELK).
  const logsByServiceStripped = useMemo(() => {
    const m = new Map<string, LogServiceStat>();
    for (const s of logs?.services ?? []) m.set(stripSuffix(normKey(s.service)), s);
    return m;
  }, [logs, normKey, stripSuffix]);

  const logLookup = useCallback((name: string) => {
    const key = normKey(name);
    // 1. exact match (fastest, catches ~20 of 57 services)
    const exact = logsByService.get(key);
    if (exact) return exact;
    // 2. drop "-service" suffix and retry (catches "RW-EDI-Integrator-Service" → "rw-edi-integrator")
    const stripped = stripSuffix(key);
    if (stripped !== key) {
      const strippedHit = logsByServiceStripped.get(stripped);
      if (strippedHit) return strippedHit;
    }
    // 3. substring — either direction, requires ≥8 char overlap to avoid false positives
    if (stripped.length >= 8) {
      for (const [elkKey, stat] of logsByService.entries()) {
        const elkStripped = stripSuffix(elkKey);
        if (elkStripped.length >= 6 && (stripped.includes(elkStripped) || elkStripped.includes(stripped))) {
          return stat;
        }
      }
    }
    return undefined;
  }, [logsByService, logsByServiceStripped, normKey, stripSuffix]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (job && r.job !== job) return false;
      if (showDownOnly && r.up) return false;
      if (showErrorsOnly) {
        const s = logLookup(r.serviceName);
        if (!s || s.errors === 0) return false;
      }
      if (needle && !r.serviceName.toLowerCase().includes(needle)) return false;
      if (stackFilter) {
        const repo = repoLookup(r.serviceName);
        const keys = detectFrameworks({
          language: repo?.language ?? "Java",
          name: repo?.name ?? r.serviceName,
          description: repo?.description ?? null,
        });
        if (!keys.includes(stackFilter)) return false;
      }
      return true;
    });
    // Sort
    out = [...out].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const la = logLookup(a.serviceName);
      const lb = logLookup(b.serviceName);
      switch (sortKey) {
        case "service": return dir * a.serviceName.localeCompare(b.serviceName);
        case "status": return dir * (Number(b.up) - Number(a.up));
        case "cpu": return dir * ((b.cpu ?? -1) - (a.cpu ?? -1));
        case "heap": return dir * ((b.heapPct ?? -1) - (a.heapPct ?? -1));
        case "errors": return dir * ((lb?.errors ?? -1) - (la?.errors ?? -1));
        case "warns": return dir * ((lb?.warns ?? -1) - (la?.warns ?? -1));
        case "rate": return dir * ((lb?.errorRate ?? -1) - (la?.errorRate ?? -1));
        default: return 0;
      }
    });
    return out;
  }, [rows, job, showDownOnly, showErrorsOnly, logsByService, q, sortKey, sortDir, logLookup, stackFilter, repoLookup]);

  const down = rows.filter((r) => !r.up).length;
  const highHeap = rows.filter((r) => r.heapPct !== null && r.heapPct > 85).length;
  const servicesWithErrors = rows.reduce((n, r) => n + (logLookup(r.serviceName)?.errors ? 1 : 0), 0);
  const totalErrors = (logs?.services ?? []).reduce((n, s) => n + s.errors, 0);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const [summaries, setSummaries] = useState<Record<string, SummaryState>>({});
  const prefetchInflight = useRef<Set<string>>(new Set());

  const [viewMode, setViewMode] = useState<"list" | "grouped">("list");
  const [collapsedServers, setCollapsedServers] = useState<Set<string>>(new Set());

  const toggleServer = useCallback((host: string) => {
    setCollapsedServers((prev) => {
      const next = new Set(prev);
      if (next.has(host)) next.delete(host);
      else next.add(host);
      return next;
    });
  }, []);

  const fetchDetails = useCallback(async (promName: string, elkName: string | null, win: DetailWindow) => {
    if (!elkName) {
      // Build a helpful error with the top 3 closest ELK service names as suggestions.
      const promNorm = normKey(promName);
      const candidates = Array.from(logsByService.entries())
        .map(([k, s]) => ({ svc: s.service, score: sharedChars(promNorm, k) }))
        .filter((c) => c.score > 4)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      const suggestion = candidates.length
        ? ` Closest ELK service name${candidates.length > 1 ? "s" : ""}: ${candidates.map((c) => `"${c.svc}"`).join(", ")}. If one of these is actually the same service, rename the Filebeat pipeline field so it matches the Prometheus service_name label.`
        : ` No ELK service name resembles this one — Filebeat likely isn't running on the host (or isn't tagging its log stream). Check the ${logs?.services?.length ?? 0} indexed ELK services vs the ${rows.length} Prom services for the naming gap.`;
      setDetails((p) => ({ ...p, [promName]: { error: `Prometheus knows about "${promName}", but no ELK log stream matches.${suggestion}` } }));
      return;
    }
    const cacheKey = `${promName}__${win}`;
    if (prefetchInflight.current.has(cacheKey)) return;
    prefetchInflight.current.add(cacheKey);
    setDetails((p) => ({ ...p, [promName]: { loading: true } }));
    try {
      const res = await fetch(`/api/perf/spring/logs/details?service=${encodeURIComponent(elkName)}&window=${win}&size=100`);
      const text = await res.text();
      const looksLikeHtml = /^\s*<(!doctype|html|head|body)/i.test(text);
      if (res.status === 401 || (looksLikeHtml && (res.url.includes("/login") || res.redirected))) {
        throw new Error("Session expired — please sign in again.");
      }
      if (looksLikeHtml) {
        throw new Error(`Logs request failed (${res.status} ${res.statusText || "gateway error"}). ELK may be slow — try again in a moment.`);
      }
      const body = text ? JSON.parse(text) : {};
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setDetails((p) => ({ ...p, [promName]: body as LogDetailsResp }));
    } catch (e) {
      setDetails((p) => ({ ...p, [promName]: { error: e instanceof Error ? e.message : String(e) } }));
    } finally {
      prefetchInflight.current.delete(cacheKey);
    }
  }, []);

  const toggleExpand = useCallback((promName: string, elkName: string | null) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(promName)) { next.delete(promName); return next; }
      next.add(promName);
      const cached = details[promName];
      if (!cached || "error" in cached) void fetchDetails(promName, elkName, detailWindow);
      return next;
    });
  }, [details, detailWindow, fetchDetails]);

  const expandAllErrors = useCallback(() => {
    const withErrors = filtered.filter((r) => (logLookup(r.serviceName)?.errors ?? 0) > 0);
    const names = new Set<string>();
    for (const r of withErrors) {
      names.add(r.serviceName);
      const log = logLookup(r.serviceName);
      const existing = details[r.serviceName];
      if (!existing || "error" in existing) {
        void fetchDetails(r.serviceName, log?.service ?? null, detailWindow);
      }
    }
    setExpanded(names);
  }, [filtered, logLookup, details, fetchDetails, detailWindow]);

  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  /** Change detail window — invalidate cached details for currently-expanded rows and re-fetch. */
  const changeWindow = useCallback((next: DetailWindow) => {
    setDetailWindow(next);
    setDetails({});
    for (const promName of expanded) {
      const log = logLookup(promName);
      void fetchDetails(promName, log?.service ?? null, next);
    }
  }, [expanded, logLookup, fetchDetails]);

  const askAI = useCallback(async (promName: string) => {
    const d = details[promName];
    if (!d || "error" in d || "loading" in d) return;
    setSummaries((p) => ({ ...p, [promName]: { loading: true } }));
    try {
      const res = await fetch("/api/perf/spring/logs/summarize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          service: promName,
          entries: d.entries.slice(0, 60).map((e) => ({ at: e.at, host: e.host, message: e.message })),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setSummaries((p) => ({ ...p, [promName]: body.summary }));
    } catch (e) {
      setSummaries((p) => ({ ...p, [promName]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  }, [details]);

  const prefetchOnHover = useCallback((promName: string, elkName: string | null) => {
    if (expanded.has(promName)) return;
    const cached = details[promName];
    if (cached && !("error" in cached)) return;
    void fetchDetails(promName, elkName, detailWindow);
  }, [expanded, details, fetchDetails, detailWindow]);

  function sortIndicator(k: SortKey) {
    if (sortKey !== k) return <ArrowUpDown size={11} className="sort-ico muted" />;
    return sortDir === "asc" ? <ArrowUp size={11} className="sort-ico" /> : <ArrowDown size={11} className="sort-ico" />;
  }
  function onSort(k: SortKey) {
    setSortKey((prev) => {
      if (prev === k) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortDir(k === "service" ? "asc" : "desc");
      }
      return k;
    });
  }

  const csvRows = filtered.map((r) => {
    const log = logLookup(r.serviceName);
    return {
      serviceName: r.serviceName,
      job: r.job,
      instance: r.instance,
      up: r.up ? "UP" : "DOWN",
      cpuPct: r.cpu !== null ? +(r.cpu * 100).toFixed(2) : null,
      heapPct: r.heapPct !== null ? +r.heapPct.toFixed(2) : null,
      heapUsedBytes: r.heapUsedBytes,
      heapMaxBytes: r.heapMaxBytes,
      errors: log?.errors ?? 0,
      warns: log?.warns ?? 0,
      total: log?.total ?? 0,
      errorRatePct: log ? +(log.errorRate * 100).toFixed(4) : 0,
      latestError: log?.latestError?.message?.slice(0, 200) ?? "",
    };
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Spring Services</h1>
          <p className="page-sub">
            Health (Prometheus) + ERROR/WARN log stats (DEV ELK) in one view. Click any row to see recent
            ERROR entries (deduplicated by pattern). Ask Fable for a 2-sentence diagnosis on any expanded row.
          </p>
        </div>
        <RefreshButton sources={["spring-health", "spring-logs"]} onDone={reloadAll} />
      </div>

      {logs?.via === "public" && (
        <div className="anomaly-banner" style={{ borderColor: "rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.06)" }}>
          <strong style={{ color: "#f59e0b" }}>⚠ Using public ELK IP</strong> — LAN URL is unreachable; logs from the slower public endpoint.
        </div>
      )}

      <div className="card-row spring-cards">
        <div className="card"><div className="card-label">Total</div><div className="card-value">{rows.length}</div></div>
        <div className="card"><div className="card-label">Down</div><div className="card-value" style={{ color: down ? "#f87171" : "#34d399" }}>{down}</div></div>
        <div className="card"><div className="card-label">Heap &gt; 85%</div><div className="card-value" style={{ color: highHeap ? "#f59e0b" : "#34d399" }}>{highHeap}</div></div>
        <div className="card"><div className="card-label">Services w/ ERROR (1h)</div><div className="card-value" style={{ color: servicesWithErrors ? "#ef4444" : "#34d399" }}>{servicesWithErrors}</div></div>
        <div className="card"><div className="card-label">Total ERROR (1h)</div><div className="card-value" style={{ color: totalErrors ? "#ef4444" : "#34d399" }}>{NUM.format(totalErrors)}</div></div>
      </div>

      <div className="panel spring-panel">
        <div className="spring-toolbar">
          <div className="spring-toolbar-left">
            <div className="cdc-range spring-view-toggle" role="group" aria-label="View mode">
              <button className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")} title="Flat list of every service">📋 List</button>
              <button className={viewMode === "grouped" ? "active" : ""} onClick={() => setViewMode("grouped")} title="Group services by their host server">🖥 By server</button>
            </div>
            <input className="input" placeholder="Search service name" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input" value={job} onChange={(e) => setJob(e.target.value)}>
              <option value="">All jobs</option>
              {jobs.map((j) => <option key={j}>{j}</option>)}
            </select>
            <label className="ec2-problems-toggle">
              <input type="checkbox" checked={showDownOnly} onChange={(e) => setShowDownOnly(e.target.checked)} />
              <span>Down only</span>
            </label>
            <label className="ec2-problems-toggle">
              <input type="checkbox" checked={showErrorsOnly} onChange={(e) => setShowErrorsOnly(e.target.checked)} />
              <span>With errors</span>
            </label>
          </div>
          <div className="spring-toolbar-right">
            <div className="cdc-range" role="group" aria-label="Detail window">
              {(["15m", "1h", "6h", "24h"] as const).map((w) => (
                <button key={w} className={detailWindow === w ? "active" : ""} onClick={() => changeWindow(w)}>{w}</button>
              ))}
            </div>
            <button className="btn-ghost" onClick={expandAllErrors} title="Expand every service with errors">
              <ChevronDown size={13} /> Expand w/ errors
            </button>
            {expanded.size > 0 && (
              <button className="btn-ghost" onClick={collapseAll}>Collapse all</button>
            )}
            <CsvButton
              rows={csvRows}
              filename="spring-services.csv"
              columns={[
                { key: "serviceName", label: "Service" },
                { key: "job", label: "Job" },
                { key: "instance", label: "Instance" },
                { key: "up", label: "Status" },
                { key: "cpuPct", label: "CPU %" },
                { key: "heapPct", label: "Heap %" },
                { key: "heapUsedBytes", label: "Heap used (B)" },
                { key: "heapMaxBytes", label: "Heap max (B)" },
                { key: "errors", label: "ERROR (1h)" },
                { key: "warns", label: "WARN (1h)" },
                { key: "total", label: "Total (1h)" },
                { key: "errorRatePct", label: "Error rate %" },
                { key: "latestError", label: "Latest ERROR (excerpt)" },
              ]}
            />
          </div>
        </div>

        <div className="spring-chips">
          <SnapshotAgeChip source="spring-health" />
          <SnapshotAgeChip source="spring-logs" />
          {stackFilter && (
            <button className="stack-filter-active" onClick={() => setStackFilter(null)} title="Clear stack filter">
              <span className="stack-filter-label">Stack:</span>
              <FrameworkBadge keys={[stackFilter]} compact />
              <span className="stack-filter-x">×</span>
            </button>
          )}
          <span className="muted small">{filtered.length} of {rows.length} services</span>
        </div>

        {error ? <ErrorBox message={error} />
          : loading && !data ? <Loading />
            : filtered.length === 0 ? <Empty text="No services match." />
              : (
                <div className="spring-table-scroll">
                  <table className="spring-table">
                    <thead>
                      <tr>
                        <th style={{ width: 22 }}></th>
                        <th onClick={() => onSort("service")} className="sortable">Service {sortIndicator("service")}</th>
                        <th>Stack</th>
                        <th>Repo</th>
                        <th onClick={() => onSort("status")} className="sortable">Status {sortIndicator("status")}</th>
                        <th onClick={() => onSort("cpu")} className="sortable">CPU {sortIndicator("cpu")}</th>
                        <th>Heap</th>
                        <th onClick={() => onSort("heap")} className="sortable">Heap % {sortIndicator("heap")}</th>
                        <th onClick={() => onSort("errors")} className="sortable">ERROR ({detailWindow}) {sortIndicator("errors")}</th>
                        <th onClick={() => onSort("warns")} className="sortable">WARN (1h) {sortIndicator("warns")}</th>
                        <th onClick={() => onSort("rate")} className="sortable">Rate {sortIndicator("rate")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        // Build groups: single "_all" group in list mode; one group per host IP in grouped mode.
                        type Group = { key: string; label: string; hostIp: string | null; ec2: Ec2Instance | null; services: SpringServiceHealth[] };
                        const groups: Group[] = viewMode === "list"
                          ? [{ key: "_all", label: "", hostIp: null, ec2: null, services: filtered }]
                          : (() => {
                              const buckets = new Map<string, SpringServiceHealth[]>();
                              for (const s of filtered) {
                                const host = (s.instance ?? "").split(":")[0] || "unknown";
                                if (!buckets.has(host)) buckets.set(host, []);
                                buckets.get(host)!.push(s);
                              }
                              const groupList: Group[] = Array.from(buckets.entries()).map(([host, svcs]) => {
                                const ec2Info = ec2ByIp.get(host) ?? null;
                                return {
                                  key: host,
                                  label: ec2Info?.name ?? host,
                                  hostIp: host,
                                  ec2: ec2Info,
                                  services: svcs,
                                };
                              });
                              // Sort: servers with errors first, then with DOWN services, then alphabetical
                              const errorsForGroup = (g: Group) => g.services.reduce((n, s) => n + (logLookup(s.serviceName)?.errors ?? 0), 0);
                              const downForGroup = (g: Group) => g.services.filter((s) => !s.up).length;
                              groupList.sort((a, b) => {
                                const ea = errorsForGroup(a), eb = errorsForGroup(b);
                                if (ea !== eb) return eb - ea;
                                const da = downForGroup(a), db = downForGroup(b);
                                if (da !== db) return db - da;
                                return a.label.localeCompare(b.label);
                              });
                              return groupList;
                            })();

                        return groups.flatMap((g) => {
                          const isCollapsed = viewMode === "grouped" && collapsedServers.has(g.key);
                          const groupUp = g.services.filter((s) => s.up).length;
                          const groupDown = g.services.length - groupUp;
                          const groupErrors = g.services.reduce((n, s) => n + (logLookup(s.serviceName)?.errors ?? 0), 0);
                          const header = viewMode === "grouped" ? (
                            <tr key={`hdr-${g.key}`} className="spring-server-hdr" onClick={() => toggleServer(g.key)}>
                              <td colSpan={11}>
                                <div className="spring-server-hdr-inner">
                                  <span className="spring-server-caret">
                                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                  </span>
                                  <span className="spring-server-name">
                                    <strong>{g.label}</strong>
                                    {g.ec2 && <span className="mono muted small" style={{ marginLeft: 6 }}>{g.ec2.instanceId}</span>}
                                  </span>
                                  <span className="spring-server-ip mono muted small">{g.hostIp}</span>
                                  {g.ec2?.region && <span className="chip">{g.ec2.region}</span>}
                                  <span className="chip">{g.services.length} services</span>
                                  <span className="chip" style={{ color: groupUp === g.services.length ? "#34d399" : "#94a3b8" }}>{groupUp} UP</span>
                                  {groupDown > 0 && <span className="chip" style={{ color: "#f87171" }}>{groupDown} DOWN</span>}
                                  {groupErrors > 0 && <span className="chip" style={{ color: "#ef4444" }}>{NUM.format(groupErrors)} ERROR (1h)</span>}
                                </div>
                              </td>
                            </tr>
                          ) : null;

                          if (isCollapsed) return header ? [header] : [];

                          const rowsJsx = g.services.map((r) => {
                            const log = logLookup(r.serviceName);
                            const isOpen = expanded.has(r.serviceName);
                            const errorCount = log?.errors ?? 0;
                            const summary = summaries[r.serviceName];
                            const detail = details[r.serviceName];
                            return (
                              <>
                            <tr
                              key={`${r.serviceName}-${r.instance}-${r.job}`}
                              className={`spring-row ${isOpen ? "open" : ""}`}
                              onClick={() => toggleExpand(r.serviceName, log?.service ?? null)}
                              onMouseEnter={() => prefetchOnHover(r.serviceName, log?.service ?? null)}
                              title={isOpen ? "Click to collapse" : "Click to view recent ERROR logs"}
                            >
                              <td className="spring-caret">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                              <td>
                                <strong>{r.serviceName}</strong>
                                <IssueIcon bucket={issues?.services?.[log?.service ?? r.serviceName]} />
                                <div className="muted small spring-meta">
                                  <span className="mono">{r.job}</span> · <span className="mono">{r.instance}</span>
                                </div>
                              </td>
                              <td onClick={(e) => e.stopPropagation()}>
                                {(() => {
                                  const repo = repoLookup(r.serviceName);
                                  const keys = detectFrameworks({
                                    language: repo?.language ?? "Java",
                                    name: repo?.name ?? r.serviceName,
                                    description: repo?.description ?? null,
                                  });
                                  return (
                                    <span className="fw-badges-row" onClick={(e) => e.stopPropagation()}>
                                      {keys.map((k) => (
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
                                  );
                                })()}
                              </td>
                              <td onClick={(e) => e.stopPropagation()}>
                                {(() => {
                                  const repo = repoLookup(r.serviceName);
                                  return repo ? (
                                    <Link href={`/security?repo=${encodeURIComponent(repo.full_name)}`} className="spring-repo-link" title={repo.full_name}>
                                      <ExternalLink size={11} />
                                      <span className="mono small">{repo.name}</span>
                                    </Link>
                                  ) : <span className="muted small">—</span>;
                                })()}
                              </td>
                              <td><StatusPill ok={r.up} label={r.up ? "UP" : "DOWN"} /></td>
                              <td className="tab-num">{r.cpu !== null ? `${(r.cpu * 100).toFixed(1)}%` : "-"}</td>
                              <td className="mono small">{fmtBytes(r.heapUsedBytes)} / {fmtBytes(r.heapMaxBytes)}</td>
                              <td><HeapCell pct={r.heapPct} /></td>
                              <td className="tab-num" style={{ color: errorCount > 0 ? "#ef4444" : "#94a3b8", fontWeight: errorCount > 0 ? 600 : 400 }}>
                                {log ? NUM.format(errorCount) : <span className="muted">—</span>}
                              </td>
                              <td className="tab-num" style={{ color: (log?.warns ?? 0) > 0 ? "#f59e0b" : "#94a3b8" }}>
                                {log ? NUM.format(log.warns) : <span className="muted">—</span>}
                              </td>
                              <td>{log ? <ErrorRatePill rate={log.errorRate} errors={log.errors} /> : <span className="muted">—</span>}</td>
                            </tr>
                            {isOpen && (
                              <tr key={`${r.serviceName}-detail`} className="spring-detail-row">
                                <td colSpan={11} className="spring-detail-cell">
                                  <SpringDetail
                                    d={detail}
                                    summary={summary}
                                    onAskAI={() => askAI(r.serviceName)}
                                    serviceName={r.serviceName}
                                    detailWindow={detailWindow}
                                  />
                                  <LokiTail serviceName={r.serviceName} />
                                </td>
                              </tr>
                            )}
                          </>
                        );
                          });

                          return header ? [header, ...rowsJsx] : rowsJsx;
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              )}
        {logsErr && (
          <div className="muted small" style={{ marginTop: 10 }}>
            (Log data unavailable: {logsErr})
          </div>
        )}
      </div>
    </>
  );
}

function SpringDetail({
  d, summary, onAskAI, serviceName, detailWindow,
}: {
  d: DetailState | undefined;
  summary: SummaryState | undefined;
  onAskAI: () => void;
  serviceName: string;
  detailWindow: DetailWindow;
}) {
  if (!d || "loading" in (d as { loading?: boolean }) && (d as { loading?: boolean }).loading) return <div className="muted small">Loading ERROR entries…</div>;
  if ("error" in (d as { error?: string })) return <ErrorBox message={(d as { error: string }).error} />;
  const resp = d as LogDetailsResp;
  if (resp.entries.length === 0) {
    return <div className="muted">No ERROR log lines in the last {detailWindow} for {serviceName}.</div>;
  }
  const buckets = dedupeEntries(resp.entries);
  const summaryReady = summary && !("loading" in summary) && !("error" in summary);
  const summaryBusy = summary && "loading" in summary;
  const summaryErr = summary && "error" in summary ? summary.error : null;
  const s = summaryReady ? (summary as AISummary) : null;

  return (
    <div className="spring-detail">
      <div className="spring-detail-head">
        <div className="muted small">
          Showing {resp.entries.length} of {NUM.format(resp.total)}{resp.truncated ? "+" : ""} ERROR entries · last {detailWindow} · {buckets.length} pattern{buckets.length === 1 ? "" : "s"}
        </div>
        <div className="spring-detail-actions">
          <button className="btn-ghost" onClick={() => copyToClipboard(resp.entries.map((e) => `[${e.at ?? "?"}] ${e.host ?? "-"} ${e.message}`).join("\n\n"))}>
            <Copy size={12} /> Copy all
          </button>
          <button className="btn-ghost spring-ask-ai" onClick={onAskAI} disabled={Boolean(summaryBusy)}>
            <Brain size={13} /> {summaryBusy ? "Fable thinking…" : s ? "Re-ask Fable" : "Ask Fable"}
          </button>
        </div>
      </div>

      {summaryErr && <div className="anomaly-banner anomaly-banner-error">{summaryErr}</div>}
      {s && (
        <div className="spring-ai-summary">
          <div className="spring-ai-head">
            <span className="ai-brief-ico"><Brain size={14} /></span>
            <span className="ai-brief-title">Fable diagnosis</span>
            {s.model && <span className="muted small">· {s.model}</span>}
          </div>
          <h4 className="spring-ai-headline">{s.headline}</h4>
          <p className="spring-ai-p"><strong>Root cause:</strong> {s.rootCause}</p>
          <p className="spring-ai-p"><strong>Next action:</strong> {s.suggestedFix}</p>
        </div>
      )}

      <div className="spring-buckets">
        {buckets.map((b, i) => (
          <div key={i} className="spring-bucket">
            <div className="spring-bucket-head">
              <span className={`spring-bucket-count ${b.count >= 10 ? "hot" : b.count >= 3 ? "warm" : ""}`}>×{b.count}</span>
              <span className="spring-bucket-pattern mono">{b.key.slice(0, 400)}</span>
              <button className="spring-bucket-copy" onClick={() => copyToClipboard(b.sample.message)} title="Copy sample">
                <Copy size={11} />
              </button>
            </div>
            <div className="spring-bucket-meta muted small">
              {b.hosts.size > 0 && <span>{[...b.hosts].join(" · ")}</span>}
              {b.firstAt && b.lastAt && (
                <span>{new Date(b.firstAt).toLocaleTimeString()} → {new Date(b.lastAt).toLocaleTimeString()}</span>
              )}
            </div>
            <div className="spring-bucket-sample mono">{b.sample.message.slice(0, 800)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Loki live-tail tucked under each expanded Spring service ─────────────────── */
interface LokiEntryLite { timeMs: number; message: string; severity: string; labels: Record<string, string> }
interface LokiResp { ok: boolean; count: number; entries: LokiEntryLite[]; error?: string }

function LokiTail({ serviceName }: { serviceName: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<LokiResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(15);

  // Loki filename labels are lowercased and dash-separated: "rw-purchasing-service"
  const fnPattern = serviceName.toLowerCase().replace(/[_\s]/g, "-");
  const query = `{job="rw_services", filename=~".*/${fnPattern}/.*"}`;

  async function load() {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/loki/query?query=${encodeURIComponent(query)}&limit=200&minutes=${minutes}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e) { setErr(e instanceof Error ? e.message : "Loki fetch failed"); }
    finally { setLoading(false); }
  }

  return (
    <div className="spring-loki-block">
      <div className="spring-loki-head">
        <button className="btn-ghost" onClick={() => { const nv = !open; setOpen(nv); if (nv && !data && !loading) load(); }}>
          {open ? "▾" : "▸"} Live logs · Loki tail · last {minutes}m
        </button>
        {open && (
          <>
            <div className="cdc-range" role="group">
              {[5, 15, 60].map((m) => (
                <button key={m} className={minutes === m ? "active" : ""} onClick={() => { setMinutes(m); load(); }}>{m}m</button>
              ))}
            </div>
            <button className="btn-ghost" onClick={load} disabled={loading}>{loading ? "…" : "↻"}</button>
          </>
        )}
      </div>
      {open && (
        <div className="spring-loki-body">
          {err && <div className="anomaly-banner anomaly-banner-error">{err}</div>}
          {data && data.count === 0 && <div className="muted small">No Loki entries — service may not be shipping to Loki, or filename pattern doesn't match.</div>}
          {data && data.entries.length > 0 && (
            <>
              <div className="muted small">{data.count} lines · {`{filename=~".*/${fnPattern}/.*"}`}</div>
              <div className="spring-loki-stream">
                {data.entries.slice(0, 100).map((e, i) => (
                  <div key={i} className={`spring-loki-line spring-loki-${e.severity.toLowerCase()}`}>
                    <span className="spring-loki-time mono">{new Date(e.timeMs).toISOString().slice(11, 19)}</span>
                    <span className="spring-loki-sev">{e.severity}</span>
                    <span className="mono">{e.message.slice(0, 800)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
