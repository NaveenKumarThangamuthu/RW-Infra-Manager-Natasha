"use client";
import { Fragment, useMemo, useState } from "react";
import { ChevronRight, ExternalLink, FileText, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { ago, isStale, istDate, istDateTime } from "@/components/natasha/format";
import { Banner, Dot, ErrorNote, PageHeader, Screen, ScreenSkeleton, StatStrip } from "@/components/natasha/primitives";
import { useShell } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { cn, tint } from "@/lib/utils";

type Sev = "BLOCKER" | "CRITICAL" | "MAJOR" | "MINOR" | "INFO";
interface Service {
  repo: string; branch: string; sonarProject: string | null; gate: string | null; lastAnalysis: string | null;
  health: { key: "good" | "fair" | "poor" | "critical" | "unknown"; label: string };
  measures: Record<string, string> | null; severityBreakdown: Partial<Record<Sev, number>> | null;
  topIssues?: Array<{ severity: string; message: string; component: string; line?: number | null }> | null;
}
interface DataResp { hasData: boolean; generatedAt?: string; scope?: string; totals?: { bugs: number; vulns: number; hotspots: number; smells: number; ncloc: number; scanned: number; notScanned: number }; healthDistribution?: Record<string, number>; services?: Service[]; error?: string }
interface LatestResp { hasReport: boolean; generatedAt?: string; productionHtml?: string; productionPdf?: string }
type Filter = "all" | "risk" | "scanned" | "none";

const COLS = "16px 82px minmax(200px,1.6fr) 66px 56px 56px 48px 48px 64px 56px 68px 64px 76px";
const SNAPSHOT_STALE_MINUTES = 2 * 24 * 60;
const TOP_ISSUES = 5;
// SonarQube writes "+0000"; browsers want "+00:00".
const analysed = (v: string | null) => (v ? istDate(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : null);
// The internal SonarQube host: reachable only from the office network, as in the previous screen.
const SONAR_BASE = "http://192.168.16.202:9000";
const HEALTH: Record<string, { label: string; color: string }> = {
  critical: { label: "Urgent", color: "var(--danger)" }, poor: { label: "High risk", color: "var(--orange)" }, fair: { label: "Some risk", color: "var(--warning)" },
  good: { label: "Healthy", color: "var(--success)" }, unknown: { label: "Not scanned", color: "var(--muted-fg)" },
};
const HEALTH_RANK: Record<string, number> = { critical: 0, poor: 1, fair: 2, good: 3, unknown: 4 };
const GRADE: Record<string, string> = { A: "var(--success)", B: "color-mix(in oklab, var(--success) 55%, var(--warning))", C: "var(--warning)", D: "var(--orange)", E: "var(--danger)" };
const GLOSSARY: Array<[string, string]> = [
  ["Bugs", "Defects that will misbehave at runtime (crashes, wrong results). Real risk to customers."],
  ["Vulnerabilities", "Security weaknesses. Attackers could exploit these to compromise data or the service."],
  ["Security hotspots", "Sensitive code (auth, secrets, crypto). Needs a human security review — not necessarily broken."],
  ["Code smells", "Maintainability issues. Slow the team down over time; don't break anything today."],
  ["Quality gate", "Sonar's pass/fail verdict on the last analysis. Fail = one of the team's thresholds was breached."],
  ["Lines of code (NCLOC)", "Real source lines; blank lines and comments excluded. A measure of how big the codebase is."],
  ["Coverage", "Share of code exercised by automated tests. Higher = safer to change."],
  ["Ratings (A → E)", "Sonar's 5-grade scale: A clean, E many issues. Shown as Reliability · Security · Maintainability."],
];
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const fmt = (v: unknown) => n(v).toLocaleString("en-US");
const grade = (v: unknown) => (v == null || v === "" ? null : ({ 1: "A", 2: "B", 3: "C", 4: "D", 5: "E" } as Record<number, string>)[Math.round(Number(v))] ?? null);
const millions = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));

