"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useJson } from "@/components/useJson";
import { ErrorBox, Loading } from "@/components/Common";
import { RefreshCw, Filter, Play, Pause, Terminal, Copy } from "lucide-react";

type Sev = "SEVERE" | "ERROR" | "WARN" | "INFO" | "FINE" | "DEBUG" | "TRACE" | "OTHER";
interface LokiEntryLite {
  timeMs: number;
  message: string;
  severity: Sev;
  labels: Record<string, string>;
}
interface Resp { ok: boolean; count: number; windowMinutes: number; entries: LokiEntryLite[]; error?: string }

const SEV_COLOR: Record<Sev, string> = {
  SEVERE: "#f87171", ERROR: "#fb923c", WARN: "#fbbf24",
  INFO: "#7dd3fc", FINE: "#a78bfa", DEBUG: "#94a3b8", TRACE: "#94a3b8", OTHER: "#cbd5e0",
};

export default function OpenAs2Page() {
  const [window, setWindow] = useState(15); // minutes
  const [limit, setLimit] = useState(500);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshSec, setRefreshSec] = useState(10);
  const [severity, setSeverity] = useState<Sev | "all">("all");
  const [search, setSearch] = useState("");
  const timer = useRef<number | null>(null);

  const q = `{job="openas2"}`;
  const url = `/api/loki/query?query=${encodeURIComponent(q)}&limit=${limit}&minutes=${window}`;
  const { data, error, reload } = useJson<Resp>(url);

  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (autoRefresh) {
      timer.current = window > 0 ? window as unknown as number : null;
      timer.current = (setInterval(() => reload(), refreshSec * 1000) as unknown as number);
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [autoRefresh, refreshSec, reload, url, window]);

  const entries = data?.entries ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (severity !== "all" && e.severity !== severity) return false;
      if (q && !e.message.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, severity, search]);

  const counts: Record<Sev, number> = { SEVERE: 0, ERROR: 0, WARN: 0, INFO: 0, FINE: 0, DEBUG: 0, TRACE: 0, OTHER: 0 };
  for (const e of entries) counts[e.severity]++;

  async function copyAll() {
    const txt = filtered.map((e) => `${new Date(e.timeMs).toISOString()} [${e.severity}] ${e.message}`).join("\n");
    try { await navigator.clipboard.writeText(txt); } catch { /* ignore */ }
  }

  return (
    <div className="loki-page">
      <div className="loki-hero">
        <div className="loki-hero-glow" />
        <div className="loki-hero-inner">
          <div className="loki-hero-title-row">
            <div>
              <div className="loki-hero-eyebrow"><Terminal size={12} /> AS2 EDI · LIVE LOGS · LOKI</div>
              <h1 className="loki-hero-title"><span className="loki-hero-title-grad">OpenAS2</span> live stream</h1>
              <p className="loki-hero-subline">
                {data ? `${data.count} lines in the last ${window} min` : "loading…"}
                {" · "}Loki job <code className="mono">openas2</code>
              </p>
            </div>
            <div className="loki-hero-actions">
              <button className={`btn ${autoRefresh ? "primary" : "ghost"}`} onClick={() => setAutoRefresh(!autoRefresh)} title={autoRefresh ? "Pause auto-refresh" : "Enable auto-refresh"}>
                {autoRefresh ? <Pause size={13} /> : <Play size={13} />}
                {autoRefresh ? `auto ${refreshSec}s` : "paused"}
              </button>
              <button className="btn ghost" onClick={() => reload()} title="Refresh once">
                <RefreshCw size={13} /> Refresh
              </button>
              <button className="btn ghost" onClick={copyAll} title="Copy filtered logs to clipboard">
                <Copy size={13} /> Copy
              </button>
            </div>
          </div>

          <div className="loki-hero-kpis">
            {(["SEVERE", "ERROR", "WARN", "INFO", "FINE"] as const).map((s) => (
              <div key={s} className={`loki-kpi ${counts[s] > 0 ? "hot" : ""}`} style={{ color: SEV_COLOR[s] }}>
                <div className="loki-kpi-val">{counts[s]}</div>
                <div className="loki-kpi-lbl">{s}</div>
              </div>
            ))}
            <div className="loki-kpi">
              <div className="loki-kpi-val">{entries.length}</div>
              <div className="loki-kpi-lbl">TOTAL</div>
            </div>
          </div>
        </div>
      </div>

      <div className="loki-toolbar">
        <div className="loki-search">
          <Filter size={13} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter · substring across every line…" />
        </div>
        <div className="loki-chips">
          {(["all", "SEVERE", "ERROR", "WARN", "INFO", "FINE"] as const).map((s) => (
            <button
              key={s}
              className={`loki-chip ${severity === s ? "active" : ""}`}
              style={severity === s && s !== "all" ? { color: SEV_COLOR[s], borderColor: SEV_COLOR[s] } : undefined}
              onClick={() => setSeverity(s)}
            >
              {s === "all" ? "All" : s} <span className="loki-chip-count">{s === "all" ? entries.length : counts[s as Sev] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="loki-windows">
          {[5, 15, 60, 240, 1440].map((m) => (
            <button key={m} className={`loki-win ${window === m ? "active" : ""}`} onClick={() => setWindow(m)}>
              {m < 60 ? `${m}m` : m === 1440 ? "24h" : `${m/60}h`}
            </button>
          ))}
          <select className="loki-refresh-sel" value={refreshSec} onChange={(e) => setRefreshSec(Number(e.target.value))} title="Auto-refresh interval">
            <option value={5}>5s</option>
            <option value={10}>10s</option>
            <option value={30}>30s</option>
            <option value={60}>60s</option>
          </select>
          <select className="loki-refresh-sel" value={limit} onChange={(e) => setLimit(Number(e.target.value))} title="Max lines">
            <option value={100}>100</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
            <option value={2000}>2000</option>
          </select>
        </div>
      </div>

      {error ? <ErrorBox message={error} />
        : !data ? <Loading />
          : (
            <div className="loki-stream">
              {filtered.length === 0 && <div className="empty">No lines match the current filter.</div>}
              {filtered.map((e, i) => (
                <div key={i} className={`loki-line loki-sev-${e.severity.toLowerCase()}`}>
                  <span className="loki-time mono">{new Date(e.timeMs).toISOString().slice(11, 19)}</span>
                  <span className="loki-sev-chip" style={{ color: SEV_COLOR[e.severity], borderColor: SEV_COLOR[e.severity] }}>{e.severity}</span>
                  <span className="loki-msg mono">{e.message}</span>
                </div>
              ))}
            </div>
          )}
    </div>
  );
}
