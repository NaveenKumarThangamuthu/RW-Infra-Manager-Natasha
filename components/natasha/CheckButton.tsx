"use client";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Checkbox-styled toggle button used in table toolbars. */
export function CheckButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-[8px] border border-solid border-border bg-card px-2.5 text-[12.5px] font-medium text-foreground hover:bg-hover">
      <span className={cn("grid h-3.5 w-3.5 place-items-center rounded-[4px] border border-solid text-primary-foreground", on ? "border-primary bg-primary" : "border-border-strong bg-transparent")}>
        {on && <Check size={12} className="block" />}
      </span>{children}
    </button>
  );
}
