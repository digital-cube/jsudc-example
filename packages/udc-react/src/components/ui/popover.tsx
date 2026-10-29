import { Popover as P } from "radix-ui";
import { type ComponentProps, forwardRef } from "react";
import { cn } from "../../lib/utils";

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverClose = P.Close;
export const PopoverAnchor = P.Anchor;

export const PopoverContent = forwardRef<HTMLDivElement, ComponentProps<typeof P.Content>>(
  function PopoverContent({ className, align = "start", sideOffset = 6, ...props }, ref) {
    return (
      <P.Portal>
        <P.Content
          ref={ref}
          align={align}
          sideOffset={sideOffset}
          className={cn(
            "z-50 rounded-lg border border-border bg-surface-raised p-3 text-foreground shadow-lg shadow-black/5 outline-none",
            "data-[state=open]:animate-in dark:shadow-black/40",
            className,
          )}
          {...props}
        />
      </P.Portal>
    );
  },
);
