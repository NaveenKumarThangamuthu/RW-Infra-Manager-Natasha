"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { ago, num } from "@/components/natasha/format";
import { Banner, ErrorNote, Kpi, KpiGrid, PageHeader, Screen, ScreenSkeleton } from "@/components/natasha/primitives";
import { useJson } from "@/components/useJson";
import { cn, tint } from "@/lib/utils";
import { NotConnected } from "./NotConnected";
import { RepoTable, stacksOf } from "./RepoTable";
import { scanState, STACK_LABEL, type Repo, type ReposResp, type ScanJob, type ScansResp } from "./types";
import { useRepoActions } from "./useRepoActions";

type StatusFilter = "all" | "failed" | "findings" | "clean" | "none";
type Visibility = "all" | "private" | "public";
const AUTO_REFRESH_MS = 5 * 60_000;
const DAY_MS = 24 * 3_600_000;
const NOTICE_TONE = { success: "var(--success)", danger: "var(--danger)", info: "var(--info)" } as const;
const STATE_RANK: Record<string, number> = { failed: 0, running: 1, success: 2, skipped: 3, none: 4 };

function Inner() {
  const justConnected = useSearchParams().get("status") === "connected";
  const [showArchived, setShowArchived] = useState(false);
  const { data, error, reload } = useJson<ReposResp>(showArchived ? "/api/security/repos?archived=1" : "/api/security/repos");
  const { data: scansData, reload: reloadScans } = useJson<ScansResp>("/api/security/scans");
  const reloadAll = useCallback(() => { reload(); reloadScans(); }, [reload, reloadScans]);
  useEffect(() => {
    const id = setInterval(reloadAll, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [reloadAll]);

  const latestByRepo = useMemo(() => {
    const m = new Map<string, ScanJob>();
    for (const j of scansData?.jobs ?? []) {
      const prev = m.get(j.repoFullName);
      if (!prev || new Date(j.startedAt) > new Date(prev.startedAt)) m.set(j.repoFullName, j);
    }
    return m;
  }, [scansData]);

  const actions = useRepoActions(latestByRepo, reloadAll);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [visibility, setVisibility] = useState<Visibility>("all");
  const [stack, setStack] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [q, status, visibility, stack, showArchived]);

  const stateOf = useCallback((r: Repo) => scanState(latestByRepo.get(r.full_name)), [latestByRepo]);
  const matchesStatus = useCallback((r: Repo, f: StatusFilter) => {
    const s = stateOf(r), total = r.findings?.total ?? 0;
    return f === "all" || (f === "failed" && s === "failed") || (f === "findings" && total > 0) || (f === "clean" && s === "success" && total === 0) || (f === "none" && s === "none");
  }, [stateOf]);

  const repos = useMemo(() => {
    const urgent = (r: Repo) => (r.findings?.CRIT ?? 0) * 1_000_000 + (r.findings?.HIGH ?? 0);
    return [...(data?.repos ?? [])].sort((a, b) => STATE_RANK[stateOf(a)] - STATE_RANK[stateOf(b)] || urgent(b) - urgent(a) || a.name.localeCompare(b.name));
  }, [data, stateOf]);

  const base = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return repos.filter((r) => (visibility === "all" || (visibility === "private") === r.private)
      && (!needle || `${r.full_name} ${r.description ?? ""} ${r.language ?? ""}`.toLowerCase().includes(needle))
      && (!stack || stacksOf(r).includes(stack)));
  }, [repos, q, visibility, stack]);
  const list = useMemo(() => base.filter((r) => matchesStatus(r, status)), [base, status, matchesStatus]);

  if (data && !data.connected) return <NotConnected />;

  const working = actions.syncing || !!actions.bulk || !!actions.scanningOne;
  const header = (
    <PageHeader title="Repositories"
      description={data?.connected
        ? `GitHub repositories and the result of their latest security scan.${data.me ? ` Connected as @${data.me.login}.` : ""}${data.syncedAt ? ` List synced from GitHub ${ago(data.syncedAt)}.` : ""}`
        : "GitHub repositories and the result of their latest security scan."}
      actions={data?.connected ? <>
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 text-[12.5px] text-fg-2" title="Leave out repositories scanned in the last 24 hours">
          <input type="checkbox" checked={actions.skipRecent} disabled={!!actions.bulk} onChange={(e) => actions.setSkipRecent(e.target.checked)} />Skip recently scanned
        </label>
        <Button size="lg" disabled={working} onClick={() => void actions.sync()} title="Fetch the repository list from GitHub again">
          <RefreshCw size={14} className={cn("block", actions.syncing && "animate-nt-spin")} />{actions.syncing ? "Syncing…" : "Sync repositories"}
        </Button>
        <Button variant="primary" size="lg" className="px-3.5" disabled={working} onClick={() => void actions.scanAll(list)} title="Scan every repository in the current view">
          <ShieldCheck size={14} className="block" />
          {actions.bulk ? `Scanning ${actions.bulk.done} of ${actions.bulk.total}${actions.bulk.failed ? ` · ${actions.bulk.failed} failed` : ""}` : `Scan all (${list.filter((r) => !r.archived).length})`}
        </Button>
      </> : undefined} />
  );
  if (error) return <Screen label="Repositories">{header}<ErrorNote message={error} onRetry={reloadAll} /></Screen>;
  if (!data) return <ScreenSkeleton />;

  const count = (f: StatusFilter) => base.filter((r) => matchesStatus(r, f)).length;
  const scanned = repos.filter((r) => stateOf(r) === "success");
  const failed = repos.filter((r) => stateOf(r) === "failed").length;
  const scannedToday = scanned.filter((r) => Date.now() - new Date(latestByRepo.get(r.full_name)?.startedAt ?? 0).getTime() <= DAY_MS).length;
  const serious = repos.filter((r) => (r.findings?.CRIT ?? 0) + (r.findings?.HIGH ?? 0) > 0);
  const crit = repos.reduce((a, r) => a + (r.findings?.CRIT ?? 0), 0), high = repos.reduce((a, r) => a + (r.findings?.HIGH ?? 0), 0);
  const archived = data.archivedCount ?? data.archivedHidden ?? 0;
  const chips: Array<[StatusFilter, string, string | null]> = [["all", "All", null], ["failed", "Failed", "var(--danger)"], ["findings", "With findings", "var(--warning)"], ["clean", "Clean", "var(--success)"], ["none", "Not scanned", null]];

  return (
    <Screen label="Repositories">
      {header}
      {justConnected && <Banner tone="var(--success)">GitHub is connected. Your repositories are listed below.</Banner>}
      {actions.notice && (
        <Banner tone={NOTICE_TONE[actions.notice.tone]}>
          <span className="min-w-0 flex-1">{actions.notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => actions.setNotice(null)} className="inline-grid h-6 w-6 cursor-pointer place-items-center rounded-[6px] border-none bg-transparent text-muted-foreground hover:bg-hover"><X size={13} className="block" /></button>
        </Banner>
      )}
      {actions.bulk?.current && <Banner tone="var(--info)">Scanning {actions.bulk.current}… Keep this tab open until the scan finishes.</Banner>}
      {data.allowlist?.error && <Banner tone="var(--warning)">Scope list unavailable, showing every repository.</Banner>}
      {data.allowlist && !data.allowlist.error && !!data.excludedByAllowlist && (
        <Banner tone="var(--info)">Limited to the {num(data.allowlist.count)} repositories on the running services list. {num(data.excludedByAllowlist)} others are hidden.</Banner>
      )}
      <KpiGrid>
        <Kpi label="Repositories" value={num(repos.length)} footer={archived ? `${num(archived)} archived ${showArchived ? "included" : "not shown"}` : "Active repositories in scope"} />
        <Kpi label="Scanned" value={num(scanned.length)} valueColor={scanned.length ? "var(--success)" : undefined} footer={`${num(scannedToday)} in the last 24 hours`} />
        <Kpi label="Failed" value={num(failed)} valueColor={failed ? "var(--danger)" : "var(--success)"} footer={failed ? "Latest scan did not finish" : "Every latest scan finished"} />
        <Kpi label="With critical or high" value={num(serious.length)} valueColor={serious.length ? "var(--orange)" : "var(--success)"} footer={`${num(crit)} critical · ${num(high)} high open`} />
      </KpiGrid>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-border px-4 py-3.5">
          <SearchInput wrapperClassName="min-w-[200px] max-w-[360px] flex-[1_1_240px]" placeholder="Search repositories…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Segmented<Visibility> value={visibility} onChange={setVisibility} aria-label="Visibility" options={[{ value: "all", label: "All" }, { value: "private", label: "Private" }, { value: "public", label: "Public" }]} />
          {stack && (
            <button type="button" onClick={() => setStack(null)} title="Clear the stack filter" className="inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-[8px] border border-solid border-border-strong bg-card-2 px-2.5 text-[12.5px] font-medium text-foreground">
              {STACK_LABEL[stack] ?? stack}<X size={12} className="block" />
            </button>
          )}
          {archived > 0 && (
            <label className="inline-flex h-[30px] cursor-pointer items-center gap-2 text-[12.5px] text-fg-2">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived ({num(archived)})
            </label>
          )}
          <div className="ml-auto flex flex-wrap gap-1.5">
            {chips.map(([k, label, color]) => {
              const on = status === k, mix = color ?? "var(--fg)";
              return (
                <button key={k} type="button" aria-pressed={on} onClick={() => setStatus(k)} className="inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-[8px] border border-solid px-2.5 text-[12.5px] font-medium text-fg-2 hover:border-border-strong"
                  style={{ borderColor: on ? `color-mix(in oklab, ${mix} 45%, transparent)` : "var(--border)", background: on ? tint(mix, 12) : "transparent" }}>
                  {label}<span className="text-muted-foreground tnum">{count(k)}</span>
                </button>
              );
            })}
          </div>
        </div>
        <RepoTable rows={list} page={page} onPage={setPage} latestByRepo={latestByRepo} stack={stack} onStack={setStack} onScan={(r) => void actions.scanOne(r)} scanningOne={actions.scanningOne} busy={working} />
      </Card>
      <div className="text-[12.5px] leading-[1.5] text-muted-foreground">
        Open findings are the ones the latest scans still report (seen in the last 2 days, not marked as accepted). Failed scans are listed first, then repositories with the most critical and high findings.
      </div>
    </Screen>
  );
}

export default function Repositories() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <Inner />
    </Suspense>
  );
}
