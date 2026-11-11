import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-[12px] border border-solid border-border bg-card shadow-card", className)}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export function CardHeader({
  title,
  description,
  actions,
  className,
  descriptionClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  descriptionClassName?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 px-5 pt-[18px]", className)}>
      <div>
        <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em] text-foreground">{title}</h3>
        {description != null && (
          <div className={cn("mt-[3px] text-[13px] text-muted-foreground", descriptionClassName)}>{description}</div>
        )}
      </div>
      {actions}
    </div>
  );
}
