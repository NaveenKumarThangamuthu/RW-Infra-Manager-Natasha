"use client";
import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { tint } from "@/lib/utils";

export const ISSUE_TONE = {
  critical: { color: "var(--danger)", label: "Critical", icon: AlertOctagon },
  warning: { color: "var(--warning)", label: "Warning", icon: AlertTriangle },
  info: { color: "var(--info)", label: "Info", icon: Info },
} as const;

export interface IssueLike { severity: "critical" | "warning" | "info"; title: string; evidence: string; action: string }

/** Same issue rows as the database page: icon, title, severity chip, evidence, action. */
export function IssueList({ issues, empty }: { issues: IssueLike[]; empty?: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      {issues.length === 0 && empty && <div className="text-[13px] text-muted-foreground">{empty}</div>}
      {issues.map((i) => {
        const t = ISSUE_TONE[i.severity], Icon = t.icon;
        return (
          <div key={`${i.severity}:${i.title}`} className="flex items-start gap-3 rounded-[10px] border border-solid p-3.5" style={{ borderColor: `color-mix(in oklab, ${t.color} 30%, var(--border))`, background: `color-mix(in oklab, ${t.color} 5%, var(--card))` }}>
            <span className="pt-px" style={{ color: t.color }}><Icon size={14} className="block" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-semibold">{i.title}</span>
                <span className="inline-flex h-5 items-center rounded-[5px] px-1.5 text-[11px] font-semibold" style={{ color: t.color, background: tint(t.color) }}>{t.label}</span>
              </div>
              <div className="mt-1 break-words text-[13px] text-fg-2">{i.evidence}</div>
              {i.action && <div className="mt-1 text-[12.5px] text-muted-foreground">{i.action}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
