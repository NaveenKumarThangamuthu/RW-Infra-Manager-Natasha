"use client";
import { Clock } from "lucide-react";
import { useJson } from "./useJson";

interface Resp {
  ok: boolean;
  ops?: {
    snapshots: Record<string, { capturedAt: string | null }>;
  };
}

function ageMinutes(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

function ageLabel(min: number | null): string {
  if (min == null) return "never";
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}

/**
 * Inline chip showing how old the given snapshot source is. Reads
 * /api/dashboard/summary (already loaded by other tiles → cached by useJson).
 *
 * Drop into any section header:
 *   <h2>Spring services <SnapshotAgeChip source="spring-health" /></h2>
 */
export default function SnapshotAgeChip({ source }: { source: string }) {
  const { data } = useJson<Resp>("/api/dashboard/summary");
  const snap = data?.ops?.snapshots?.[source];
  if (!data?.ops) return null;
  const min = ageMinutes(snap?.capturedAt ?? null);
  let tone = "ok";
  if (min == null) tone = "old";
  else if (min > 36 * 60) tone = "old";
  else if (min > 12 * 60) tone = "stale";

  return (
    <span className={`snap-chip snap-chip-${tone}`} title={snap?.capturedAt ?? "never refreshed"}>
      <Clock size={11} />
      {ageLabel(min)} ago
    </span>
  );
}
