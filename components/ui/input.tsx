import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-8 w-full rounded-[8px] border border-solid border-input bg-transparent px-2.5 text-[13px] text-foreground outline-none focus:border-border-strong focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--brand)_18%,transparent)]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export function SearchInput({
  className,
  wrapperClassName,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { wrapperClassName?: string }) {
  return (
    <div className={cn("relative", wrapperClassName)}>
      <span className="pointer-events-none absolute left-2.5 top-[9px] text-muted-foreground">
        <Search size={14} className="block" />
      </span>
      <Input className={cn("pl-8", className)} {...props} />
    </div>
  );
}
