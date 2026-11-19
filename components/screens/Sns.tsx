"use client";
import { useMemo, useState } from "react";
import { Download, Eye, Globe, Info, Mail, MessageCircle, Radio, RefreshCw, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { downloadCsv, toCsv } from "@/components/csv";
import { dayLabel, usd } from "@/components/natasha/format";
import { ErrorNote, PageHeader, Screen, ScreenSkeleton, ShareBar } from "@/components/natasha/primitives";
import { useShell } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { cn } from "@/lib/utils";

interface Topic { arn: string; name: string; cost: number; unit: string }
interface Usage { resourceAndUsage: string; usageType: string; cost: number; unit: string }
interface SnsResp { range: { Start: string; End: string }; total: number; topics: Topic[]; usage: Usage[] }

const COLS = "minmax(160px,1fr) 90px minmax(160px,1fr) minmax(120px,1fr) 80px 96px";
const USAGE_COLS = "minmax(0,1fr) 120px 80px";
/** Cost Explorer's placeholder for usage that is not tied to a topic. */
const NO_TOPIC = "NoResourceId";
const topicName = (n: string) => (n === NO_TOPIC ? "Not linked to a topic" : n);
const topicArn = (a: string) => (a === NO_TOPIC ? "—" : a);

const channelOf = (n: string) => (/SMTP/i.test(n) ? "Email" : /HTTP/i.test(n) ? "HTTP(S)" : /LAMBDA/i.test(n) ? "Lambda" : /SMS/i.test(n) ? "SMS" : /Requests/i.test(n) ? "API requests" : "Data transfer");
const regionOfArn = (arn: string) => arn.split(":")[3] || "—";
/** Cost Explorer end dates are exclusive: show the last day that is included. */
const lastDay = (end: string) => new Date(Date.parse(`${end}T00:00:00Z`) - 86_400_000).toISOString();

const CHANNELS: Array<{ label: string; icon: LucideIcon; test: RegExp }> = [
  { label: "HTTP delivery", icon: Globe, test: /HTTP/i },
  { label: "API requests", icon: MessageCircle, test: /Requests/i },
  { label: "Email", icon: Mail, test: /SMTP/i },
];

export default function Sns() {
  const { toast } = useShell();
  const { data, error, reload } = useJson<SnsResp>("/api/cost/sns");
  const [q, setQ] = useState("");
  const [inspect, setInspect] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [zeroRows, setZeroRows] = useState(false);

  const topics = useMemo(() => [...(data?.topics ?? [])].sort((a, b) => b.cost - a.cost), [data]);
  const needle = q.trim().toLowerCase();
  const shown = topics.filter((t) => !needle || `${t.name} ${t.arn}`.toLowerCase().includes(needle));
  const openArn = inspect ?? (topics.length === 1 ? topics[0].arn : null);
  const openTopic = shown.find((t) => t.arn === openArn) ?? null;

  const header = (
    <PageHeader title="SNS" description="Cost per topic plus delivery-channel usage for the last 14 days." actions={<>
      <Button size="lg" onClick={() => {
        downloadCsv("sns-topics.csv", toCsv(shown, [{ key: "name", label: "Topic" }, { key: "arn", label: "ARN" }, { key: "cost", label: "Cost" }, { key: "unit", label: "Unit" }]));
        toast(`Exported ${shown.length} topic${shown.length === 1 ? "" : "s"} to CSV`);
      }}><Download size={14} className="block" />Export CSV</Button>
      <Button variant="primary" size="lg" className="px-3.5" disabled={busy} onClick={() => {
        // SNS cost comes straight from Cost Explorer, so a refresh is a re-fetch rather than a snapshot.
        setBusy(true);
        reload();
        setTimeout(() => { setBusy(false); toast("SNS costs refreshed from Cost Explorer"); }, 800);
      }}><RefreshCw size={14} className={cn("block", busy && "animate-nt-spin")} />Refresh</Button>
    </>} />
  );
  if (error) return <Screen label="SNS">{header}<ErrorNote message={error} onRetry={reload} /></Screen>;
  if (!data) return <ScreenSkeleton />;

  const channels = [
    ...CHANNELS.map((c) => ({ ...c, cost: data.usage.filter((u) => c.test.test(u.usageType)).reduce((a, u) => a + u.cost, 0) })),
  ];
  const known = channels.reduce((a, c) => a + c.cost, 0);
  const rows = [{ label: "Other", icon: Radio, cost: Math.max(0, data.total - known) }, ...channels].sort((a, b) => b.cost - a.cost);
  const maxCost = Math.max(0.0001, topics[0]?.cost ?? 0);
  const shownTotal = shown.reduce((a, t) => a + t.cost, 0);
  const openUsage = openTopic ? data.usage.filter((u) => u.resourceAndUsage.startsWith(openTopic.arn) || u.resourceAndUsage.startsWith(openTopic.name)) : [];
  // Rows that round to $0.00 are folded away unless asked for.
  const isZero = (u: Usage) => Math.abs(u.cost) < 0.005;
  const zeroUsage = openUsage.filter(isZero).length;
  const shownUsage = zeroRows ? openUsage : openUsage.filter((u) => !isZero(u));

  return (
    <Screen label="SNS">
      {header}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-4">
        <Card>
          <CardHeader title="Cost by delivery channel" description="Last 14 days" className="pb-2" actions={<Badge size="md" className="text-fg-2">{usd(data.total)} · 14 days</Badge>} />
          <div className="flex flex-col px-5 pb-3.5 pt-1">
            {rows.map((c, i) => {
              const Icon = c.icon;
              return (
                <div key={c.label} className={cn("flex min-h-[46px] items-center gap-3", i < rows.length - 1 && "border-0 border-b border-solid border-border")}>
                  <span className="grid h-[30px] w-[30px] place-items-center rounded-[8px] bg-card-2 text-fg-2"><Icon size={14} className="block" /></span>
                  <span className="flex-1 text-[13px] font-medium">{c.label}</span>
                  <span className={cn("text-[13px] font-medium tnum", !c.cost && "text-muted-foreground")}>{usd(c.cost)}</span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card className="flex flex-col">
          <CardHeader title="Top topics by cost" description={`${topics.length} topic${topics.length === 1 ? "" : "s"} with usage`} className="pb-2" />
          <div className="flex flex-col gap-3 px-5 pb-4 pt-2.5">
            {topics.slice(0, 5).map((t) => (
              <div key={t.arn} className="flex flex-col gap-2">
                <div className="flex justify-between gap-3 text-[13px]"><span className={cn("truncate", t.name !== NO_TOPIC && "font-mono")}>{topicName(t.name)}</span><span className="font-semibold tnum">{usd(t.cost)}</span></div>
                <ShareBar pct={(t.cost / maxCost) * 100} />
              </div>
            ))}
            {topics.length === 0 && <div className="text-[13px] text-muted-foreground">No SNS usage in this window.</div>}
          </div>
          <div className="mx-5 mb-5 mt-auto flex items-center gap-2.5 rounded-[10px] bg-card-2 px-3.5 py-3 text-[12.5px] text-muted-foreground">
            <Info size={14} className="block shrink-0" />Usage that AWS does not tie to a topic is shown as “Not linked to a topic”.
          </div>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Cost per topic</h3>
            <div className="mt-[3px] text-[13px] text-muted-foreground">{usd(shownTotal)} shown · {shown.length} of {topics.length} topics</div>
          </div>
          <SearchInput wrapperClassName="w-[260px] max-w-full" placeholder="Topic name or ARN…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid h-[38px] items-center gap-4 border-0 border-y border-solid border-border bg-card-2 px-5 text-[12px] font-medium text-muted-foreground" style={{ gridTemplateColumns: COLS }}>
              <span>Topic</span><span>Region</span><span>ARN</span><span>Share</span><span className="text-right">Cost</span><span />
            </div>
            {shown.map((t, i) => {
              const on = t.arn === openArn;
              return (
                <div key={t.arn} className={cn("grid min-h-12 items-center gap-4 px-5 text-[13px] hover:bg-hover", i < shown.length - 1 && "border-0 border-b border-solid border-border")} style={{ gridTemplateColumns: COLS }}>
                  <span className="truncate font-medium">{topicName(t.name)}</span>
                  <span className="truncate text-muted-foreground">{regionOfArn(t.arn)}</span>
                  <span className="truncate font-mono text-[12.5px] text-fg-2" title={topicArn(t.arn)}>{topicArn(t.arn)}</span>
                  <ShareBar pct={(t.cost / maxCost) * 100} />
                  <span className="text-right font-medium tnum">{usd(t.cost)}</span>
                  <Button size="xs" className="justify-self-end rounded-[7px]" onClick={() => setInspect(on ? "" : t.arn)}><Eye size={12} className="block" />{on ? "Hide usage" : "Inspect"}</Button>
                </div>
              );
            })}
            {shown.length === 0 && <div className="px-5 py-9 text-center text-[13px] text-muted-foreground">{topics.length ? `No topics match “${q}”.` : "No SNS topics in this window."}</div>}
          </div>
        </div>
      </Card>
      {openTopic && (
        <Card className="overflow-hidden">
          <CardHeader title={`Cost by usage type · ${topicName(openTopic.name)}`} description="Usage types distinguish delivery channels — SMS, HTTP(S), email, mobile push and API requests" className="py-4" />
          <div className="-mb-px overflow-x-auto">
            <div className="min-w-[460px]">
              <div className="grid h-[38px] items-center gap-4 border-0 border-y border-solid border-border bg-card-2 px-5 text-[12px] font-medium text-muted-foreground" style={{ gridTemplateColumns: USAGE_COLS }}>
                <span>Usage type</span><span>Channel</span><span className="text-right">Cost</span>
              </div>
              {shownUsage.map((u) => (
                <div key={u.resourceAndUsage} className="grid min-h-[38px] items-center gap-4 border-0 border-b border-solid border-border px-5 text-[13px] hover:bg-hover" style={{ gridTemplateColumns: USAGE_COLS }}>
                  <span className="truncate font-mono text-[12.5px]">{u.usageType}</span>
                  <span><Badge className="text-fg-2 font-normal">{channelOf(u.usageType)}</Badge></span>
                  <span className={cn("text-right tnum", !u.cost && "text-muted-foreground")}>{usd(u.cost)}</span>
                </div>
              ))}
              {openUsage.length === 0 && <div className="px-5 py-6 text-[13px] text-muted-foreground">No usage rows for this topic.</div>}
              {zeroUsage > 0 && (
                <button type="button" aria-expanded={zeroRows} onClick={() => setZeroRows((v) => !v)} className="w-full cursor-pointer border-0 border-b border-solid border-border bg-transparent px-5 py-2.5 text-left text-[12.5px] font-medium text-fg-2 hover:bg-hover">
                  {zeroRows ? `Hide the ${zeroUsage} usage types that cost $0.00` : `Show ${zeroUsage} more usage types that cost $0.00`}
                </button>
              )}
            </div>
          </div>
          <div className="border-0 border-t border-solid border-border px-5 pb-4 pt-3 text-[12.5px] text-muted-foreground">{dayLabel(data.range.Start)} – {dayLabel(lastDay(data.range.End))} · last 14 days</div>
        </Card>
      )}
    </Screen>
  );
}
