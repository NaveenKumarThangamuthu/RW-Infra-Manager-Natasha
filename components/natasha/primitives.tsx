"use client";
import type { CSSProperties, ReactNode } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function Screen({ label, children }: { label: string; children: ReactNode }) {
  return <div data-screen-label={label} className="nt-screen flex flex-col gap-4">{children}</div>;
}

export function PageHeader({ title, description, actions, eyebrow, maxWidth = 760 }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; maxWidth?: number;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 flex-[1_1_420px]" style={{ maxWidth }}>
        {eyebrow && <div className="mb-1.5 text-[13px] text-muted-foreground">{eyebrow}</div>}
        <h1 className="m-0 text-[26px] font-semibold leading-[1.2] tracking-[-0.025em] text-foreground">{title}</h1>
        {description && <p className="mb-0 mt-1.5 text-[14px] leading-[1.5] text-muted-foreground text-wrap-pretty">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-[repeat(var(--k4,4),minmax(0,1fr))] gap-4", className)}>{children}</div>;
}

export function Kpi({ label, value, valueColor, badge, footer, children }: {
  label: ReactNode; value: ReactNode; valueColor?: string; badge?: ReactNode; footer?: ReactNode; children?: ReactNode;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-2.5 px-5 py-[18px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium leading-[22px] text-muted-foreground">{label}</span>
        {badge}
      </div>
      <div className="text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] tnum" style={{ color: valueColor }}>{value}</div>
      {footer && <span className="text-[12.5px] text-muted-foreground">{footer}</span>}
      {children}
    </Card>
  );
}

export function StatStrip({ items, cols = 5 }: { items: Array<{ label: ReactNode; value: ReactNode; color?: string; sub?: ReactNode }>; cols?: number }) {
  return (
    <Card className="grid overflow-hidden" style={{ gridTemplateColumns: `repeat(var(--s5c,${cols}),minmax(0,1fr))` }}>
      {items.map((it, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-1.5 px-5 py-4 shadow-[1px_0_0_var(--border),0_1px_0_var(--border)]"
          style={{ gridColumn: `span var(${i < 3 ? "--s5a" : i === 3 ? "--s5b" : "--s5e"},1)` }}>
          <span className="text-[13px] font-medium leading-5 text-muted-foreground">{it.label}</span>
          <span className="mt-auto text-[26px] font-semibold leading-8 tracking-[-0.03em] tnum" style={{ color: it.color }}>{it.value}</span>
          {it.sub != null && <span className="truncate text-[12.5px] leading-[18px] text-muted-foreground">{it.sub}</span>}
        </div>
      ))}
    </Card>
  );
}

/** Cost change: down is good (green), up is bad (red). */
export function Delta({ pct, size = "sm", zero = "flat" }: { pct: number | null | undefined; size?: "xs" | "sm"; zero?: string }) {
  const icon = size === "xs" ? 12 : 12;
  if (pct == null || Math.abs(pct) < 0.05) {
    return <Badge size={size} style={{ color: "var(--muted-fg)", background: "var(--card-2)" }}>{zero}</Badge>;
  }
  return pct < 0
    ? <Badge size={size} tone="var(--success)"><TrendingDown size={icon} className="block shrink-0" />−{Math.abs(pct).toFixed(1)}%</Badge>
    : <Badge size={size} tone="var(--danger)"><TrendingUp size={icon} className="block shrink-0" />+{pct.toFixed(1)}%</Badge>;
}

export function Dot({ color, size = 6, className }: { color: string; size?: number; className?: string }) {
  return <span className={cn("inline-block shrink-0", className)} style={{ width: size, height: size, borderRadius: size, background: color }} />;
}

export function IconWell({ color, size = 32, children }: { color: string; size?: number; children: ReactNode }) {
  return (
    <span className="grid shrink-0 place-items-center" style={{ width: size, height: size, borderRadius: size >= 32 ? 8 : 7, color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}>
      {children}
    </span>
  );
}

export function ShareBar({ pct, color = "var(--brand)", style }: { pct: number; color?: string; style?: CSSProperties }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-[6px] bg-card-2" style={style}>
      <span className="block h-full rounded-[6px]" style={{ width: `${pct}%`, background: color }} />
    </span>
  );
}

export function Banner({ tone, children, className }: { tone: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2.5 rounded-[10px] border border-solid px-3.5 py-2.5 text-[13px]", className)}
      style={{ borderColor: `color-mix(in oklab, ${tone} 30%, var(--border))`, background: `color-mix(in oklab, ${tone} 6%, var(--card))` }}>
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="px-5 py-12 text-center">
      <div className="text-[14px] font-medium">{title}</div>
      {children && <div className="mt-1 text-[13px] text-muted-foreground">{children}</div>}
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={cn("rounded-[8px] animate-nt-shimmer", className)}
      style={{ background: "linear-gradient(90deg, var(--card-2) 25%, var(--hover) 50%, var(--card-2) 75%)", backgroundSize: "800px 100%", ...style }} />
  );
}

export function ScreenSkeleton({ kpis = 4 }: { kpis?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-[60px] w-[320px]" />
      <KpiGrid>{Array.from({ length: kpis }, (_, i) => <Skeleton key={i} className="h-[120px] rounded-[12px]" />)}</KpiGrid>
      <Skeleton className="h-[320px] rounded-[12px]" />
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Banner tone="var(--danger)">
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && <button type="button" onClick={onRetry} className="cursor-pointer border-none bg-transparent text-[13px] font-medium text-foreground underline">Retry</button>}
    </Banner>
  );
}

/** Column header row + body row share a grid template; this is the design's table idiom. */
export function HeadRow({ columns, children, className }: { columns: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid h-[38px] items-center gap-3.5 border-0 border-b border-t-0 border-solid border-border bg-card-2 px-5 text-[12px] font-medium text-muted-foreground", className)}
      style={{ gridTemplateColumns: columns }}>
      {children}
    </div>
  );
}
