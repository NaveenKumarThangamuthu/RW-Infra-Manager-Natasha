"use client";
import { useJson } from "@/components/useJson";
import { useOnRefreshed } from "./ShellContext";

export interface SnapMeta { capturedAt: string | null; via: string | null; status: string | null }
export interface DashboardSummary {
  ok: boolean;
  github: {
    activeRepos: number;
    lastSyncAt: string | null;
    findings: { total: number; CRIT: number; HIGH: number; MED: number; LOW: number; INFO: number; windowDays?: number };
    scans: { last24h: number; reposScanned24h?: number; reposFailed24h?: number; open: number; lastAt: string | null };
  };
  spring: { total: number; down: number; highHeap: number; servicesWithErrors: number; totalErrors1h: number; lastHealthSnap: string | null; lastLogsSnap: string | null };
  lambda: { total: number; invocations24h: number; errors24h: number; lastSnap: string | null };
  recommendations: { total: number; monthlySavingsUsd: number; instancesWithSavings?: number; firstMessage?: string | null; top: Array<{ instanceId: string; name?: string; message: string; monthlyDeltaUsd: number }>; lastSnap: string | null };
  ops: { cronLastAt: string | null; backfillLastAt: string | null; snapshots: Record<string, SnapMeta> };
}

export function useSummary() {
  const r = useJson<DashboardSummary>("/api/dashboard/summary");
  useOnRefreshed(r.reload);
  return r;
}
