"use client";
import Link from "next/link";
import { useJson } from "./useJson";
import RecommendationsTile from "./RecommendationsTile";
import { Boxes, Sprout, Sparkle, AlertOctagon, CircleCheck, Activity } from "lucide-react";

interface Resp {
  ok: boolean;
  github: {
    activeRepos: number;
    archivedRepos: number;
    lastSyncAt: string | null;
    findings: { total: number; CRIT: number; HIGH: number; MED: number; LOW: number; INFO: number };
    scans: { last24h: number; open: number; lastAt: string | null; lastRepo: string | null; lastStatus: string | null };
  };
  spring: {
    total: number; down: number; highHeap: number;
    servicesWithErrors: number; totalErrors1h: number;
    lastHealthSnap: string | null; lastLogsSnap: string | null;
  };
  lambda: { total: number; invocations24h: number; errors24h: number; lastSnap: string | null };
  recommendations?: {
    total: number;
    monthlySavingsUsd: number;
    top: Array<{ instanceId: string; name?: string; message: string; monthlyDeltaUsd: number }>;
    lastSnap: string | null;
  };
}

const NUM = new Intl.NumberFormat("en-US");

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function compact(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + "k";
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1) + "M";
}

function HealthPulse({ data }: { data: Resp }) {
  const issues: Array<{ sev: "crit" | "warn"; label: string }> = [];
  if (data.github.findings.CRIT > 0) issues.push({ sev: "crit", label: `${data.github.findings.CRIT} CRIT findings` });
  if (data.github.findings.HIGH > 0) issues.push({ sev: "warn", label: `${data.github.findings.HIGH} HIGH findings` });
  if (data.spring.down > 0) issues.push({ sev: "crit", label: `${data.spring.down} services down` });
  if (data.spring.servicesWithErrors > 0) issues.push({ sev: "warn", label: `${data.spring.servicesWithErrors} services with errors` });
  if (data.lambda.errors24h > 0) issues.push({ sev: "warn", label: `${data.lambda.errors24h} Lambda errors (24h)` });

  const hasCrit = issues.some((i) => i.sev === "crit");
  const status: "good" | "warn" | "crit" = hasCrit ? "crit" : issues.length > 0 ? "warn" : "good";
  const dotCls = status === "good" ? "good" : status === "warn" ? "warn" : "crit";
  const label = status === "good" ? "All systems nominal" : status === "warn" ? "Attention needed" : "Critical attention needed";
  const Icon = status === "good" ? CircleCheck : status === "warn" ? Activity : AlertOctagon;

  return (
    <div className={`health-pulse ${status}`}>
      <span className={`pulse-dot ${dotCls}`} />
      <span className="pulse-icon"><Icon size={15} /></span>
      <span className="pulse-label">{label}</span>
      {issues.length > 0 && (
        <span className="pulse-issues">
          {issues.slice(0, 3).map((i, k) => (
            <span key={k} className={`pulse-chip ${i.sev}`}>{i.label}</span>
          ))}
          {issues.length > 3 && <span className="pulse-chip muted">+{issues.length - 3} more</span>}
        </span>
      )}
    </div>
  );
}

