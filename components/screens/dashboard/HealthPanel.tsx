"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { Lightbulb, ShieldCheck, Sparkle, Sprout, type LucideIcon } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { ago, compact, isStale, num } from "@/components/natasha/format";
import type { DashboardSummary } from "@/components/shell/useOps";
import { cn } from "@/lib/utils";

function Stat({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[.03em] text-muted-foreground">{label}</div>
      <div className="mt-[3px] text-[14px] font-semibold tnum" style={{ color }}>{value}</div>
    </div>
  );
}

function Tile({ href, icon: Icon, title, tag, dot, big, bigColor, unit, footLeft, footRight, footRightColor, children }: {
  href?: string; icon: LucideIcon; title: string; tag?: string; dot: string; big: ReactNode; bigColor?: string; unit: ReactNode;
  footLeft: string; footRight: string; footRightColor?: string; children: ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-[13px] font-medium text-fg-2">
        <span className="text-muted-foreground"><Icon size={16} className="block" /></span>{title}
        {tag && <span className="font-mono text-[11.5px] text-muted-foreground">{tag}</span>}
        <span className="ml-auto h-2 w-2 rounded-[8px]" style={{ background: dot }} />
      </div>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-[26px] font-semibold tracking-[-0.03em] text-foreground tnum" style={{ color: bigColor }}>{big}</span>
        <span className="truncate text-[12.5px] text-muted-foreground">{unit}</span>
      </div>
      {children}
      <div className="mt-auto flex justify-between gap-2 border-0 border-t border-solid border-border pt-3 text-[12px] text-muted-foreground">
        <span>{footLeft}</span><span style={{ color: footRightColor }}>{footRight}</span>
      </div>
    </>
  );
  const cls = cn("flex min-w-0 flex-col gap-3.5 px-5 py-[18px] shadow-[1px_0_0_var(--border),0_1px_0_var(--border)]", href && "cursor-pointer hover:bg-hover");
  return href
    ? <Link href={href} className={cn(cls, "no-underline")}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

const STAT_GRID = "grid grid-cols-2 gap-x-3 gap-y-2.5";

export function HealthPanel({ s }: { s: DashboardSummary }) {
  const f = s.github.findings;
  const sp = s.spring;
  const stale = (iso: string | null) => (isStale(iso) ? "var(--warning)" : undefined);
  const snapRel = (iso: string | null) => `Snap ${ago(iso)}`;
  const zeroGood = (n: number) => (n > 0 ? "var(--danger)" : "var(--success)");
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Platform health" description="Security, services, functions and recommendations" className="py-[18px]" />
      <div className="grid overflow-hidden border-0 border-t border-solid border-border grid-cols-[repeat(var(--h4c,4),minmax(0,1fr))]">
        <Tile href="/security" icon={ShieldCheck} title="GitHub Security" dot={f.CRIT > 0 ? "var(--danger)" : f.HIGH > 0 ? "var(--warning)" : "var(--success)"}
          big={num(s.github.activeRepos)} unit="active repos" footLeft={`${s.github.scans.last24h} scans (24h)`} footRight={`Synced ${ago(s.github.lastSyncAt)}`}>
          <div className={STAT_GRID}>
            <Stat label="Crit" value={num(f.CRIT)} color="var(--danger)" />
            <Stat label="High" value={num(f.HIGH)} color="var(--orange)" />
            <Stat label="Med" value={num(f.MED)} color="var(--warning)" />
            <Stat label="Total" value={compact(f.total)} />
          </div>
        </Tile>
        <Tile href="/perf/spring" icon={Sprout} title="Spring Services" dot={sp.down > 0 ? "var(--danger)" : sp.servicesWithErrors > 0 ? "var(--warning)" : "var(--success)"}
          big={num(sp.total)} unit="total services" footLeft="Prometheus + ELK" footRight={snapRel(sp.lastHealthSnap)} footRightColor={stale(sp.lastHealthSnap)}>
          <div className={STAT_GRID}>
            <Stat label="Down" value={num(sp.down)} color={zeroGood(sp.down)} />
            <Stat label="Heap >85%" value={num(sp.highHeap)} color={zeroGood(sp.highHeap)} />
            <Stat label="Erroring" value={num(sp.servicesWithErrors)} color={zeroGood(sp.servicesWithErrors)} />
            <Stat label="Errors 1h" value={compact(sp.totalErrors1h)} color={zeroGood(sp.totalErrors1h)} />
          </div>
        </Tile>
        <Tile href="/lambda" icon={Sparkle} title="Lambda" tag="us-east-2" dot={s.lambda.errors24h > 0 ? "var(--warning)" : "var(--success)"}
          big={num(s.lambda.total)} unit="functions" footLeft="Ohio · CloudWatch" footRight={snapRel(s.lambda.lastSnap)} footRightColor={stale(s.lambda.lastSnap)}>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Invocations 24h" value={compact(s.lambda.invocations24h)} />
            <Stat label="Errors 24h" value={num(s.lambda.errors24h)} color={s.lambda.errors24h > 0 ? "var(--danger)" : undefined} />
          </div>
        </Tile>
        <Tile href="/incidents" icon={Lightbulb} title="Recommendations" dot={s.recommendations.total > 0 ? "var(--info)" : "var(--success)"}
          big={num(s.recommendations.total)} unit="open recommendations" footLeft="Prometheus + CloudWatch" footRight={snapRel(s.recommendations.lastSnap)} footRightColor={stale(s.recommendations.lastSnap)}>
          <div className="text-[12.5px] leading-[1.5] text-fg-2">
            {s.recommendations.top[0]?.message ?? "No actionable wins detected — all instances right-sized."}
          </div>
        </Tile>
      </div>
    </Card>
  );
}
