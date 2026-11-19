"use client";
import { useState } from "react";
import Link from "next/link";
import { Activity, BarChart3, Calendar, Cloud, Database, Gauge, GitBranch, HardDrive, Info, KeyRound, Radio, Search, Send, Sparkles, Table, Volume2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Dot, PageHeader, Screen } from "@/components/natasha/primitives";
import { useJson } from "@/components/useJson";
import { tint } from "@/lib/utils";

type Status = "connected" | "configured" | "planned" | "optional";
interface Provider { name: string; icon: LucideIcon; status: Status; desc: string; scopes: string[]; meta: string; color: string; href: string; manage?: string }

// Only GitHub is checked live on this page. The others are set up on the server, so they read "Configured", not "Live".
const STATUS: Record<Status, { label: string; color: string }> = {
  connected: { label: "Connected", color: "var(--success)" },
  configured: { label: "Configured", color: "var(--info)" },
  planned: { label: "Not connected", color: "var(--muted-fg)" },
  optional: { label: "Optional", color: "var(--warning)" },
};
const SECRETS = "/settings#secrets";

export default function Integrations() {
  const { data: repos } = useJson<{ connected?: boolean }>("/api/security/repos");
  const [filter, setFilter] = useState<Status | "all">("all");
  const connected = !!repos?.connected;

  const groups: Array<[string, Provider[]]> = [
    ["Cloud", [{ name: "AWS", icon: Cloud, status: "configured", desc: "Cost Explorer, EC2, Lambda, SNS and CloudWatch. Read-only: Natasha never changes anything in AWS.", scopes: ["ce:GetCostAndUsage", "ec2:Describe*", "lambda:List*", "sns:List*", "cloudwatch:Get*"], meta: "Read-only access · set up on the server", color: "var(--orange)", href: "" }]],
    ["Source code", [
      { name: "GitHub", icon: GitBranch, status: connected ? "connected" : "planned", desc: "Lists repositories and scans each one for vulnerable dependencies and secrets. The access key is stored encrypted.", scopes: ["repo", "read:user", "read:org"], meta: connected ? "Connected · checked just now" : "Not connected", color: "var(--fg-2)", href: connected ? "/security" : "/security/connect", manage: "Open repositories" },
      { name: "SonarQube", icon: Gauge, status: "configured", desc: "Code quality figures for the Sonar Quality page, read from the internal SonarQube server once a night.", scopes: ["Read projects and measures"], meta: "Internal server · office network", color: "var(--info)", href: SECRETS },
    ]],
    ["Google", [
      { name: "Google Sign-In", icon: KeyRound, status: "configured", desc: "How people sign in to Natasha. Access is limited to the allowed users list in Settings.", scopes: ["Email and profile"], meta: "Sign-in only", color: "var(--c30)", href: "/settings#allowed-users" },
      { name: "Google Drive", icon: HardDrive, status: "configured", desc: "Reads the AS2 certificate files from the shared Drive folders for the Certificates page.", scopes: ["Read files"], meta: "Read-only", color: "var(--success)", href: SECRETS },
      { name: "Google Sheets", icon: Table, status: "configured", desc: "Reads the running services list, which decides which repositories are shown and scanned.", scopes: ["Read one sheet"], meta: "Read-only", color: "var(--success)", href: "" },
    ]],
    ["Databases", [{ name: "MySQL · RDS", icon: Database, status: "configured", desc: "Natasha keeps its own history in MySQL, and reads statement statistics from the RDS databases for the Slow queries page.", scopes: ["Own database: read and write", "RDS databases: read-only statistics"], meta: "Set up on the server", color: "var(--cinfra)", href: "" }]],
    ["Messaging", [{ name: "Telegram", icon: Send, status: "configured", desc: "Cost anomaly alerts and a summary after each scheduled refresh. Stays silent when there is nothing to report.", scopes: ["sendMessage", "sendDocument"], meta: "The only service Natasha writes to", color: "var(--info)", href: "" }]],
    ["AI", [{ name: "Anthropic", icon: Sparkles, status: "optional", desc: "Writes the daily brief and log summaries when an API key is set. Without a key, Natasha writes a plain summary itself.", scopes: ["Messages API"], meta: "Optional", color: "var(--brand)", href: "" }]],
    ["Voice", [{ name: "ElevenLabs", icon: Volume2, status: "optional", desc: "Premium TTS. Off until ELEVENLABS_API_KEY is set. Deterministic template narration otherwise.", scopes: ["text-to-speech", "voices/list"], meta: "Optional — voice for briefings", color: "var(--cdev)", href: SECRETS }]],
    ["Monitoring", [
      { name: "Prometheus", icon: Activity, status: "configured", desc: "Alert rules plus CPU, memory and heap figures for the Spring services and servers.", scopes: ["/api/v1/alerts", "/api/v1/query"], meta: "Read-only", color: "var(--danger)", href: SECRETS },
      { name: "ELK · Elasticsearch", icon: Search, status: "configured", desc: "Service logs: error counts for Spring services and database trouble for the Slow queries page.", scopes: ["indices:data/read/search"], meta: "Read-only viewer role", color: "var(--cshared)", href: SECRETS },
      { name: "CloudWatch", icon: BarChart3, status: "configured", desc: "Server metrics, Lambda logs and the alarms shown on the Alerts page.", scopes: ["cloudwatch:GetMetric*", "logs:FilterLogEvents"], meta: "Read-only · all regions", color: "var(--c20)", href: "" },
      { name: "Grafana Loki", icon: Radio, status: "configured", desc: "Live log stream for the OpenAS2 (EDI) page and the Spring service log view.", scopes: ["query_range", "labels", "label values"], meta: "Read-only", color: "var(--cinfra)", href: "" },
    ]],
    ["Calendar", [{ name: "Google Calendar", icon: Calendar, status: "planned", desc: "Not set up yet. Reserved for a future briefing that looks at today’s meetings.", scopes: ["calendar.readonly"], meta: "Planned — not enabled", color: "var(--fg-2)", href: "" }]],
  ];
  const all = groups.flatMap((g) => g[1]);
  const count = (k: Status | "all") => all.filter((x) => k === "all" || x.status === k).length;

  return (
    <Screen label="Integrations">
      <PageHeader title="Integrations" description="Every outside service Natasha talks to, what it is allowed to do there, and where its credentials are kept."
        actions={<div className="max-w-[calc(100vw-32px)] overflow-x-auto"><Segmented size="md" value={filter} onChange={setFilter} aria-label="Status" options={(["all", "connected", "configured", "optional", "planned"] as const).map((k) => ({ value: k, label: k === "all" ? "All" : STATUS[k].label, count: count(k) }))} /></div>} />
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
                const Icon = x.icon, st = STATUS[x.status], live = x.status === "connected" || x.status === "configured", planned = x.status === "planned";
                const isGithub = x.name === "GitHub";
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
                        {x.scopes.map((s) => <span key={s} className="max-w-full break-all rounded-[5px] bg-card-2 px-[7px] py-px font-mono text-[11.5px] leading-[18px] text-fg-2">{s}</span>)}
                      </div>
                      <div className="flex min-w-0 items-start gap-1.5 break-words text-[12px] text-muted-foreground">
                        {live ? <KeyRound size={12} className="block" /> : <Info size={12} className="block" />}{x.meta}
                      </div>
                    </div>
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      {isGithub && connected && (
                        <form method="POST" action="/api/auth/github/disconnect"
                          onSubmit={(e) => { if (!window.confirm("Disconnect GitHub? Natasha will lose access to every repository, and scans stop until someone connects again.")) e.preventDefault(); }}>
                          <Button type="submit" variant="ghost" size="sm" className="h-8 text-danger">Disconnect</Button>
                        </form>
                      )}
                      {x.href ? (
                        <Button key={x.status} asChild variant={planned ? "primary" : "outline"} size="sm" className="h-8">
                          <Link href={x.href} className="no-underline">{live ? (x.manage ?? (x.href === SECRETS ? "Manage credentials" : "Manage")) : planned ? "Connect" : "Set up"}</Link>
                        </Button>
                      ) : planned ? <Button variant="primary" size="sm" className="h-8" disabled title="Not available yet">Connect</Button>
                        : <span className="text-[12px] text-muted-foreground">Managed on the server</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </Card>
      <div className="text-[12.5px] leading-[1.5] text-muted-foreground">Reads from AWS, GitHub, Google, Prometheus, ELK, Loki and SonarQube; writes only Telegram messages. Credentials are stored encrypted — see <span className="font-medium text-fg-2">Settings → Secrets</span>. Only the GitHub connection is checked live on this page; the others show how the server is set up.</div>
    </Screen>
  );
}