export default function InfraOverviewTiles() {
  const { data, error, loading } = useJson<Resp>("/api/dashboard/summary");
  if (loading && !data) return <div className="infra-tiles-skel" />;
  if (error || !data) return null;

  const { github, spring, lambda, recommendations } = data;
  const ghCrit = github.findings.CRIT;

  return (
    <>
      <HealthPulse data={data} />

      <div className="infra-tiles">
        <Link href="/security" className={`infra-tile gh ${ghCrit > 0 ? "alert" : ""}`} aria-label="GitHub Security">
          <div className="tile-head">
            <span className="tile-ico" aria-hidden><Boxes size={17} /></span>
            <span className="tile-title">GitHub Security</span>
            <span className="tile-go" aria-hidden>↗</span>
          </div>
          <div className="tile-primary">
            <span className="big tab-num">{NUM.format(github.activeRepos)}</span>
            <span className="muted small">active repos</span>
          </div>
          <div className="tile-row">
            <div className="metric">
              <span className="metric-label">CRIT</span>
              <span className="metric-val tab-num" style={{ color: ghCrit ? "#ef4444" : "#34d399" }}>{NUM.format(ghCrit)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">HIGH</span>
              <span className="metric-val tab-num" style={{ color: github.findings.HIGH ? "#f97316" : "#34d399" }}>{NUM.format(github.findings.HIGH)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">MED</span>
              <span className="metric-val tab-num" style={{ color: github.findings.MED ? "#f59e0b" : "#34d399" }}>{NUM.format(github.findings.MED)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Findings</span>
              <span className="metric-val tab-num">{compact(github.findings.total)}</span>
            </div>
          </div>
          <div className="tile-foot">
            <span>{github.scans.last24h} scan{github.scans.last24h === 1 ? "" : "s"} (24h){github.scans.open ? ` · ${github.scans.open} open` : ""}</span>
            <span className="muted">Synced {relTime(github.lastSyncAt)}</span>
          </div>
        </Link>

        <Link href="/perf/spring" className={`infra-tile sp ${spring.down > 0 ? "alert" : spring.servicesWithErrors > 0 ? "warn" : ""}`} aria-label="Spring Services">
          <div className="tile-head">
            <span className="tile-ico" aria-hidden><Sprout size={17} /></span>
            <span className="tile-title">Spring Services</span>
            <span className="tile-go" aria-hidden>↗</span>
          </div>
          <div className="tile-primary">
            <span className="big tab-num">{NUM.format(spring.total)}</span>
            <span className="muted small">total services</span>
          </div>
          <div className="tile-row">
            <div className="metric">
              <span className="metric-label">Down</span>
              <span className="metric-val tab-num" style={{ color: spring.down ? "#ef4444" : "#34d399" }}>{spring.down}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Heap &gt; 85%</span>
              <span className="metric-val tab-num" style={{ color: spring.highHeap ? "#f59e0b" : "#34d399" }}>{spring.highHeap}</span>
            </div>
            <div className="metric">
              <span className="metric-label">w/ Errors</span>
              <span className="metric-val tab-num" style={{ color: spring.servicesWithErrors ? "#ef4444" : "#34d399" }}>{spring.servicesWithErrors}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Errors (1h)</span>
              <span className="metric-val tab-num" style={{ color: spring.totalErrors1h ? "#ef4444" : "#34d399" }}>{compact(spring.totalErrors1h)}</span>
            </div>
          </div>
          <div className="tile-foot">
            <span>Prometheus + ELK</span>
            <span className="muted">Snap {relTime(spring.lastLogsSnap ?? spring.lastHealthSnap)}</span>
          </div>
        </Link>

        <Link href="/perf/spring" className={`infra-tile lm ${lambda.errors24h > 0 ? "warn" : ""}`} aria-label="Lambda Ohio">
          <div className="tile-head">
            <span className="tile-ico" aria-hidden><Sparkle size={17} /></span>
            <span className="tile-title">Lambda <span className="muted region">us-east-2</span></span>
            <span className="tile-go" aria-hidden>↗</span>
          </div>
          <div className="tile-primary">
            <span className="big tab-num">{NUM.format(lambda.total)}</span>
            <span className="muted small">functions</span>
          </div>
          <div className="tile-row">
            <div className="metric">
              <span className="metric-label">Invocations (24h)</span>
              <span className="metric-val tab-num">{compact(lambda.invocations24h)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Errors (24h)</span>
              <span className="metric-val tab-num" style={{ color: lambda.errors24h ? "#ef4444" : "#34d399" }}>{NUM.format(lambda.errors24h)}</span>
            </div>
          </div>
          <div className="tile-foot">
            <span>Ohio · CloudWatch</span>
            <span className="muted">Snap {relTime(lambda.lastSnap)}</span>
          </div>
        </Link>


        {recommendations && (
          <RecommendationsTile
            total={recommendations.total}
            monthlySavingsUsd={recommendations.monthlySavingsUsd}
            top={recommendations.top}
            lastSnap={recommendations.lastSnap}
          />
        )}
      </div>
    </>
  );
}
