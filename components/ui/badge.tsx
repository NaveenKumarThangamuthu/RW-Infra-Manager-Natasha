import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn, tint } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center whitespace-nowrap rounded-[6px] font-medium tnum", {
  variants: {
    size: {
      xs: "h-5 gap-[3px] rounded-[5px] px-1.5 text-[11.5px]",
      sm: "h-[22px] gap-1 px-[7px] text-[12px]",
      md: "h-6 gap-1.5 px-2 text-[12px]",
    },
  },
  defaultVariants: { size: "sm" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** A CSS colour; renders text in it over a 14% tint. Omit for the outlined neutral badge. */
  tone?: string;
}

export function Badge({ className, size, tone, style, ...props }: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ size }), !tone && "border border-solid border-border text-muted-foreground", className)}
      style={tone ? { color: tone, background: tint(tone), ...style } : style}
      {...props}
    />
  );
}
