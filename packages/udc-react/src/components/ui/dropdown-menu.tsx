import { DropdownMenu as M } from "radix-ui";
import { type ComponentProps, forwardRef } from "react";
import { cn } from "../../lib/utils";

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;

export const DropdownMenuContent = forwardRef<HTMLDivElement, ComponentProps<typeof M.Content>>(
  function DropdownMenuContent({ className, align = "end", sideOffset = 4, ...props }, ref) {
    return (
      <M.Portal>
        <M.Content
          ref={ref}
          align={align}
          sideOffset={sideOffset}
          className={cn(
            "z-50 min-w-48 rounded-lg border border-border bg-surface-raised p-1 text-foreground shadow-lg shadow-black/5 outline-none",
            "data-[state=open]:animate-in dark:shadow-black/40",
            className,
          )}
          {...props}
        />
      </M.Portal>
    );
  },
);

export const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof M.Item> & { tone?: "default" | "danger" }
>(function DropdownMenuItem({ className, tone = "default", ...props }, ref) {
  return (
    <M.Item
      ref={ref}
      className={cn(
        "flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-[13px] outline-none [&_svg]:size-4 [&_svg]:shrink-0",
        tone === "danger"
          ? "text-sem-danger data-[highlighted]:bg-sem-danger-bg"
          : "data-[highlighted]:bg-hover [&_svg]:text-muted-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <M.Separator className={cn("my-1 h-px bg-border", className)} />;
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof M.Label>) {
  return (
    <M.Label
      className={cn("px-2 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}
