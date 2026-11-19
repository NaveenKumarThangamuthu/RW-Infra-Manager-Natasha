"use client";
import { useCallback, useState } from "react";
import type { Repo, ScanJob } from "./types";

const PARALLEL_SCANS = 3;
const RECENT_MS = 24 * 3_600_000;
const SECONDS_PER_SCAN = 12;

export interface Notice { tone: "success" | "danger" | "info"; text: string }
export interface BulkProgress { done: number; total: number; failed: number; current: string | null }

async function requestScan(repo: Repo): Promise<boolean> {
  let ok = false;
  try {
    const res = await fetch("/api/security/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: repo.full_name, owner: repo.owner, name: repo.name, branch: repo.scan_branch || repo.default_branch }),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  return ok;
}

/** Sync, scan one and scan all for the Repositories screen. */
export function useRepoActions(latestByRepo: Map<string, ScanJob>, onChanged: () => void) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [bulk, setBulk] = useState<BulkProgress | null>(null);
  const [scanningOne, setScanningOne] = useState<string | null>(null);
  const [skipRecent, setSkipRecent] = useState(true);

  const sync = useCallback(async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const res = await fetch("/api/security/repos/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Sync failed (${res.status})`);
      setNotice({ tone: "success", text: `Synced ${body.fetched} repositories from GitHub: ${body.inserted} new, ${body.updated} updated.` });
      onChanged();
    } catch (e) {
      setNotice({ tone: "danger", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSyncing(false);
    }
  }, [onChanged]);

  const scanOne = useCallback(async (repo: Repo) => {
    if (!window.confirm(`Scan ${repo.full_name} now? This downloads the repository and can take a few minutes.`)) return;
    setScanningOne(repo.full_name);
    setNotice(null);
    const ok = await requestScan(repo);
    setScanningOne(null);
    setNotice(ok ? { tone: "success", text: `Scan of ${repo.full_name} finished.` } : { tone: "danger", text: `Scan of ${repo.full_name} failed. Open the repository for details.` });
    onChanged();
  }, [onChanged]);

  const scanAll = useCallback(async (visible: Repo[]) => {
    const targets = visible.filter((r) => {
      const job = latestByRepo.get(r.full_name);
      const recent = !!job && Date.now() - new Date(job.startedAt).getTime() <= RECENT_MS;
      return !r.archived && !(skipRecent && recent);
    });
    if (targets.length === 0) {
      setNotice({ tone: "info", text: "Nothing to scan: every repository in this view was scanned in the last 24 hours. Untick “Skip recently scanned” to scan them again." });
      return;
    }
    const minutes = Math.max(1, Math.ceil((targets.length * SECONDS_PER_SCAN) / 60));
    const plural = targets.length === 1 ? "repository" : "repositories";
    if (!window.confirm(`Scan ${targets.length} ${plural}? Each one is downloaded and checked for vulnerable dependencies and secrets, ${PARALLEL_SCANS} at a time. This takes about ${minutes} min or more and keeps the server busy.`)) return;

    setNotice(null);
    let done = 0;
    let failed = 0;
    const queue = [...targets];
    setBulk({ done, total: targets.length, failed, current: null });
    const worker = async () => {
      for (let repo = queue.shift(); repo; repo = queue.shift()) {
        const name = repo.name;
        setBulk((p) => (p ? { ...p, current: name } : p));
        if (!(await requestScan(repo))) failed++;
        done++;
        setBulk({ done, total: targets.length, failed, current: null });
      }
    };
    await Promise.all(Array.from({ length: PARALLEL_SCANS }, worker));
    setBulk(null);
    setNotice({ tone: failed ? "danger" : "success", text: `Scan finished: ${done - failed} scanned, ${failed} failed.` });
    onChanged();
  }, [latestByRepo, skipRecent, onChanged]);

  return { notice, setNotice, syncing, sync, bulk, scanAll, scanningOne, scanOne, skipRecent, setSkipRecent };
}
