"use client";
import { Suspense, useMemo, useState } from "react";
import { ArrowRight, Cloud, Globe, Layers, Server, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { CheckButton } from "@/components/natasha/CheckButton";
import { usd } from "@/components/natasha/format";
import { MonthPicker } from "@/components/natasha/MonthPicker";
import { ErrorNote, Kpi, KpiGrid, PageHeader, Screen, ScreenSkeleton } from "@/components/natasha/primitives";
import { useOnRefreshed } from "@/components/shell/ShellContext";
import { useJson } from "@/components/useJson";
import { useMonthParam, withMonth } from "@/components/useMonth";
import { cn, tint } from "@/lib/utils";
import { periodText } from "./dashboard/period";

interface UsageRow { usageType: string; category: string; amount: number; unit: string }
interface RegionRow { region: string; public: number; private: number; other: number; total: number }
interface DTResp { range: { Start: string; End: string }; total: number; buckets: Array<{ category: string; amount: number }>; byUsageType: UsageRow[]; byRegion: RegionRow[] }

type FlowKind = "egress" | "ingress" | "xreg" | "xaz" | "same" | "other";
const BUCKETS: Record<string, { key: string; label: string; color: string }> = {
  "Public IP / Internet": { key: "P", label: "Public IP", color: "var(--cinfra)" },
  "Private IP / Intra-AWS": { key: "V", label: "Private IP", color: "var(--cshared)" },
  "Other transfer": { key: "O", label: "Other transfer", color: "var(--c30)" },
};
const FLOW_TYPES: Record<FlowKind, { label: string; color: string }> = {
  egress: { label: "Public egress", color: "var(--orange)" },
  ingress: { label: "Public ingress", color: "var(--info)" },
  xreg: { label: "Cross-region", color: "var(--c20)" },
  xaz: { label: "Cross-AZ", color: "var(--c30)" },
  same: { label: "Private same-AZ", color: "var(--cshared)" },
  other: { label: "Other", color: "var(--muted-fg)" },
};
const USAGE_PREFIX: Record<string, string> = {
  USE1: "us-east-1", USE2: "us-east-2", USW1: "us-west-1", USW2: "us-west-2", APS1: "ap-southeast-1", APS2: "ap-southeast-2", APS3: "ap-south-1",
  APN1: "ap-northeast-1", APN2: "ap-northeast-2", CAN1: "ca-central-1", EU: "eu-west-1", EUW1: "eu-west-1", EUW2: "eu-west-2", EUW3: "eu-west-3", EUC1: "eu-central-1", UGW1: "us-gov-west-1",
};

interface Flow { key: string; from: string; fromIcon: LucideIcon; to: string; toIcon: LucideIcon; kind: FlowKind; usage: string; cost: number }

/** AWS puts the region in a usage-type prefix; a type with no prefix is billed in us-east-1. */
const DEFAULT_REGION = "us-east-1";
function regionOf(usage: string): string {
  return USAGE_PREFIX[usage.split("-")[0]] ?? DEFAULT_REGION;
}

/** "USE1-USE2-AWS-Out-Bytes": traffic between two regions, named by both prefixes. */
const BETWEEN_REGIONS = /^([A-Z]{2,4}\d?)-([A-Z]{2,4}\d?)-AWS-(In|Out)-Bytes$/;

function classify(usage: string, amount: number, i: number): Flow {
  const s = usage.toLowerCase();
  const region = regionOf(usage);
  const base = { key: `${usage}-${i}`, usage, cost: amount };
  const pair = BETWEEN_REGIONS.exec(usage);
  if (pair) {
    const here = USAGE_PREFIX[pair[1]] ?? pair[1];
    const there = USAGE_PREFIX[pair[2]] ?? pair[2];
    return pair[3] === "Out"
      ? { ...base, kind: "xreg", from: here, fromIcon: Globe, to: there, toIcon: Globe }
      : { ...base, kind: "xreg", from: there, fromIcon: Globe, to: here, toIcon: Globe };
  }
  if (s.includes("cross-region") || s.includes("interregion") || s.includes("inter-region")) return { ...base, kind: "xreg", from: region, fromIcon: Globe, to: "another region", toIcon: Globe };
  if (s.includes("in-bytes") && s.includes("public")) return { ...base, kind: "ingress", from: "Internet", fromIcon: Globe, to: region, toIcon: Server };
  if (s.includes("out-bytes") || s.includes("egress") || s.includes("cloudfront") || s.includes("public-out")) return { ...base, kind: "egress", from: region, fromIcon: Server, to: "Internet", toIcon: Globe };
  // AWS does not say which zones were involved, only that the traffic crossed between two of them.
  if (s.includes("regional") && (s.includes("in-out") || s.includes("bytes"))) return { ...base, kind: "xaz", from: region, fromIcon: Layers, to: "another zone", toIcon: Layers };
  if (s.includes("intra") || s.includes("same-az")) return { ...base, kind: "same", from: region, fromIcon: Layers, to: "same zone", toIcon: Layers };
  return { ...base, kind: "other", from: region, fromIcon: Globe, to: "AWS", toIcon: Cloud };
}

/** Anything that prints as $0.00. */
const isZero = (amount: number) => Math.abs(amount) < 0.005;
const regionName = (r: string) => (r === "NoRegion" ? "Global" : r);

const REGION_COLS = "minmax(140px,1fr) 96px 96px 96px minmax(160px,1.4fr) 96px";
const USAGE_COLS = "minmax(240px,1.6fr) 130px minmax(140px,1fr) 90px";
const FLOW_COLS = "170px 20px 170px 130px minmax(220px,1fr) 90px";
const HEAD = "grid h-[38px] items-center border-0 border-y border-solid border-border bg-card-2 px-5 text-[12px] font-medium text-muted-foreground";
const FLOW_LIMIT = 20;

function Inner() {
  const month = useMonthParam();
  const { data, error, reload } = useJson<DTResp>(withMonth("/api/cost/datatransfer", month));
  useOnRefreshed(reload);
  const [bucket, setBucket] = useState("all");
  const [zeros, setZeros] = useState(false);
  const [q, setQ] = useState("");
  const [flow, setFlow] = useState<FlowKind | "all">("all");

  const regions = useMemo(() => [...(data?.byRegion ?? [])].sort((a, b) => b.total - a.total), [data]);
  const flows = useMemo(() => (data?.byUsageType ?? []).filter((u) => u.amount > 0.01).map((u, i) => classify(u.usageType, u.amount, i)).sort((a, b) => b.cost - a.cost), [data]);

  const header = <PageHeader title="Data Transfer" description="Transfer cost split into internet-facing and internal traffic, with a view of each direction." actions={<MonthPicker />} />;
  if (error) return <Screen label="Data Transfer">{header}<ErrorNote message={error} onRetry={reload} /></Screen>;
  if (!data) return <ScreenSkeleton />;

  const amt = (c: string) => data.buckets.find((b) => b.category === c)?.amount ?? 0;
  const pub = amt("Public IP / Internet"), priv = amt("Private IP / Intra-AWS"), other = amt("Other transfer");
  const share = (v: number) => (data.total > 0 ? ((v / data.total) * 100).toFixed(1) : "0.0");
  const rMax = Math.max(0.0001, ...regions.map((r) => r.total));
  const needle = q.trim().toLowerCase();
  const allUsage = data.byUsageType;
  const usage = allUsage.filter((u) => (bucket === "all" || BUCKETS[u.category]?.key === bucket) && (zeros || !isZero(u.amount)) && (!needle || u.usageType.toLowerCase().includes(needle))).sort((a, b) => b.amount - a.amount);
  const shownRegions = regions.filter((r) => zeros || !isZero(r.total));
  const hiddenRegions = regions.length - shownRegions.length;
  const uMax = Math.max(0.0001, ...allUsage.map((u) => u.amount));
  const shownFlows = (flow === "all" ? flows : flows.filter((f) => f.kind === flow));
  const flowTotal = flows.reduce((a, f) => a + f.cost, 0);
  const shownTotal = shownFlows.slice(0, FLOW_LIMIT).reduce((a, f) => a + f.cost, 0);
  const count = (k: FlowKind | "all") => (k === "all" ? flows.length : flows.filter((f) => f.kind === k).length);

  const dotLabel = (color: string, label: string) => <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-[2px]" style={{ background: color }} />{label}</span>;
  const legend = (color: string, label: string) => <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px]" style={{ background: color }} />{label}</span>;

  return (
    <Screen label="Data Transfer">
      {header}
      <KpiGrid>
        <Kpi label={dotLabel("var(--cinfra)", "Public IP · internet")} value={usd(pub)} footer={`${share(pub)}% of transfer · egress and IPv4`} />
        <Kpi label={dotLabel("var(--cshared)", "Private IP · intra-AWS")} value={usd(priv)} footer={`${share(priv)}% · cross-AZ, cross-region, NAT`} />
        <Kpi label={dotLabel("var(--c30)", "Other transfer")} value={usd(other)} footer={`${share(other)}% · processing, logs, events`} />
        <Kpi label="Total data transfer" value={usd(data.total)}>
          <div className="mt-[5px] flex h-1.5 gap-0.5 overflow-hidden rounded-[6px]">
            <span style={{ width: `${share(pub)}%`, background: "var(--cinfra)" }} />
            <span style={{ width: `${share(priv)}%`, background: "var(--cshared)" }} />
            <span className="flex-1" style={{ background: "var(--c30)" }} />
          </div>
        </Kpi>
      </KpiGrid>
      <Card className="overflow-hidden">
        <CardHeader title="By region · public vs private" description="Transfer cost per region for the period" className="pb-3.5"
          actions={<div className="flex flex-wrap gap-3.5 text-[12px] text-muted-foreground">{legend("var(--cinfra)", "Public")}{legend("var(--cshared)", "Private")}{legend("var(--c30)", "Other")}</div>} />
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className={cn(HEAD, "gap-4")} style={{ gridTemplateColumns: REGION_COLS }}>
              <span>Region</span><span className="text-right">Public IP</span><span className="text-right">Private IP</span><span className="text-right">Other</span><span>Split</span><span className="text-right">Total</span>
            </div>
            {shownRegions.map((r) => (
              <div key={r.region} className={cn("grid min-h-[42px] items-center gap-4 border-0 border-b border-solid border-border px-5 text-[13px] hover:bg-hover", isZero(r.total) && "opacity-50")} style={{ gridTemplateColumns: REGION_COLS }}>
                <span className="font-mono text-[12.5px]">{regionName(r.region)}</span>
                {[r.public, r.private, r.other].map((v, i) => <span key={i} className="text-right text-fg-2 tnum">{usd(v)}</span>)}
                <span className="flex h-2 overflow-hidden rounded-[8px] bg-card-2">
                  <span style={{ width: `${(r.public / rMax) * 100}%`, background: "var(--cinfra)" }} />
                  <span style={{ width: `${(r.private / rMax) * 100}%`, background: "var(--cshared)" }} />
                  <span style={{ width: `${(r.other / rMax) * 100}%`, background: "var(--c30)" }} />
                </span>
                <span className="text-right font-semibold tnum">{usd(r.total)}</span>
              </div>
            ))}
            {shownRegions.length === 0 && <div className="px-5 py-8 text-center text-[13px] text-muted-foreground">No transfer cost in any region this period.</div>}
          </div>
        </div>
        {hiddenRegions > 0 && (
          <div className="px-5 pb-4 pt-3 text-[12.5px] text-muted-foreground">{hiddenRegions} region{hiddenRegions === 1 ? "" : "s"} at $0.00 hidden. Use “Include $0.00” below to show them.</div>
        )}
      </Card>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">By usage type</h3>
            <div className="mt-[3px] text-[13px] text-muted-foreground tnum">{zeros ? `Showing ${usage.length} of ${allUsage.length} usage types` : `${usage.length} usage types with cost · $0.00 rows hidden`}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={bucket} onChange={setBucket} aria-label="Bucket" options={[{ value: "all", label: "All" }, { value: "P", label: "Public IP" }, { value: "V", label: "Private IP" }, { value: "O", label: "Other" }]} />
            <CheckButton on={zeros} onClick={() => setZeros((v) => !v)}>Include $0.00</CheckButton>
            <SearchInput wrapperClassName="w-[220px] max-w-full" placeholder="Usage type…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[680px]">
            <div className={cn(HEAD, "gap-4")} style={{ gridTemplateColumns: USAGE_COLS }}><span>Usage type</span><span>Bucket</span><span>Share</span><span className="text-right">Cost</span></div>
            {usage.map((u) => {
              const b = BUCKETS[u.category] ?? { label: u.category, color: "var(--muted-fg)" };
              return (
                <div key={u.usageType} className={cn("grid min-h-10 items-center gap-4 border-0 border-b border-solid border-border px-5 text-[13px] hover:bg-hover", isZero(u.amount) && "opacity-50")} style={{ gridTemplateColumns: USAGE_COLS }}>
                  <span className="truncate font-mono text-[12.5px]">{u.usageType}</span>
                  <span><span className="inline-flex h-[22px] items-center gap-1.5 rounded-[6px] px-2 text-[12px] font-medium text-fg-2" style={{ background: tint(b.color) }}><span className="h-1.5 w-1.5 rounded-[6px]" style={{ background: b.color }} />{b.label}</span></span>
                  <span className="block h-1.5 overflow-hidden rounded-[6px] bg-card-2"><span className="block h-full rounded-[6px]" style={{ width: `${u.amount > 0 ? Math.max(0.8, (u.amount / uMax) * 100) : 0}%`, background: b.color }} /></span>
                  <span className="text-right font-medium tnum">{usd(u.amount)}</span>
                </div>
              );
            })}
            {usage.length === 0 && <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">No usage types match these filters.</div>}
          </div>
        </div>
        <div className="px-5 pb-4 pt-3 text-[12.5px] text-muted-foreground">AWS bills data transfer by usage type, not per IP address. Period {periodText(data.range)}.</div>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Transfer by direction" description="Where each transfer dollar goes, read from the usage type" className="pb-3"
          actions={<Badge size="md" className="text-fg-2">{flows.length} flows · {usd(flowTotal)}</Badge>} />
        <div className="flex flex-wrap gap-1.5 px-5 pb-3.5">
          {(["all", "egress", "ingress", "xreg", "xaz", "same", "other"] as const).map((k) => {
            const n = count(k), on = flow === k;
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => setFlow(k)}
                className={cn("inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-[8px] border border-solid px-2.5 text-[12.5px] font-medium text-fg-2 hover:border-border-strong", !n && "opacity-55")}
                style={{ borderColor: on ? "color-mix(in oklab, var(--fg) 45%, transparent)" : "var(--border)", background: on ? tint("var(--fg)", 12) : "transparent" }}>
                {k === "all" ? "All" : FLOW_TYPES[k].label}<span className="text-muted-foreground tnum">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div className={cn(HEAD, "gap-3.5")} style={{ gridTemplateColumns: FLOW_COLS }}><span>From</span><span /><span>To</span><span>Type</span><span>Usage type</span><span className="text-right">Cost</span></div>
            {shownFlows.slice(0, FLOW_LIMIT).map((f) => {
              const t = FLOW_TYPES[f.kind], From = f.fromIcon, To = f.toIcon;
              return (
                <div key={f.key} className="grid min-h-[42px] items-center gap-3.5 border-0 border-b border-solid border-border px-5 text-[13px] hover:bg-hover" style={{ gridTemplateColumns: FLOW_COLS }}>
                  <span className="inline-flex h-6 items-center gap-1.5 justify-self-start whitespace-nowrap rounded-[6px] border border-solid border-border px-2 font-mono text-[11.5px] text-fg-2"><span className="text-muted-foreground"><From size={12} className="block" /></span>{f.from}</span>
                  <span className="text-subtle"><ArrowRight size={12} className="block" /></span>
                  <span className="inline-flex h-6 items-center gap-1.5 justify-self-start whitespace-nowrap rounded-[6px] border border-solid border-border px-2 text-[12px] text-fg-2"><span className="text-muted-foreground"><To size={12} className="block" /></span>{f.to}</span>
                  <span><Badge tone={t.color} className="px-2">{t.label}</Badge></span>
                  <span className="truncate font-mono text-[12.5px]">{f.usage}</span>
                  <span className="text-right font-medium tnum">{usd(f.cost)}</span>
                </div>
              );
            })}
            {shownFlows.length === 0 && <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">No flows of this type this month.</div>}
          </div>
        </div>
        <div className="flex justify-between gap-3 px-5 pb-4 pt-3 text-[12.5px] text-muted-foreground tnum">
          <span>{shownFlows.length > FLOW_LIMIT ? `Top ${FLOW_LIMIT} of ${shownFlows.length} flows` : `${shownFlows.length} flow${shownFlows.length === 1 ? "" : "s"}`}</span>
          <span className="font-semibold text-foreground">{usd(shownTotal)}</span>
        </div>
      </Card>
    </Screen>
  );
}

export default function DataTransfer() {
  return <Suspense fallback={<ScreenSkeleton />}><Inner /></Suspense>;
}
