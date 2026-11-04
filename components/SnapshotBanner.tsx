"use client";

interface Props {
  capturedAt: string | null;
  label?: string;
  staleMinutes?: number;
}

function fmtRel(iso: string): string {
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return iso;
  const diff = Date.now() - d;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

export default function SnapshotBanner({ capturedAt, label = "Last snapshot", staleMinutes = 30 }: Props) {
  const ageMin = capturedAt ? (Date.now() - new Date(capturedAt).getTime()) / 60_000 : Infinity;
  const cls = !capturedAt ? "never" : ageMin > staleMinutes ? "stale" : "fresh";
  const cluesText = !capturedAt ? "never refreshed" : `${fmtRel(capturedAt)} · ${new Date(capturedAt).toLocaleString()}`;
  return (
    <div className="snapshot-banner">
      <span className={`dot ${cls}`} />
      <span className="label">{label}:</span>
      <span className="value">{cluesText}</span>
      {capturedAt && ageMin > staleMinutes && (
        <span className="label" style={{ marginLeft: 8, color: "#f59e0b" }}>· stale (&gt; {staleMinutes}min)</span>
      )}
    </div>
  );
}
