"use client";
import { useState, type ReactNode } from "react";
import { Check, Copy, Minus, Play, RefreshCw, Terminal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ago, isStale, num } from "@/components/natasha/format";
import { Dot, ErrorNote, Kpi, KpiGrid, PageHeader, Screen, ScreenSkeleton } from "@/components/natasha/primitives";
import { useOnRefreshed, useShell } from "@/components/shell/ShellContext";
import { useSummary } from "@/components/shell/useOps";
import { useJson } from "@/components/useJson";
import { cn, tint } from "@/lib/utils";

interface SourceStatus { source: string; status: string | null; capturedAt: string | null; fetchMs: number | null; error: string | null; lastGoodAt: string | null }
interface RunRef { startedAt: string; finishedAt: string | null; status: string; label?: string | null }
interface CronStatus {
  sources: SourceStatus[];
  runs: Array<{ label: string; startedAt: string; ok: number; total: number; durationMs: number }>;
  lastBilling: RunRef | null;
  lastBackfill: RunRef | null;
  lastCertificateCheck: string | null;
  repos: { count: number; lastSyncedAt: string | null };
}

const SOURCE_LABEL: Record<string, string> = {
  "spring-health": "Spring health", "spring-logs": "Spring logs", "ec2-health": "EC2 status checks", "ec2-volumes": "EBS volumes",
  "cloudwatch-alarms": "CloudWatch alarms", "prom-alerts": "Prometheus alerts", recommendations: "Recommendations", "lambda-ohio": "Lambda · Ohio",
};
const FRESH_LABEL: Record<string, string> = { "ec2-health": "EC2", "ec2-volumes": "Volumes", "cloudwatch-alarms": "CloudWatch", "prom-alerts": "Prometheus", "lambda-ohio": "Lambda" };
// The host crontab runs in host local time (IST), so the UTC hours below are 00:30 and 12:30 IST.
const CRON_SCHEDULE = [{ h: 7, m: 0, ist: "12:30 IST", utc: "07:00 UTC" }, { h: 19, m: 0, ist: "00:30 IST", utc: "19:00 UTC" }];
const JOB_COLS = "minmax(180px,1.2fr) minmax(220px,1.4fr) 100px 190px 80px 76px";
const HIST_COLS = "150px 110px minmax(160px,1fr) 90px 110px";
const HEAD = "grid h-[38px] items-center gap-3.5 border-0 border-y border-solid border-border bg-card-2 px-5 text-[12px] font-medium text-muted-foreground";
const CRONTAB = `# Natasha refresh · twice daily, host local time (IST)
30 0 * * * scripts/cron-refresh.sh "0030-utc-06ist"
30 12 * * * scripts/cron-refresh.sh "1230-utc-18ist"

# scripts/cron-refresh.sh — chains ops + billing + certs; each call logs independently
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/cron/refresh-all?label=$LABEL"
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/refresh?label=$LABEL"
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/certificates/refresh?label=$LABEL"`;

const RUN_LABEL: Record<string, string> = { "0030-utc-06ist": "00:30 IST run", "1230-utc-18ist": "12:30 IST run" };
/** The host passes historical labels such as "0030-utc-06ist"; show what they mean. */
const runLabel = (label: string | null | undefined) => (label ? RUN_LABEL[label] ?? (/^manual/i.test(label) ? "Manual run" : label) : "Manual run");
/** A short reason for a failed source. The raw error names the AWS account, so it is never shown. */
const failReason = (error: string | null) => (/denied|not authorized|unauthori[sz]ed|forbidden/i.test(error ?? "") ? "AWS permission denied" : /timed? ?out|ECONN|ENOTFOUND|network/i.test(error ?? "") ? "Could not reach the service" : null);

function nextRun() {
  const now = new Date();
  const candidates = [0, 1].flatMap((d) => CRON_SCHEDULE.map((s) => ({ ...s, at: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, s.h, s.m) })));
  const next = candidates.find((c) => c.at > now.getTime()) ?? candidates[0];
  const mins = Math.round((next.at - now.getTime()) / 60_000);
  return { label: `in ${Math.floor(mins / 60)}h ${mins % 60}m`, sub: `${next.ist} · ${next.utc}` };
}

