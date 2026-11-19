"use client";
import Link from "next/link";
import { ExternalLink, RefreshCw } from "lucide-react";
import { detectFrameworks } from "@/components/FrameworkBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ago, istDate, istDateTime, num } from "@/components/natasha/format";
import { Dot, EmptyState, HeadRow } from "@/components/natasha/primitives";
import { cn, tint } from "@/lib/utils";
import { failureReason, PAGE_SIZE, SCAN_META, scanState, STACK_LABEL, type Repo, type ScanJob } from "./types";

const COLS = "minmax(220px,1.7fr) 136px 196px minmax(96px,0.6fr) 112px 92px 72px";

export const stacksOf = (r: Repo) => detectFrameworks({ language: r.language, name: r.name, fullName: r.full_name, description: r.description });

function StatusCell({ job }: { job: ScanJob | undefined }) {
  const state = scanState(job);
  const meta = SCAN_META[state];
  const reason = state === "failed" ? failureReason(job?.errorMessage) : null;
  const when = job ? istDateTime(job.startedAt) : null;
  return (
    <div className="min-w-0" title={[reason, when ? `Last scan started ${when}` : "No scan has run yet"].filter(Boolean).join(" · ")}>
      <Badge className="gap-[5px] border-none" style={{ color: meta.color, background: state === "none" || state === "skipped" ? "var(--card-2)" : tint(meta.color) }}>
        <Dot color={meta.color} />{meta.label}
      </Badge>
      <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{reason ?? (job ? ago(job.startedAt) : "No scan yet")}</div>
    </div>
  );
}

function FindingsCell({ repo, state }: { repo: Repo; state: string }) {
  const f = repo.findings;
  if (!f || state === "none") return <span className="text-subtle">—</span>;
  if (f.total === 0) return <span className="text-[12.5px] text-muted-foreground">{state === "success" ? "None open" : "—"}</span>;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="font-medium tnum">{num(f.total)}</span>
      {f.CRIT > 0 && <Badge size="xs" tone="var(--danger)">{num(f.CRIT)} critical</Badge>}
      {f.HIGH > 0 && <Badge size="xs" tone="var(--orange)">{num(f.HIGH)} high</Badge>}
    </div>
  );
}

export function RepoTable({ rows, page, onPage, latestByRepo, stack, onStack, onScan, scanningOne, busy }: {
  rows: Repo[]; page: number; onPage: (p: number) => void; latestByRepo: Map<string, ScanJob>;
  stack: string | null; onStack: (k: string | null) => void; onScan: (r: Repo) => void; scanningOne: string | null; busy: boolean;
}) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const start = current * PAGE_SIZE;
  const shown = rows.slice(start, start + PAGE_SIZE);

  return (
    <>
      <div className="overflow-x-auto">
        <div className="min-w-[1040px]">
          <HeadRow columns={COLS}>
            <span>Repository</span><span>Scan status</span><span>Open findings</span><span>Stack</span><span>Branch scanned</span><span>Last push</span><span />
          </HeadRow>
          {shown.map((r) => {
            const job = latestByRepo.get(r.full_name);
            const state = scanState(job);
            const scanning = scanningOne === r.full_name;
            return (
              <div key={r.id} className={cn("grid min-h-[56px] items-center gap-3.5 border-0 border-b border-solid border-border px-5 py-1.5 text-[13px] hover:bg-hover", r.archived && "opacity-60")} style={{ gridTemplateColumns: COLS }}>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Link href={`/security/${r.owner}/${r.name}`} className="min-w-0 truncate font-medium text-foreground no-underline hover:underline" title={r.full_name}>{r.name}</Link>
                    <a href={r.html_url} target="_blank" rel="noopener noreferrer" title="Open on GitHub" aria-label={`Open ${r.full_name} on GitHub`} className="shrink-0 text-muted-foreground hover:text-foreground"><ExternalLink size={12} className="block" /></a>
                    {!r.private && <Badge size="xs" tone="var(--warning)">Public</Badge>}
                    {r.fork && <Badge size="xs">Fork</Badge>}
                    {r.archived && <Badge size="xs">Archived</Badge>}
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-muted-foreground" title={r.description ?? undefined}>{r.owner}{r.description ? ` · ${r.description}` : ""}</div>
                </div>
                <StatusCell job={job} />
                <FindingsCell repo={r} state={state} />
                <div className="flex min-w-0 flex-wrap gap-1">
                  {stacksOf(r).slice(0, 2).map((k) => (
                    <button key={k} type="button" aria-pressed={stack === k} title={stack === k ? "Clear this filter" : `Show only ${STACK_LABEL[k] ?? k} repositories`} onClick={() => onStack(stack === k ? null : k)}
                      className="inline-flex h-5 cursor-pointer items-center rounded-[5px] border border-solid border-border bg-transparent px-1.5 text-[11.5px] font-medium text-fg-2 hover:border-border-strong">
                      {STACK_LABEL[k] ?? k}
                    </button>
                  ))}
                </div>
                <span className="truncate font-mono text-[12px] text-fg-2" title={r.scan_branch !== r.default_branch ? `Default branch: ${r.default_branch}` : undefined}>{r.scan_branch}</span>
                <span className="text-[12.5px] text-fg-2 tnum">{r.pushed_at ? istDate(r.pushed_at) : "—"}</span>
                <Button size="xs" className="justify-self-end gap-[5px] rounded-[7px]" disabled={busy || r.archived} onClick={() => onScan(r)} title={r.archived ? "Archived repositories are not scanned" : "Scan this repository now"}>
                  <RefreshCw size={12} className={cn("block", scanning && "animate-nt-spin")} />{scanning ? "Scanning" : "Scan"}
                </Button>
              </div>
            );
          })}
          {rows.length === 0 && <EmptyState title="No repositories match these filters">Clear the search or pick another status.</EmptyState>}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3.5 pt-3 text-[12.5px] text-muted-foreground tnum">
        <span>{rows.length === 0 ? "Showing 0 repositories" : `Showing ${start + 1}–${start + shown.length} of ${rows.length} repositories`}</span>
        {pages > 1 && (
          <span className="flex items-center gap-2">
            <Button size="xs" disabled={current === 0} onClick={() => onPage(current - 1)}>Previous</Button>
            <span>Page {current + 1} of {pages}</span>
            <Button size="xs" disabled={current >= pages - 1} onClick={() => onPage(current + 1)}>Next</Button>
          </span>
        )}
      </div>
    </>
  );
}
