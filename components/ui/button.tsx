import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/20",
  {
    variants: {
      variant: {
        outline: "border border-solid border-border bg-card text-foreground hover:bg-hover",
        primary: "border border-solid border-primary bg-primary text-primary-foreground hover:opacity-90",
        ghost: "border-none bg-transparent text-fg-2 hover:bg-hover",
      },
      size: {
        xs: "h-7 px-2.5 text-[12.5px]",
        sm: "h-[30px] px-3",
        md: "h-[34px] px-3",
        lg: "h-9 px-3",
        icon: "h-[34px] w-[34px] p-0",
        "icon-sm": "h-7 w-7 rounded-[7px] p-0",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? "button")}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
