"use client";
import { useState } from "react";

type Source = "spring-health" | "spring-logs" | "ec2-health" | "ec2-volumes" | "cloudwatch-alarms" | "prom-alerts" | "recommendations" | "lambda-ohio" | "all";

interface Props {
  sources: Source[];
  onDone?: () => void;
  label?: string;
}

interface RefreshResult { source: string; ok: boolean; fetchMs?: number; via?: string | null; error?: string }

export default function RefreshButton({ sources, onDone, label = "Refresh data" }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const results: RefreshResult[] = [];
      for (const src of sources) {
        const res = await fetch("/api/refresh/snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: src }),
        });
        const body = await res.json().catch(() => ({}));
        if (body.results) results.push(...body.results);
        else results.push({ source: src, ok: false, error: body.error ?? `HTTP ${res.status}` });
      }
      const ok = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        const tookMs = results.reduce((a, r) => a + (r.fetchMs ?? 0), 0);
        setMsg(`${ok} source${ok === 1 ? "" : "s"} refreshed in ${(tookMs / 1000).toFixed(1)}s.`);
      } else {
        setErr(`${ok} ok, ${failed.length} failed: ${failed.map((f) => `${f.source} (${f.error})`).join("; ")}`);
      }
      onDone?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="refresh-block">
      <button
        type="button"
        className="btn-refresh"
        onClick={run}
        disabled={busy}
        title="Fetch the latest data from the upstream source and persist to DB."
      >
        <span className={`spin ${busy ? "spinning" : ""}`}>↻</span>
        {busy ? "Refreshing…" : label}
      </button>
      {msg && <div className="refresh-msg success">{msg}</div>}
      {err && <div className="refresh-msg error">{err}</div>}
    </div>
  );
}
