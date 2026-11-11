"use client";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Calendar, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function options(n = 12) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return {
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
      current: i === 0,
    };
  });
}

export function MonthPicker() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const opts = options();
  const value = sp.get("month") ?? opts[0].key;
  const selected = opts.find((o) => o.key === value) ?? opts[0];

  const pick = (key: string) => {
    const params = new URLSearchParams(Array.from(sp.entries()));
    params.set("month", key);
    router.push(`${path}?${params.toString()}`);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="lg" className="gap-2">
          <Calendar size={14} className="block" />{selected.label}
          {selected.current && <span className="rounded-[5px] bg-card-2 px-1.5 py-px text-[11px] text-muted-foreground">Current</span>}
          <span className="text-muted-foreground"><ChevronDown size={14} className="block" /></span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[320px] w-56 overflow-y-auto p-1.5">
        {opts.map((o) => (
          <button key={o.key} type="button" onClick={() => pick(o.key)}
            className={cn("flex h-[34px] w-full cursor-pointer items-center justify-between rounded-[7px] border-none bg-transparent px-2.5 text-left text-[13px] text-foreground hover:bg-hover", o.key === value && "font-medium")}>
            {o.label}{o.key === value && <Check size={14} className="block text-brand" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
