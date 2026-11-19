"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ago, istDateTime, num } from "@/components/natasha/format";
import { Banner, ErrorNote, PageHeader, Screen, StatStrip } from "@/components/natasha/primitives";
import { useJson } from "@/components/useJson";
import { cn } from "@/lib/utils";
import { FindingsCard, ScanHistoryCard } from "./RepoDetailTables";
import { failureReason, SCAN_META, scanState, SEV_META, type FindingsResp, type ScansResp } from "./types";

const AUTO_REFRESH_MS = 30_000;
const CURRENT_WINDOW_MS = 2 * 86_400_000;

export default function RepoDetail({ owner, name }: { owner: string; name: string }) {
  const repoFull = `${owner}/${name}`;
  const enc = encodeURIComponent(repoFull);
  const scans = useJson<ScansResp>(`/api/security/scans?repo=${enc}`);
  const found = useJson<FindingsResp>(`/api/security/findings?repo=${enc}`);
  const reloadScans = scans.reload, reloadFound = found.reload;
  const reloadAll = useCallback(() => { reloadScans(); reloadFound(); }, [reloadScans, reloadFound]);
  useEffect(() => {
    const id = setInterval(reloadAll, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [reloadAll]);

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const jobs = scans.data?.jobs ?? [];
  const latest = jobs[0];
  const lastGood = jobs.find((j) => j.status === "success");
  const findings = found.data?.findings ?? [];
  const bySev = found.data?.bySeverity ?? {};
  const total = found.data?.total ?? Object.values(bySev).reduce((a, b) => a + b, 0);

  const triggerScan = async () => {
    if (!window.confirm(`Scan ${repoFull} now? This downloads the repository and can take a few minutes.`)) return;
    setScanning(true);
    setScanError(null);
    try {
      const branch = latest?.branch ?? "main";
      const res = await fetch("/api/security/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner, name, branch }) });
      if (!res.ok) throw new Error("The scan did not finish. See the scan history below for the reason.");
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
      reloadAll();
    }
  };

  const state = scanState(latest);
  const staleGood = !!lastGood && Date.now() - new Date(lastGood.startedAt).getTime() > CURRENT_WINDOW_MS;
  const sev = (k: string) => ({ label: SEV_META[k].label, value: num(bySev[k] ?? 0), color: (bySev[k] ?? 0) > 0 ? SEV_META[k].color : undefined });

  return (
    <Screen label="Repository">
      <PageHeader title={name}
        eyebrow={<><Link href="/security" className="text-muted-foreground no-underline hover:underline">Repositories</Link> / {owner}</>}
        description={latest
          ? `Latest scan: ${SCAN_META[state].label.toLowerCase()} · ${istDateTime(latest.startedAt)} (${ago(latest.startedAt)}) · branch ${latest.branch}`
          : scans.data ? "This repository has not been scanned yet." : "Scan history and open findings for this repository."}
        actions={<>
          <Button asChild size="lg"><a href={`https://github.com/${repoFull}`} target="_blank" rel="noopener noreferrer" className="no-underline"><ExternalLink size={14} className="block" />View on GitHub</a></Button>
          <Button variant="primary" size="lg" className="px-3.5" disabled={scanning} onClick={() => void triggerScan()}><RefreshCw size={14} className={cn("block", scanning && "animate-nt-spin")} />{scanning ? "Scanning…" : "Scan now"}</Button>
        </>} />
      {scanError && <ErrorNote message={scanError} />}
      {scans.error && <ErrorNote message={scans.error} onRetry={reloadAll} />}
      {found.error && <ErrorNote message={found.error} onRetry={reloadAll} />}
      {state === "failed" && (
        <Banner tone="var(--danger)">
          The latest scan failed: {failureReason(latest?.errorMessage)}.{lastGood ? ` The last scan that finished was ${istDateTime(lastGood.startedAt)}.` : " No scan of this repository has finished yet."}
        </Banner>
      )}
      {staleGood && <Banner tone="var(--warning)">The last scan that finished was {ago(lastGood?.startedAt)}. Findings count as open only when a scan in the last 2 days reported them, so run a scan to bring this page up to date.</Banner>}
      <StatStrip items={[
        { label: "Open findings", value: num(total), sub: "Seen in the last 2 days" },
        sev("CRIT"), sev("HIGH"), sev("MED"),
        { label: "Low and info", value: num((bySev.LOW ?? 0) + (bySev.INFO ?? 0)) },
      ]} />
      <FindingsCard findings={findings} total={total} loading={found.loading && !found.data} hasScans={jobs.length > 0} />
      <ScanHistoryCard jobs={jobs} loading={scans.loading && !scans.data} />
    </Screen>
  );
}
