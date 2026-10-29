import { Slot } from "radix-ui";
import { type ComponentProps, forwardRef } from "react";
import { cn } from "../../lib/utils";

const VARIANTS = {
  primary:
    "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:bg-primary/50",
  outline:
    "border border-border-strong/80 bg-surface text-foreground shadow-xs hover:bg-hover hover:border-border-strong",
  ghost: "text-muted-foreground hover:bg-hover hover:text-foreground",
  subtle: "bg-muted text-foreground hover:bg-selected",
  danger:
    "bg-sem-danger text-white shadow-sm hover:bg-sem-danger/90 disabled:bg-sem-danger/50 dark:text-background",
} as const;

const SIZES = {
  sm: "h-7 gap-1.5 rounded-md px-2.5 text-xs",
  md: "h-8 gap-2 rounded-md px-3 text-[13px]",
  icon: "size-8 rounded-md",
  "icon-sm": "size-7 rounded-md",
} as const;

export type ButtonProps = ComponentProps<"button"> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  asChild?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "outline", size = "md", asChild, className, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? "button")}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
});
