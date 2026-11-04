"use client";
import { useJson } from "@/components/useJson";
import {
  Cloud, GitBranch, Sparkles, Send, Volume2, Activity, Search, BarChart3, Calendar, Radio,
  type LucideIcon,
} from "lucide-react";

interface RepoStatus { connected: boolean }
interface DashStatus { ops?: { cronLastRunAt?: string | null } }

type Provider = {
  key: string;
  name: string;
  Icon: LucideIcon;
  color: string;
  category: "AI" | "Cloud" | "VCS" | "Messaging" | "Monitoring" | "Voice" | "Calendar";
  desc: string;
  scopes: string[];
  status: "live" | "optional" | "planned" | "checking";
  detail?: string;
};

function niceTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true });
}

export default function IntegrationsPage() {
  const { data: repos } = useJson<RepoStatus>("/api/security/repos");
  const { data: dash } = useJson<DashStatus>("/api/dashboard/summary");

  const providers: Provider[] = [
    {
      key: "aws",
      name: "AWS",
      Icon: Cloud, color: "#f59e0b", category: "Cloud",
      desc: "Cost Explorer · EC2 · Lambda · SNS · CloudWatch — read-only access via IAM role.",
      scopes: ["ce:GetCostAndUsage", "ec2:Describe*", "lambda:List*", "sns:List*", "cloudwatch:Get*"],
      status: "live",
      detail: `Cron last ran ${niceTime(dash?.ops?.cronLastRunAt)}`,
    },
    {
      key: "github",
      name: "GitHub",
      Icon: GitBranch, color: "#c4b5fd", category: "VCS",
      desc: "OAuth token vault (AES-256-GCM). Repo sync + per-repo Trivy + Gitleaks scans.",
      scopes: ["repo", "read:user", "read:org"],
      status: repos ? (repos.connected ? "live" : "planned") : "checking",
      detail: repos?.connected ? "Connected · webhook active" : "Not connected — connect from /security",
    },
    {
      key: "anthropic",
      name: "Anthropic · Fable",
      Icon: Sparkles, color: "#a78bfa", category: "AI",
      desc: "claude-fable-5 for Daily Brief, Spring log diagnosis, and every Fable-branded card.",
      scopes: ["Messages API", "Structured outputs"],
      status: "live",
      detail: "Model: claude-fable-5",
    },
    {
      key: "telegram",
      name: "Telegram",
      Icon: Send, color: "#38bdf8", category: "Messaging",
      desc: "Anomaly alerts + cron summaries into your Infra topic. Silent when nothing interesting happened.",
      scopes: ["sendMessage", "sendDocument"],
      status: "live",
      detail: "Chat -1004104213995 · thread 61",
    },
    {
      key: "elevenlabs",
      name: "ElevenLabs",
      Icon: Volume2, color: "#f472b6", category: "Voice",
      desc: "Premium TTS. Off until ELEVENLABS_API_KEY is set. Deterministic template narration otherwise.",
      scopes: ["text-to-speech", "voices/list"],
      status: "optional",
      detail: "Optional — voice modulation for briefings",
    },
    {
      key: "prometheus",
      name: "Prometheus",
      Icon: Activity, color: "#ef4444", category: "Monitoring",
      desc: "Rule-based alerts + CPU/memory/heap collection for Spring services. Feeds Health Pulse.",
      scopes: ["/api/v1/alerts", "/api/v1/query"],
      status: "live",
      detail: "prometheus.rwdomain.com",
    },
    {
      key: "elk",
      name: "ELK · Elasticsearch",
      Icon: Search, color: "#34d399", category: "Monitoring",
      desc: "logs-tcp-default* index for Spring ERROR log extraction and pattern dedup. Read-only viewer.",
      scopes: ["indices:data/read/search"],
      status: "live",
      detail: "RW-DEV cluster · viewer role",
    },
    {
      key: "cloudwatch",
      name: "CloudWatch",
      Icon: BarChart3, color: "#38bdf8", category: "Monitoring",
      desc: "EC2 metric snapshots + Lambda invocation logs. Alarm feed powers the Incidents view.",
      scopes: ["cloudwatch:GetMetric*", "logs:FilterLogEvents"],
      status: "live",
      detail: "Cross-region · US primary",
    },
    {
      key: "loki",
      name: "Grafana Loki",
      Icon: Radio, color: "#06b6d4", category: "Monitoring",
      desc: "Live-tail log stream via LogQL. Powers /openas2 (EDI logs) and Spring service tail. Read-only HTTP GET.",
      scopes: ["query_range", "labels", "label values"],
      status: "live",
      detail: "jobs: openas2 · rw_services",
    },
    {
      key: "google-calendar",
      name: "Google Calendar",
      Icon: Calendar, color: "#94a3b8", category: "Calendar",
      desc: "Not wired yet. Reserved for a future \"CEO briefing hooks into today's meetings\" flow.",
      scopes: ["calendar.readonly"],
      status: "planned",
      detail: "Planned — not enabled",
    },
  ];

  const grouped = providers.reduce<Record<Provider["category"], Provider[]>>((acc, p) => {
    (acc[p.category] = acc[p.category] || []).push(p); return acc;
  }, {} as Record<Provider["category"], Provider[]>);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Integrations</h1>
          <p className="page-sub">Every external service Natasha talks to. Live status, scopes, and where credentials live.</p>
        </div>
      </div>

      {(Object.keys(grouped) as Array<Provider["category"]>).map((cat) => (
        <div key={cat} className="integrations-section">
          <h2 className="integrations-section-title">{cat}</h2>
          <div className="integrations-grid">
            {grouped[cat].map((p) => {
              const Icon = p.Icon;
              return (
                <div key={p.key} className={`integration-card integration-${p.status}`} style={{ borderColor: `${p.color}30` }}>
                  <div className="integration-head">
                    <div className="integration-ico" style={{ background: `${p.color}22`, color: p.color }}>
                      <Icon size={20} strokeWidth={1.75} />
                    </div>
                    <div>
                      <div className="integration-name">{p.name}</div>
                      <div className={`integration-status integration-status-${p.status}`}>
                        {p.status === "live" ? "● live" :
                         p.status === "optional" ? "○ optional" :
                         p.status === "checking" ? "◐ checking…" : "◌ planned"}
                      </div>
                    </div>
                  </div>
                  <div className="integration-desc">{p.desc}</div>
                  <div className="integration-scopes">
                    <span className="integration-scopes-label">Scopes:</span>
                    {p.scopes.map((s) => <span key={s} className="integration-scope">{s}</span>)}
                  </div>
                  {p.detail && <div className="integration-detail">{p.detail}</div>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
