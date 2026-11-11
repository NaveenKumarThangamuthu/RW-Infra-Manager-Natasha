"use client";
import { useState } from "react";
import Link from "next/link";
import { Activity, BarChart3, Calendar, Cloud, GitBranch, Info, KeyRound, Radio, Search, Send, Volume2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Dot, PageHeader, Screen } from "@/components/natasha/primitives";
import { useJson } from "@/components/useJson";
import { tint } from "@/lib/utils";

type Status = "live" | "planned" | "optional";
interface Provider { name: string; icon: LucideIcon; status: Status; desc: string; scopes: string[]; meta: string; color: string; href: string }

const STATUS: Record<Status, { label: string; color: string }> = {
  live: { label: "Live", color: "var(--success)" },
  planned: { label: "Planned", color: "var(--muted-fg)" },
  optional: { label: "Optional", color: "var(--warning)" },
};

export default function Integrations() {
  const { data: repos } = useJson<{ connected?: boolean }>("/api/security/repos");
  const [filter, setFilter] = useState<Status | "all">("all");
  const connected = !!repos?.connected;

  const groups: Array<[string, Provider[]]> = [
    ["Cloud", [{ name: "AWS", icon: Cloud, status: "live", desc: "Cost Explorer · EC2 · Lambda · SNS · CloudWatch — read-only access via IAM role.", scopes: ["ce:GetCostAndUsage", "ec2:Describe*", "lambda:List*", "sns:List*", "cloudwatch:Get*"], meta: "IAM role · read-only", color: "var(--orange)", href: "/settings#secrets" }]],
    ["Source code", [{ name: "GitHub", icon: GitBranch, status: connected ? "live" : "planned", desc: "OAuth token vault (AES-256-GCM). Repo sync + per-repo Trivy + Gitleaks scans.", scopes: ["repo", "read:user", "read:org"], meta: connected ? "Connected · webhook active" : "Not connected — connect from Repositories", color: "var(--fg-2)", href: connected ? "/security" : "/security/connect" }]],
    ["Messaging", [{ name: "Telegram", icon: Send, status: "live", desc: "Anomaly alerts + cron summaries into your Infra topic. Silent when nothing interesting happened.", scopes: ["sendMessage", "sendDocument"], meta: "Infra topic · thread 61", color: "var(--info)", href: "/settings#secrets" }]],
    ["Voice", [{ name: "ElevenLabs", icon: Volume2, status: "optional", desc: "Premium TTS. Off until ELEVENLABS_API_KEY is set. Deterministic template narration otherwise.", scopes: ["text-to-speech", "voices/list"], meta: "Optional — voice for briefings", color: "var(--cdev)", href: "/settings#secrets" }]],
    ["Monitoring", [
      { name: "Prometheus", icon: Activity, status: "live", desc: "Rule-based alerts + CPU/memory/heap collection for Spring services. Feeds Health Pulse.", scopes: ["/api/v1/alerts", "/api/v1/query"], meta: "prometheus.rwdomain.com", color: "var(--danger)", href: "/settings#secrets" },
      { name: "ELK · Elasticsearch", icon: Search, status: "live", desc: "logs-tcp-default* index for Spring ERROR log extraction and pattern dedup. Read-only viewer.", scopes: ["indices:data/read/search"], meta: "RW-DEV cluster · viewer role", color: "var(--cshared)", href: "/settings#secrets" },
      { name: "CloudWatch", icon: BarChart3, status: "live", desc: "EC2 metric snapshots + Lambda invocation logs. Alarm feed powers the Incidents view.", scopes: ["cloudwatch:GetMetric*", "logs:FilterLogEvents"], meta: "Cross-region · US primary", color: "var(--c20)", href: "/settings#secrets" },
      { name: "Grafana Loki", icon: Radio, status: "live", desc: "Live-tail log stream via LogQL. Powers OpenAS2 (EDI logs) and Spring service tail. Read-only HTTP GET.", scopes: ["query_range", "labels", "label values"], meta: "Jobs: openas2 · rw_services", color: "var(--cinfra)", href: "/settings#secrets" },
    ]],
    ["Calendar", [{ name: "Google Calendar", icon: Calendar, status: "planned", desc: "Not wired yet. Reserved for a future briefing that hooks into today’s meetings.", scopes: ["calendar.readonly"], meta: "Planned — not enabled", color: "var(--fg-2)", href: "" }]],
  ];
  const all = groups.flatMap((g) => g[1]);
  const count = (k: Status | "all") => all.filter((x) => k === "all" || x.status === k).length;

  return (
    <Screen label="Integrations">
      <PageHeader title="Integrations" description="Every external service Natasha talks to. Live status, scopes, and where credentials live."
        actions={<Segmented size="md" value={filter} onChange={setFilter} aria-label="Status" options={(["all", "live", "planned", "optional"] as const).map((k) => ({ value: k, label: k === "all" ? "All" : STATUS[k].label, count: count(k) }))} />} />
      <Card className="overflow-hidden">
        {groups.map(([label, items]) => {
          const shown = items.filter((x) => filter === "all" || x.status === filter);
          if (!shown.length) return null;
          return (
            <div key={label}>
              <div className="-mt-px flex h-9 items-center gap-2 border-0 border-t border-solid border-border bg-card-2 px-5 text-[12px] font-medium text-muted-foreground">
                {label}<span className="text-subtle tnum">{shown.length}</span>
              </div>
              {shown.map((x) => {
                const Icon = x.icon, st = STATUS[x.status], live = x.status === "live", planned = x.status === "planned";
                return (
                  <div key={x.name} className="flex flex-wrap items-start gap-x-4 gap-y-3 border-0 border-t border-solid border-border px-5 py-[18px]">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px]" style={{ color: x.color, background: tint(x.color) }}><Icon size={18} className="block" /></span>
                    <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-2">
                      <div className="flex min-h-[22px] flex-wrap items-center gap-2">
                        <span className="text-[14px] font-semibold">{x.name}</span>
                        <span className="inline-flex h-5 items-center gap-[5px] rounded-[5px] px-[7px] text-[11.5px] font-medium" style={{ color: st.color, background: planned ? "var(--card-2)" : tint(st.color) }}><Dot color={st.color} />{st.label}</span>
                      </div>
                      <div className="max-w-[720px] text-[13px] leading-[1.55] text-fg-2 text-wrap-pretty">{x.desc}</div>
                      <div className="flex flex-wrap gap-[5px]">
                        {x.scopes.map((s) => <span key={s} className="rounded-[5px] bg-card-2 px-[7px] py-px font-mono text-[11.5px] leading-[18px] text-fg-2">{s}</span>)}
                      </div>
                      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        {live ? <KeyRound size={12} className="block" /> : <Info size={12} className="block" />}{x.meta}
                      </div>
                    </div>
                    {x.href ? (
                      <Button key={x.status} asChild variant={planned ? "primary" : "outline"} size="sm" className="ml-auto h-8">
                        <Link href={x.href} className="no-underline">{live ? "Manage" : planned ? "Connect" : "Set up"}</Link>
                      </Button>
                    ) : <Button variant="primary" size="sm" className="ml-auto h-8" disabled title="Not available yet">Connect</Button>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </Card>
      <div className="text-[12.5px] leading-[1.5] text-muted-foreground">Credentials are stored as encrypted secrets — see <span className="font-medium text-fg-2">Settings → Secrets</span>. Natasha only requests read scopes.</div>
    </Screen>
  );
}
