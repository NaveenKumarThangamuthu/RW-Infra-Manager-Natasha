"use client";
import Link from "next/link";
import { useJson } from "./useJson";
import { money } from "./format";
import { AlertTriangle, TrendingUp, Sparkles, DollarSign, ShieldCheck } from "lucide-react";

interface Anomaly {
  resourceId: string; service: string; latestDate: string;
  amount: number; baseline: number; z: number; severity: "info" | "warn" | "crit";
}
interface AnomalyResp { anomalies: Anomaly[] }
interface DashResp {
  recommendations?: { savingsMonthly: number; top: Array<{ instanceId: string; title: string; monthlyDeltaUsd: number }> };
}
interface FindingsResp { bySeverity?: Record<string, number> }

interface Item {
  key: string; icon: React.ReactNode; kind: "cost" | "savings" | "risk";
  label: string; body: string; href: string;
}

export default function ThreeThings() {
  const { data: anomalies } = useJson<AnomalyResp>("/api/cost/anomalies");
  const { data: dash } = useJson<DashResp>("/api/dashboard/summary");
  const { data: findings } = useJson<FindingsResp>("/api/security/findings?limit=1");

  const critAnomaly = anomalies?.anomalies?.find((a) => a.severity === "crit")
    ?? anomalies?.anomalies?.find((a) => a.severity === "warn")
    ?? anomalies?.anomalies?.[0];
  const savings = dash?.recommendations?.savingsMonthly ?? 0;
  const topRec = dash?.recommendations?.top?.[0];
  const critFindings = findings?.bySeverity?.CRIT ?? 0;
  const highFindings = findings?.bySeverity?.HIGH ?? 0;

  const items: Item[] = [];

  if (critAnomaly) {
    items.push({
      key: "cost",
      kind: "cost",
      icon: <AlertTriangle size={14} />,
      label: "Cost anomaly",
      body: `${critAnomaly.service} · ${(critAnomaly.resourceId ?? "").slice(0, 20)} spiked to ${money(critAnomaly.amount)} — ${(critAnomaly.z ?? 0).toFixed(1)}σ over ${money(critAnomaly.baseline)} baseline.`,
      href: "/",
    });
  }
  if (savings > 0 && topRec) {
    items.push({
      key: "savings",
      kind: "savings",
      icon: <DollarSign size={14} />,
      label: "Savings on the table",
      body: `${money(savings)}/mo across ${dash?.recommendations?.top?.length ?? 0} instance${(dash?.recommendations?.top?.length ?? 0) === 1 ? "" : "s"}. Top pick: ${topRec.title}.`,
      href: "/perf/recommendations",
    });
  }
  if (critFindings + highFindings > 0) {
    items.push({
      key: "risk",
      kind: "risk",
      icon: <ShieldCheck size={14} />,
      label: "Risk to watch",
      body: `${critFindings} CRIT · ${highFindings} HIGH open findings across your repos. Trivy + Gitleaks scan results.`,
      href: "/security",
    });
  }

  // Fallback content when nothing surfaced yet.
  if (items.length === 0) {
    items.push({
      key: "quiet",
      kind: "savings",
      icon: <Sparkles size={14} />,
      label: "Quiet day",
      body: "No anomalies, no critical findings, no big savings picks — infra is behaving. Enjoy the calm.",
      href: "/",
    });
  }

  return (
    <div className="three-things">
      <div className="three-things-head">
        <Sparkles size={12} /> Three things to know today
        <span className="model-chip">claude-fable-5</span>
      </div>
      <div className="three-things-list">
        {items.slice(0, 3).map((it) => (
          <Link key={it.key} href={it.href} className={`three-thing three-thing-${it.kind}`}>
            <div className="three-thing-icon">{it.icon}</div>
            <div>
              <div className="three-thing-label">{it.label}</div>
              <div className="three-thing-body">{it.body}</div>
            </div>
            <TrendingUp size={12} className="three-thing-cta" />
          </Link>
        ))}
      </div>
    </div>
  );
}
