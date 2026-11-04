"use client";
import { useJson } from "./useJson";
import { money } from "./format";
import { DollarSign, ShieldAlert, TrendingUp, Sparkles } from "lucide-react";

interface SummaryResp {
  mtdTotal: number; last7: number; avgPerDay: number;
  projectedMonth: number | null;
  topServices: Array<{ key: string; amount: number; deltaPct: number | null }>;
  prev?: { month: string; total: number; deltaPct: number | null };
}
interface DashResp { recommendations?: { savingsMonthly: number; top: Array<{ instanceId: string; title: string }> } }
interface FindingsResp { bySeverity?: Record<string, number> }

interface Section {
  key: string; label: string; icon: React.ReactNode; chip: string;
  color: string; borderColor: string; bodyLines: string[];
}

function costStory(s: SummaryResp | null): Section {
  if (!s) {
    return {
      key: "cost", label: "Cost story", icon: <TrendingUp size={13} />, chip: "loading…",
      color: "#c4b5fd", borderColor: "rgba(192,132,252,0.35)",
      bodyLines: ["Waiting for /api/cost/summary…"],
    };
  }
  const topSvc = (s.topServices ?? [])[0];
  const totalDelta = s.prev?.deltaPct;
  const trendWord = totalDelta == null ? "steady" : totalDelta > 5 ? "up" : totalDelta < -5 ? "down" : "flat";
  const chip = trendWord === "up" ? "trending up" : trendWord === "down" ? "trending down" : "flat";
  return {
    key: "cost", label: "Cost story",
    icon: <TrendingUp size={13} />, chip,
    color: trendWord === "up" ? "#fca5a5" : trendWord === "down" ? "#6ee7b7" : "#c4b5fd",
    borderColor: trendWord === "up" ? "rgba(239,68,68,0.30)" : trendWord === "down" ? "rgba(52,211,153,0.30)" : "rgba(192,132,252,0.30)",
    bodyLines: [
      `${money(s.mtdTotal)} MTD${s.prev ? ` vs ${money(s.prev.total)} last month (${typeof totalDelta === "number" ? `${totalDelta > 0 ? "+" : ""}${totalDelta.toFixed(1)}%` : "n/a"})` : ""}.`,
      topSvc ? `${topSvc.key} is your biggest line at ${money(topSvc.amount)}${typeof topSvc.deltaPct === "number" ? ` (${topSvc.deltaPct > 0 ? "+" : ""}${topSvc.deltaPct.toFixed(1)}% vs last month)` : ""}.` : "No service-level splits yet.",
    ],
  };
}

function savingsSection(d: DashResp | null): Section {
  const savings = d?.recommendations?.savingsMonthly ?? 0;
  const top = d?.recommendations?.top ?? [];
  return {
    key: "savings", label: "Savings on the table",
    icon: <DollarSign size={13} />, chip: `${money(savings)}/mo`,
    color: "#6ee7b7", borderColor: "rgba(52,211,153,0.32)",
    bodyLines: savings > 0
      ? [
          `${money(savings)}/mo across ${top.length} instance${top.length === 1 ? "" : "s"}.`,
          top[0] ? `Top pick: ${top[0].title}.` : "",
          top[1] ? `Runner-up: ${top[1].title}.` : "",
        ].filter(Boolean)
      : ["No right-sizing wins right now — instances are appropriately sized."],
  };
}

function riskSection(f: FindingsResp | null): Section {
  const crit = f?.bySeverity?.CRIT ?? 0;
  const high = f?.bySeverity?.HIGH ?? 0;
  const total = (Object.values(f?.bySeverity ?? {}) as number[]).reduce((a, b) => a + b, 0);
  return {
    key: "risk", label: "Risk to watch",
    icon: <ShieldAlert size={13} />, chip: crit > 0 ? "patch today" : high > 0 ? "next deploy" : "clean",
    color: crit > 0 ? "#fca5a5" : high > 0 ? "#facc15" : "#6ee7b7",
    borderColor: crit > 0 ? "rgba(239,68,68,0.32)" : high > 0 ? "rgba(234,179,8,0.30)" : "rgba(52,211,153,0.28)",
    bodyLines: [
      total === 0 ? "No open findings across your scanned repos." : `${total} open finding${total === 1 ? "" : "s"} · ${crit} CRIT · ${high} HIGH.`,
      crit > 0 ? "Open a fix branch today — CRIT rules typically ship in Trivy CVEs and Gitleaks secrets." :
      high > 0 ? "Bundle these into the next dependency-bump PR." :
      "Trivy + Gitleaks scans are current per the last cron.",
    ].filter(Boolean),
  };
}

export default function FableInsights() {
  const { data: summary } = useJson<SummaryResp>("/api/cost/summary");
  const { data: dash } = useJson<DashResp>("/api/dashboard/summary");
  const { data: findings } = useJson<FindingsResp>("/api/security/findings?limit=1");

  const sections: Section[] = [
    costStory(summary ?? null),
    savingsSection(dash ?? null),
    riskSection(findings ?? null),
  ];

  return (
    <div className="panel fable-insights">
      <div className="panel-head">
        <h2><Sparkles size={14} style={{ verticalAlign: -2, marginRight: 6, color: "#c4b5fd" }} />Fable insights</h2>
        <span className="model-chip">claude-fable-5</span>
      </div>
      <div className="fable-insights-grid">
        {sections.map((s) => (
          <div key={s.key} className="fable-insight-card" style={{ borderColor: s.borderColor }}>
            <div className="fable-insight-head" style={{ color: s.color }}>
              {s.icon} {s.label}
              <span className="fable-insight-chip" style={{ background: `${s.color}22`, borderColor: s.borderColor, color: s.color }}>{s.chip}</span>
            </div>
            {s.bodyLines.map((line, i) => (
              <div key={i} className="fable-insight-line">{line}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