export default function Sonar() {
  const { toast } = useShell();
  const { data, error, reload } = useJson<DataResp>("/api/sonar/data");
  const { data: latest, reload: reloadLatest } = useJson<LatestResp>("/api/sonar/latest");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const services = useMemo(() => [...(data?.services ?? [])].sort((a, b) => HEALTH_RANK[a.health.key] - HEALTH_RANK[b.health.key] || n(b.measures?.bugs) - n(a.measures?.bugs)), [data]);
  const matches = (s: Service, f: Filter) => f === "all" || (f === "risk" && (s.health.key === "critical" || s.health.key === "poor")) || (f === "scanned" && !!s.sonarProject) || (f === "none" && !s.sonarProject);
  const needle = q.trim().toLowerCase();
  const list = services.filter((s) => matches(s, filter) && (!needle || `${s.repo} ${s.branch}`.toLowerCase().includes(needle)));

  const rescan = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/sonar/refresh", { method: "POST" });
      const j = await r.json();
      toast(j.ok ? `Sonar snapshot refreshed in ${(j.ranMs / 1000).toFixed(1)}s` : j.error || `Refresh failed (exit ${j.scriptExit})`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      reload();
      reloadLatest();
    }
  };

  const generated = data?.generatedAt;
  const stale = !!generated && isStale(generated, SNAPSHOT_STALE_MINUTES);
  const header = (
    <PageHeader title="Sonar Quality"
      description={generated ? <>SonarQube{data?.scope ? ` · ${data.scope}` : ""} · <span style={stale ? { color: "var(--warning)" } : undefined}>snapshot taken {istDateTime(generated)} ({ago(generated)})</span></> : "SonarQube"}
      actions={<>
        {latest?.productionPdf && <Button asChild size="lg"><a href={latest.productionPdf} target="_blank" rel="noopener noreferrer" className="no-underline"><FileText size={14} className="block" />PDF report</a></Button>}
        {latest?.productionHtml && <Button asChild size="lg"><a href={latest.productionHtml} target="_blank" rel="noopener noreferrer" className="no-underline"><ExternalLink size={14} className="block" />Full HTML view</a></Button>}
        <Button variant="primary" size="lg" className="px-3.5" disabled={busy} onClick={() => void rescan()}><RefreshCw size={14} className={cn("block", busy && "animate-nt-spin")} />{busy ? "Refreshing…" : "Refresh now"}</Button>
      </>} />
  );
  if (error) return <Screen label="Sonar Quality">{header}<ErrorNote message={error} onRetry={reload} /></Screen>;
  if (!data) return <ScreenSkeleton />;
  if (!data.hasData) return <Screen label="Sonar Quality">{header}<Card className="px-5 py-12 text-center text-[13px] text-muted-foreground">{data.error ?? "No Sonar snapshot yet. Run a refresh to pull the first one."}</Card></Screen>;

  const t = data.totals ?? { bugs: 0, vulns: 0, hotspots: 0, smells: 0, ncloc: 0, scanned: 0, notScanned: 0 };
  const h = data.healthDistribution ?? {};
  const total = t.scanned + t.notScanned;
  const wid = (v: number) => `${total ? (v / total) * 100 : 0}%`;
  const noCoverage = services.filter((s) => s.sonarProject).every((s) => n(s.measures?.coverage) === 0);
  const bar: Array<[string, number, string]> = [["Urgent", n(h.critical), "var(--danger)"], ["High risk", n(h.poor), "var(--orange)"], ["Some risk", n(h.fair), "var(--warning)"], ["Healthy", n(h.good), "var(--success)"]];

  return (
    <Screen label="Sonar Quality">
      {header}
      {stale && <Banner tone="var(--warning)">This snapshot was taken {ago(generated)}, so the figures may have changed since. Each service also shows the date SonarQube last analysed it.</Banner>}
      <Card className="flex flex-col gap-3.5 px-5 py-[18px]">
        <div>
          <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Service health</h3>
          <div className="mt-[3px] text-[13px] text-muted-foreground">{total} services · {t.scanned} scanned ({total ? Math.round((t.scanned / total) * 100) : 0}%) · {t.notScanned} not yet enrolled</div>
        </div>
        <div className="flex h-2.5 gap-[3px] overflow-hidden rounded-[10px]">
          {bar.filter((b) => b[1] > 0).map(([l, v, c]) => <span key={l} style={{ width: wid(v), background: c }} />)}
          <span className="flex-1 bg-card-2" />
        </div>
        <div className="flex flex-wrap gap-[18px] text-[12.5px] text-fg-2 tnum">
          {bar.map(([l, v, c]) => <span key={l} className="inline-flex items-center gap-[7px]"><span className="h-2 w-2 rounded-[2px]" style={{ background: c }} />{l} <span className="font-semibold">{v}</span></span>)}
          <span className="inline-flex items-center gap-[7px]"><span className="h-2 w-2 rounded-[2px] bg-card-2 shadow-[inset_0_0_0_1px_var(--border-strong)]" />Not scanned <span className="font-semibold">{t.notScanned}</span></span>
        </div>
      </Card>
      <StatStrip items={[
        { label: "Bugs", value: fmt(t.bugs), color: t.bugs ? "var(--danger)" : "var(--success)", sub: "Runtime defects" },
        { label: "Vulnerabilities", value: fmt(t.vulns), color: t.vulns ? "var(--danger)" : undefined, sub: "Known weaknesses" },
        { label: "Security hotspots", value: fmt(t.hotspots), color: t.hotspots ? "var(--warning)" : "var(--success)", sub: "Need review" },
        { label: "Code smells", value: fmt(t.smells), sub: "Maintainability issues" },
        { label: "Lines of code", value: millions(t.ncloc), sub: `${fmt(t.ncloc)} source lines` },
      ]} />
      <Card className="overflow-hidden">
        <div className="px-5 pb-3 pt-4">
          <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Service-by-service breakdown</h3>
          <div className="mt-[3px] text-[13px] text-muted-foreground">Urgent means blocker or critical issues are open, even when the quality gate passed · open a row for the rest of its issues</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-5 pb-3.5">
          <SearchInput wrapperClassName="min-w-[200px] flex-[0_1_280px]" placeholder="Filter services…" value={q} onChange={(e) => setQ(e.target.value)} />
          {([["all", "All"], ["risk", "At risk"], ["scanned", "Scanned"], ["none", "Not scanned"]] as Array<[Filter, string]>).map(([f, label]) => {
            const on = filter === f;
            return (
              <button key={f} type="button" aria-pressed={on} onClick={() => setFilter(f)} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-solid px-2.5 text-[12.5px] font-medium text-fg-2 hover:border-border-strong"
                style={{ borderColor: on ? "color-mix(in oklab, var(--fg) 45%, transparent)" : "var(--border)", background: on ? tint("var(--fg)", 12) : "transparent" }}>
                {label}<span className="text-muted-foreground tnum">{services.filter((s) => matches(s, f)).length}</span>
              </button>
            );
          })}
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[1084px]">
            <div className="grid h-[38px] items-center gap-3 border-0 border-y border-solid border-border bg-card-2 px-5 text-[12px] font-medium text-muted-foreground" style={{ gridTemplateColumns: COLS }}>
              <span /><span>Health</span><span>Service</span><span>Gate</span>
              {["Blocker", "Critical", "Bugs", "Vulns", "Hotspots", "Smells", "Coverage", "LOC"].map((c) => <span key={c} className="text-right">{c}</span>)}
              <span>Ratings</span>
            </div>
            {list.map((s) => {
              const key = `${s.repo}@${s.branch}`;
              const isOpen = !!open[key];
              const m = s.measures ?? {};
              const hl = HEALTH[s.health.key] ?? HEALTH.unknown;
              const blocker = n(s.severityBreakdown?.BLOCKER), critical = n(s.severityBreakdown?.CRITICAL);
              const scanned = !!s.sonarProject;
              const gateOk = (s.gate ?? "").toUpperCase() === "OK" || (s.gate ?? "").toLowerCase() === "passed";
              const gateColor = gateOk ? "var(--success)" : "var(--danger)";
              const toggle = () => { if (scanned) setOpen((o) => ({ ...o, [key]: !isOpen })); };
              const urgentWhy = s.health.key === "critical" ? `${blocker} blocker and ${fmt(critical)} critical issues open` : undefined;
              const ratings = [["Reliability", grade(m.reliability_rating)], ["Security", grade(m.security_rating)], ["Maintainability", grade(m.sqale_rating)]] as const;
              return (
                <Fragment key={key}>
                  <div role={scanned ? "button" : undefined} tabIndex={scanned ? 0 : undefined} onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter") toggle(); }}
                    className={cn("grid min-h-[52px] items-center gap-3 border-0 border-b border-solid border-border px-5 py-1.5 text-[13px] hover:bg-hover", scanned && "cursor-pointer", isOpen && "bg-hover", !scanned && "opacity-60")} style={{ gridTemplateColumns: COLS }}>
                    <span className={cn("text-muted-foreground transition-transform duration-150", isOpen && "rotate-90")}>{scanned && <ChevronRight size={14} className="block" />}</span>
                    <span title={urgentWhy}><Badge className="gap-[5px] whitespace-nowrap border-none" style={{ color: hl.color, background: scanned ? tint(hl.color) : "var(--card-2)" }}><Dot color={hl.color} />{hl.label}</Badge></span>
                    <div className="min-w-0"><div className="truncate font-medium">{s.repo}</div><div className="mt-0.5 truncate text-[11.5px] text-muted-foreground"><span className="font-mono">{s.branch}</span>{analysed(s.lastAnalysis) && ` · analysed ${analysed(s.lastAnalysis)}`}</div></div>
                    <span>{scanned && s.gate ? <Badge tone={gateColor}>{gateOk ? "Passed" : "Failed"}</Badge> : <span className="text-subtle">—</span>}</span>
                    {scanned ? (
                      <>
                        <span className="text-right tnum" style={{ fontWeight: blocker ? 600 : 400, color: blocker ? "var(--danger)" : "var(--subtle-fg)" }}>{blocker}</span>
                        <span className="text-right tnum" style={{ fontWeight: critical ? 600 : 400, color: critical ? "var(--danger)" : "var(--subtle-fg)" }}>{fmt(critical)}</span>
                        <span className="text-right tnum">{fmt(m.bugs)}</span>
                        <span className="text-right tnum" style={{ color: n(m.vulnerabilities) ? "var(--danger)" : "var(--subtle-fg)" }}>{fmt(m.vulnerabilities)}</span>
                        <span className="text-right tnum">{fmt(m.security_hotspots)}</span>
                        <span className="text-right tnum">{fmt(m.code_smells)}</span>
                        <span className="text-right text-muted-foreground tnum" title={noCoverage ? "Test coverage is not reported to SonarQube" : undefined}>{!noCoverage && m.coverage != null && m.coverage !== "" ? `${n(m.coverage).toFixed(1)}%` : "—"}</span>
                        <span className="text-right text-fg-2 tnum">{fmt(m.ncloc)}</span>
                        <span className="flex gap-[3px]">
                          {ratings.map(([label, g]) => g
                            ? <span key={label} title={`${label} ${g}`} className="grid h-5 w-5 place-items-center rounded-[5px] text-[11px] font-bold text-white" style={{ background: GRADE[g] }}>{g}</span>
                            : <span key={label} title={`${label} unknown`} className="grid h-5 w-5 place-items-center rounded-[5px] bg-card-2 text-[11px] text-muted-foreground">—</span>)}
                        </span>
                      </>
                    ) : <span className="text-[12.5px] text-muted-foreground" style={{ gridColumn: "span 9" }}>Not yet enrolled in SonarQube</span>}
                  </div>
                  {isOpen && (
                    <div className="flex flex-col gap-3 border-0 border-b border-solid border-border bg-hover pb-4 pl-[50px] pr-5 pt-3">
                      <div className="flex flex-wrap items-center gap-2.5">
                        {([["Major", n(s.severityBreakdown?.MAJOR), "var(--warning)"], ["Minor", n(s.severityBreakdown?.MINOR), "var(--info)"], ["Info", n(s.severityBreakdown?.INFO), "var(--muted-fg)"]] as const).map(([l, v, c]) => (
                          <span key={l} className="inline-flex h-[30px] items-center gap-2 rounded-[8px] border border-solid border-border bg-card px-2.5 text-[12.5px]"><Dot color={c} size={7} />{l} issues<span className="font-semibold tnum">{fmt(v)}</span></span>
                        ))}
                        {m.duplicated_lines_density != null && <span className="inline-flex h-[30px] items-center gap-2 rounded-[8px] border border-solid border-border bg-card px-2.5 text-[12.5px]">Duplicated lines<span className="font-semibold tnum">{n(m.duplicated_lines_density).toFixed(1)}%</span></span>}
                        <Button asChild size="sm" className="ml-auto px-2.5 text-[12.5px]">
                          <a href={`${SONAR_BASE}/dashboard?id=${encodeURIComponent(s.sonarProject!)}`} target="_blank" rel="noopener noreferrer" className="no-underline" title="Opens only from the office network"><ExternalLink size={12} className="block" />Open in SonarQube (office network)</a>
                        </Button>
                      </div>
                      {(s.topIssues ?? []).length > 0 && (
                        <div className="overflow-hidden rounded-[10px] border border-solid border-border bg-card">
                          <div className="border-0 border-b border-solid border-border px-3.5 py-2.5 text-[12.5px] font-semibold">Most severe open issues</div>
                          {(s.topIssues ?? []).slice(0, TOP_ISSUES).map((issue, i) => (
                            <div key={i} className="grid grid-cols-[70px_minmax(0,1.4fr)_minmax(0,1fr)] items-center gap-2.5 border-0 border-b border-solid border-border px-3.5 py-2 text-[12.5px] last:border-b-0">
                              <span className="font-medium capitalize" style={{ color: issue.severity === "BLOCKER" ? "var(--danger)" : "var(--orange)" }}>{issue.severity.toLowerCase()}</span>
                              <span className="truncate" title={issue.message}>{issue.message}</span>
                              <span className="truncate font-mono text-[11.5px] text-muted-foreground" title={issue.component}>{issue.component.split("/").pop()}{issue.line ? `:${issue.line}` : ""}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </Fragment>
              );
            })}
            {list.length === 0 && <div className="px-5 py-11 text-center text-[13px] text-muted-foreground">{q ? `No services match “${q}”.` : "No services in this view."}</div>}
          </div>
        </div>
        <div className="px-5 pb-3.5 pt-3 text-[12.5px] text-muted-foreground tnum">Showing {list.length} of {services.length} services</div>
      </Card>
      <Card>
        <div className="px-5 pb-1.5 pt-[18px]"><h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">What the metrics mean</h3></div>
        <div className="grid grid-cols-[repeat(var(--k4,4),minmax(0,1fr))] gap-3 px-5 pb-5 pt-3">
          {GLOSSARY.map(([title, body]) => (
            <div key={title} className="min-w-0 rounded-[10px] border border-solid border-border bg-background p-3.5">
              <div className="text-[13px] font-semibold">{title}</div>
              <div className="mt-1 text-[12.5px] leading-[1.5] text-muted-foreground">{body}</div>
            </div>
          ))}
        </div>
      </Card>
      <div className="text-[12px] text-muted-foreground">Prepared by Natasha Infra Manager · Data pulled directly from the internal SonarQube server · Confidential · For internal stakeholder review only.</div>
    </Screen>
  );
}
