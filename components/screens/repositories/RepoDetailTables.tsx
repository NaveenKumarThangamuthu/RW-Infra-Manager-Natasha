"use client";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { istDateTime, num } from "@/components/natasha/format";
import { Dot, EmptyState, HeadRow } from "@/components/natasha/primitives";
import { tint } from "@/lib/utils";
import { CATEGORY_LABEL, duration, failureReason, PAGE_SIZE, SCAN_META, scanState, SEV_META, SEVERITIES, type Finding, type ScanJob } from "./types";

const FINDING_COLS = "84px 150px minmax(150px,0.9fr) minmax(220px,1.6fr) minmax(180px,1.2fr) 80px";
const HISTORY_COLS = "170px minmax(120px,0.8fr) minmax(200px,1.4fr) minmax(150px,1fr) 90px 96px 80px";
const HISTORY_PREVIEW = 8;
const TRIGGER_LABEL: Record<string, string> = { manual: "Manual", cron: "Scheduled", webhook: "On push", push: "On push" };
const SELECT = "h-8 cursor-pointer rounded-[8px] border border-solid border-input bg-card px-2 text-[13px] text-foreground outline-none";

/** Scanners record paths inside their temporary folder; show the path inside the repository. */
const cleanPath = (p: string) => p.replace(/^\/tmp\/natasha-scan-\d+-[A-Za-z0-9]+\//, "");

export function FindingsCard({ findings, total, loading, hasScans }: { findings: Finding[]; total: number; loading: boolean; hasScans: boolean }) {
  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [q, severity, category]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return findings.filter((f) => (!severity || f.severity === severity) && (!category || f.category === category)
      && (!needle || `${f.title} ${f.ruleId} ${f.file ?? ""}`.toLowerCase().includes(needle)));
  }, [findings, q, severity, category]);
  const categories = useMemo(() => Array.from(new Set(findings.map((f) => f.category))).sort(), [findings]);
  const filtered = !!(q.trim() || severity || category);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const start = current * PAGE_SIZE;
  const shown = list.slice(start, start + PAGE_SIZE);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3.5" title={`Open findings (${filtered ? `${num(list.length)} of ${num(total)}` : num(total)})`}
        description="Reported by a scan in the last 2 days and not marked as accepted. Secret values are never shown." />
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3.5">
        <SearchInput wrapperClassName="min-w-[200px] max-w-[360px] flex-[1_1_240px]" placeholder="Search by rule, file or title…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={SELECT} aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All severities</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{SEV_META[s].label}</option>)}
        </select>
        <select className={SELECT} aria-label="Type" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All types</option>
          {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[980px]">
          <HeadRow columns={FINDING_COLS} className="border-t"><span>Severity</span><span>Type</span><span>Rule</span><span>Finding</span><span>Location</span><span>Found by</span></HeadRow>
          {shown.map((f) => {
            const sev = SEV_META[f.severity] ?? SEV_META.INFO;
            const where = f.file ? `${cleanPath(f.file)}${f.line ? `:${f.line}` : ""}` : null;
            return (
              <div key={f.id} className="grid min-h-11 items-center gap-3.5 border-0 border-b border-solid border-border px-5 py-1.5 text-[13px] hover:bg-hover" style={{ gridTemplateColumns: FINDING_COLS }}>
                <span><Badge tone={sev.color}>{sev.label}</Badge></span>
                <span className="truncate text-[12.5px] text-fg-2">{CATEGORY_LABEL[f.category] ?? f.category}</span>
                <span className="truncate whitespace-nowrap font-mono text-[12px]" title={f.ruleId}>{f.ruleId}</span>
                <span className="truncate" title={f.title}>{f.title}</span>
                <span className="truncate font-mono text-[12px] text-fg-2" title={where ?? undefined}>{where ?? "—"}</span>
                <span className="truncate text-[12.5px] capitalize text-muted-foreground">{f.scanner}</span>
              </div>
            );
          })}
          {list.length === 0 && (
            <EmptyState title={loading ? "Loading findings…" : total === 0 ? "No open findings" : "No findings match these filters"}>
              {loading ? null : total === 0 ? (hasScans ? "The latest scans report nothing open for this repository." : "Run a scan to check this repository.") : "Clear the search or pick another severity."}
            </EmptyState>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3.5 pt-3 text-[12.5px] text-muted-foreground tnum">
        <span>
          {list.length === 0 ? "Showing 0 findings" : `Showing ${start + 1}–${start + shown.length} of ${num(list.length)}`}
          {total > findings.length ? ` · the first ${num(findings.length)} of ${num(total)} are listed` : ""}
        </span>
        {pages > 1 && (
          <span className="flex items-center gap-2">
            <Button size="xs" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</Button>
            <span>Page {current + 1} of {pages}</span>
            <Button size="xs" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</Button>
          </span>
        )}
      </div>
    </Card>
  );
}

export function ScanHistoryCard({ jobs, loading }: { jobs: ScanJob[]; loading: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? jobs : jobs.slice(0, HISTORY_PREVIEW);
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3.5" title="Scan history" description={jobs.length ? `Latest ${num(jobs.length)} scans of this repository · times in IST` : "Scans of this repository"} />
      <div className="overflow-x-auto">
        <div className="min-w-[1000px]">
          <HeadRow columns={HISTORY_COLS} className="border-t"><span>Started</span><span>Branch</span><span>Result</span><span>Started by</span><span className="text-right">Duration</span><span className="text-right">New findings</span><span>Commit</span></HeadRow>
          {shown.map((j) => {
            const state = scanState(j), meta = SCAN_META[state];
            return (
              <div key={j.id} className="grid min-h-11 items-center gap-3.5 border-0 border-b border-solid border-border px-5 py-1.5 text-[13px] hover:bg-hover" style={{ gridTemplateColumns: HISTORY_COLS }}>
                <span className="text-[12.5px] text-fg-2 tnum">{istDateTime(j.startedAt).replace(" IST", "")}</span>
                <span className="truncate font-mono text-[12px]" title={j.branch}>{j.branch}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <Badge className="shrink-0 gap-[5px] border-none" style={{ color: meta.color, background: state === "skipped" || state === "none" ? "var(--card-2)" : tint(meta.color) }}><Dot color={meta.color} />{meta.label}</Badge>
                  {state === "failed" && <span className="truncate text-[12px] text-muted-foreground" title={failureReason(j.errorMessage)}>{failureReason(j.errorMessage)}</span>}
                </span>
                <span className="truncate text-[12.5px] text-fg-2" title={j.triggeredBy}>{TRIGGER_LABEL[j.trigger] ?? j.trigger} · {j.triggeredBy}</span>
                <span className="text-right text-[12.5px] text-fg-2 tnum">{duration(j.durationMs)}</span>
                <span className="text-right tnum">{state === "success" ? num(j.findingsCount) : "—"}</span>
                <span className="font-mono text-[12px] text-muted-foreground">{j.commitSha ? j.commitSha.slice(0, 7) : "—"}</span>
              </div>
            );
          })}
          {jobs.length === 0 && <EmptyState title={loading ? "Loading scans…" : "No scans yet"}>{loading ? null : "No scan has run for this repository."}</EmptyState>}
        </div>
      </div>
      {jobs.length > HISTORY_PREVIEW && (
        <div className="px-5 pb-3.5 pt-3"><Button size="xs" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${num(jobs.length)} scans`}</Button></div>
      )}
    </Card>
  );
}