const seconds = (ms: number | null | undefined) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`);
function between(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return "—";
  const s = Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 1000);
  return s < 120 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

type Tone = "ok" | "fail" | "busy" | "none";
function StepIcon({ tone }: { tone: Tone }) {
  const color = tone === "ok" ? "var(--success)" : tone === "fail" ? "var(--danger)" : tone === "busy" ? "var(--info)" : "var(--muted-fg)";
  return (
    <span className="grid h-5 w-5 place-items-center rounded-[20px]" style={{ color, background: tone === "none" ? "var(--card-2)" : tint(color) }}>
      {tone === "ok" ? <Check size={12} className="block" /> : tone === "fail" ? <X size={12} className="block" /> : tone === "busy" ? <RefreshCw size={12} className="block animate-nt-spin" /> : <Minus size={12} className="block" />}
    </span>
  );
}

function Step({ tone, name, tag, detail, detailColor }: { tone: Tone; name: string; tag?: string; detail: ReactNode; detailColor?: string }) {
  return (
    <div className="grid min-h-[42px] grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 px-5 text-[13px]">
      <StepIcon tone={tone} />
      <div className="min-w-0"><span className="font-medium">{name}</span>{tag && <span className="ml-2 font-mono text-[11.5px] text-muted-foreground">{tag}</span>}</div>
      <span className="text-right text-[12px] tnum" style={{ color: detailColor ?? "var(--muted-fg)" }}>{detail}</span>
    </div>
  );
}

export default function CronJobs() {
  const { refresh, refreshing, toast } = useShell();
  const { data, error, reload } = useJson<CronStatus>("/api/cron/status");
  const { data: anomalies } = useJson<{ anomalies: unknown[] }>("/api/cost/anomalies");
  const { data: summary } = useSummary();
  useOnRefreshed(reload);
  const [showCrontab, setShowCrontab] = useState(false);

  const runNow = () => void refresh();
  const header = (
    <PageHeader title="Cron jobs"
      description="Scheduled refreshes that keep every page current. They run twice daily at 00:30 and 12:30 IST (19:00 and 07:00 UTC)."
      actions={<>
        <Button size="lg" onClick={() => setShowCrontab((v) => !v)}><Terminal size={14} className="block" />{showCrontab ? "Hide crontab" : "View crontab"}</Button>
        <Button variant="primary" size="lg" className={cn("px-3.5", refreshing && "opacity-70")} disabled={refreshing} onClick={runNow}>
          {refreshing ? <RefreshCw size={14} className="block animate-nt-spin" /> : <Play size={14} className="block" />}{refreshing ? "Running…" : "Run now"}
        </Button>
      </>} />
  );
  if (error) return <Screen label="Cron jobs">{header}<ErrorNote message={error} onRetry={reload} /></Screen>;
  if (!data) return <ScreenSkeleton />;

  const latest = data.runs[0];
  const sources = data.sources;
  const healthy = sources.filter((s) => s.status === "success");
  const failing = sources.filter((s) => s.status === "failed");
  const next = nextRun();
  const avgDur = data.runs.length ? data.runs.reduce((a, r) => a + r.durationMs, 0) / data.runs.length : null;
  const allOk = failing.length === 0;
  const runColor = refreshing ? "var(--info)" : allOk ? "var(--success)" : "var(--warning)";
  const crit = summary?.github.findings.CRIT ?? 0;
  const certOverdue = isStale(data.lastCertificateCheck);

  return (
    <Screen label="Cron jobs">
      {header}
      {showCrontab && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-border px-4 py-3">
            <span className="text-[13px] font-semibold">Host crontab</span>
            <Button size="xs" className="rounded-[7px]" onClick={() => { void navigator.clipboard?.writeText(CRONTAB).catch(() => { /* clipboard blocked */ }); toast("Crontab copied"); }}><Copy size={12} className="block" />Copy</Button>
          </div>
          <div className="overflow-x-auto whitespace-pre bg-card-2 px-4 py-3.5 font-mono text-[12px] leading-[1.75] text-fg-2">
            {CRONTAB.split("\n").map((l, i) => <div key={i} className={l.startsWith("#") ? "text-muted-foreground" : undefined}>{l || " "}</div>)}
          </div>
        </Card>
      )}
      <KpiGrid>
        <Kpi label="Last run" value={ago(latest?.startedAt)} footer={latest ? runLabel(latest.label) : "No scheduled runs yet"} />
        <Kpi label="Next run" value={next.label} footer={next.sub} />
        <Kpi label="Healthy sources" valueColor={allOk ? "var(--success)" : "var(--warning)"}
          value={<>{healthy.length}<span className="text-[15px] font-medium tracking-normal text-muted-foreground"> / {sources.length}</span></>}
          footer={allOk ? "All sources refreshing" : `${failing.map((s) => SOURCE_LABEL[s.source] ?? s.source).join(" and ")} failing`} />
        <Kpi label="Run duration" value={seconds(latest?.durationMs)} footer={avgDur != null ? `Average ${seconds(avgDur)} over the last ${data.runs.length} runs` : "No runs yet"} />
      </KpiGrid>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-start gap-4">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-0 border-b border-solid border-border px-5 py-4">
            <div>
              <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Ops refresh pipeline</h3>
              <div className="mt-[3px] text-[13px] text-muted-foreground">{refreshing ? "Manual run in progress" : latest ? `Latest: ${runLabel(latest.label)} · started ${ago(latest.startedAt)} · ${seconds(latest.durationMs)}` : "No runs recorded yet"}</div>
            </div>
            <Badge size="md" tone={runColor}>{refreshing ? "Running" : allOk ? `Success · ${healthy.length} of ${sources.length}` : `Partial · ${healthy.length} of ${sources.length}`}</Badge>
          </div>
          <div className="px-5 pb-1 pt-3 text-[11.5px] font-medium text-subtle">Data sources · refreshed in parallel</div>
          {sources.map((s) => (
            <Step key={s.source} tone={refreshing ? "busy" : s.status === "success" ? "ok" : s.status === "failed" ? "fail" : "none"} name={SOURCE_LABEL[s.source] ?? s.source}
              detail={refreshing ? "Running…" : s.status === "failed" ? `Failed${failReason(s.error) ? ` · ${failReason(s.error)}` : ""} · last good ${ago(s.lastGoodAt)}` : s.status ? seconds(s.fetchMs) : "Never run"}
              detailColor={refreshing ? "var(--info)" : s.status === "failed" ? "var(--danger)" : undefined} />
          ))}
          <div className="mt-1.5 border-0 border-t border-solid border-border px-5 pb-1 pt-3 text-[11.5px] font-medium text-subtle">After the refresh</div>
          <Step tone={isStale(data.repos.lastSyncedAt) ? "none" : "ok"} name="GitHub repo sync" detail={`${num(data.repos.count)} repos · synced ${ago(data.repos.lastSyncedAt)}`} />
          <Step tone={anomalies ? "ok" : "none"} name="Cost anomaly scan" detail={anomalies ? `${num(anomalies.anomalies.length)} ${anomalies.anomalies.length === 1 ? "anomaly" : "anomalies"} found` : "—"} />
          <Step tone={summary ? "ok" : "none"} name="Critical and high findings" detail={summary ? `${num(crit)} critical · ${num(summary.github.findings.HIGH)} high open` : "—"} />
          <Step tone="none" name="Telegram summary" detail="Sent only when there is something to report" />
          <div className="h-2.5" />
        </Card>
        <Card className="overflow-hidden">
          <div className="border-0 border-b border-solid border-border px-5 py-4">
            <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Snapshot freshness</h3>
            <div className="mt-[3px] text-[13px] text-muted-foreground">Age of the newest good data per source</div>
          </div>
          <div className="flex flex-col pb-2 pt-1">
            {sources.map((s) => {
              const bad = s.status === "failed" || isStale(s.lastGoodAt);
              return (
                <div key={s.source} className="flex min-h-[46px] items-center gap-3 px-5 py-1.5" style={{ background: bad ? tint("var(--warning)", 6) : "transparent" }}>
                  <Dot color={bad ? "var(--warning)" : "var(--success)"} size={8} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{FRESH_LABEL[s.source] ?? SOURCE_LABEL[s.source] ?? s.source}</div>
                    <div className="mt-px text-[12px] text-muted-foreground">{s.status === "failed" ? "Stale · refresh failing" : bad ? "Stale" : "Healthy"}</div>
                  </div>
                  <span className="text-[14px] font-semibold tnum" style={{ color: bad ? "var(--warning)" : "var(--fg)" }}>{ago(s.lastGoodAt).replace(" ago", "")}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <div className="px-5 py-4">
          <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Schedules</h3>
          <div className="mt-[3px] text-[13px] text-muted-foreground">What runs on the schedule and how the last run went</div>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[940px]">
            <div className={HEAD} style={{ gridTemplateColumns: JOB_COLS }}><span>Job</span><span>Schedule</span><span>Last run</span><span>Result</span><span className="text-right">Duration</span><span /></div>
            {[
              { name: "Ops refresh", cadence: "Twice daily · 00:30 and 12:30 IST", last: latest?.startedAt, status: allOk ? "Success" : "Partial", note: `${healthy.length} of ${sources.length} sources refreshed`, dur: seconds(latest?.durationMs), bad: !allOk, run: runNow },
              { name: "Billing refresh", cadence: "Twice daily · right after the ops refresh", last: data.lastBilling?.startedAt, status: data.lastBilling?.status === "error" ? "Failed" : data.lastBilling ? "Success" : "Not run", note: "Cost figures from AWS", dur: between(data.lastBilling?.startedAt, data.lastBilling?.finishedAt), bad: data.lastBilling?.status === "error", idle: !data.lastBilling },
              { name: "Certificate check", cadence: "Twice daily · after the billing refresh", last: data.lastCertificateCheck, status: !data.lastCertificateCheck ? "Not run" : certOverdue ? "Overdue" : "Success", note: "AS2 certificate expiry dates", dur: "—", bad: certOverdue, idle: !data.lastCertificateCheck },
              { name: "Billing history load", cadence: "One-time · three years of monthly costs", last: data.lastBackfill?.startedAt, status: data.lastBackfill ? "Completed" : "Not run", note: "Loads past months once", dur: between(data.lastBackfill?.startedAt, data.lastBackfill?.finishedAt), idle: !data.lastBackfill },
            ].map((j) => {
              const c = j.bad ? "var(--warning)" : j.idle ? "var(--muted-fg)" : "var(--success)";
              return (
                <div key={j.name} className="grid min-h-14 items-center gap-3.5 border-0 border-b border-solid border-border px-5 py-1.5 text-[13px] hover:bg-hover" style={{ gridTemplateColumns: JOB_COLS }}>
                  <div className="min-w-0 font-medium">{j.name}</div>
                  <span className="text-[12.5px] text-fg-2">{j.cadence}</span>
                  <span className="text-[12.5px] text-fg-2">{ago(j.last)}</span>
                  <div className="flex flex-col items-start gap-[3px]">
                    <Badge tone={c} className="gap-[5px]"><Dot color={c} />{j.status}</Badge>
                    <span className="text-[11.5px] text-muted-foreground">{j.note}</span>
                  </div>
                  <span className="text-right text-[12.5px] text-fg-2 tnum">{j.dur}</span>
                  {/* Only the ops refresh can be started from the browser; the others run from the server schedule alone. */}
                  {j.run ? <Button size="xs" className="justify-self-end rounded-[7px] gap-[5px]" disabled={refreshing} title="Run now" onClick={j.run}><Play size={12} className="block" />Run</Button> : <span />}
                </div>
              );
            })}
          </div>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="px-5 py-4">
          <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Run history</h3>
          <div className="mt-[3px] text-[13px] text-muted-foreground">Ops refresh · last {data.runs.length} runs</div>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className={HEAD} style={{ gridTemplateColumns: HIST_COLS }}><span>Run</span><span>Started</span><span>Sources</span><span className="text-right">Duration</span><span>Result</span></div>
            {data.runs.map((h, i) => {
              const ok = h.ok === h.total, c = ok ? "var(--success)" : "var(--warning)";
              return (
                <div key={`${h.label}-${i}`} className="grid min-h-11 items-center gap-3.5 border-0 border-b border-solid border-border px-5 text-[13px] hover:bg-hover" style={{ gridTemplateColumns: HIST_COLS }}>
                  <span className="text-[12.5px]">{runLabel(h.label)}</span>
                  <span className="text-[12.5px] text-fg-2">{ago(h.startedAt)}</span>
                  <div className="flex items-center gap-2.5">
                    <span className="flex gap-0.5">{Array.from({ length: h.total }, (_, d) => <span key={d} className="h-3.5 w-2 rounded-[2px]" style={{ background: d < h.ok ? "var(--success)" : "var(--danger)" }} />)}</span>
                    <span className="text-[12.5px] text-muted-foreground tnum">{h.ok} of {h.total} ok</span>
                  </div>
                  <span className="text-right text-[12.5px] text-fg-2 tnum">{seconds(h.durationMs)}</span>
                  <span><Badge tone={c}>{ok ? "Success" : "Partial"}</Badge></span>
                </div>
              );
            })}
            {data.runs.length === 0 && <div className="px-5 py-8 text-center text-[13px] text-muted-foreground">No scheduled runs recorded yet.</div>}
          </div>
        </div>
      </Card>
    </Screen>
  );
}
