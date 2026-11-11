"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  count?: React.ReactNode;
  icon?: React.ReactNode;
}

/** The design's pill tab group (shadcn Tabs list styling, driven as a controlled value). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
  className,
  "aria-label": ariaLabel,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "xs" | "sm" | "md";
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 overflow-x-auto whitespace-nowrap rounded-[9px] bg-card-2 p-[3px] scrollbar-none",
        className,
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[6px] border-none px-2.5 font-medium",
              size === "xs" && "h-6 px-[9px] text-[12px]",
              size === "sm" && "h-[26px] text-[12.5px]",
              size === "md" && "h-7 text-[13px]",
              on ? "bg-tab text-foreground shadow-[0_1px_2px_rgba(0,0,0,.14)]" : "bg-transparent text-muted-foreground",
            )}
          >
            {o.icon}
            {o.label}
            {o.count != null && <span className="text-[11px] text-muted-foreground tnum">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
