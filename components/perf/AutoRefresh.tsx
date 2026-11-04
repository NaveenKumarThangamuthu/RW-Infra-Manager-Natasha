"use client";
import { useEffect } from "react";

/** Calls `reload` every `intervalMs` and shows a "last refreshed" hint. */
export function useAutoRefresh(reload: () => void, intervalMs: number) {
  useEffect(() => {
    const id = setInterval(reload, intervalMs);
    return () => clearInterval(id);
  }, [reload, intervalMs]);
}

export function StatusPill({ ok, label }: { ok: boolean; label?: string }) {
  const text = label ?? (ok ? "OK" : "DOWN");
  const color = ok ? "#34d399" : "#f87171";
  return (
    <span className="pill" style={{ borderColor: color, color }}>
      {text}
    </span>
  );
}

export function FreshnessLine({
  fetchedAt,
  loading,
  intervalLabel,
}: {
  fetchedAt: string | null;
  loading: boolean;
  intervalLabel: string;
}) {
  return (
    <div className="note" style={{ marginBottom: 12 }}>
      Auto-refresh every {intervalLabel}.{" "}
      {loading
        ? "Refreshing…"
        : fetchedAt
          ? `Last updated ${new Date(fetchedAt).toLocaleTimeString()}.`
          : "Waiting for first fetch."}
    </div>
  );
}
