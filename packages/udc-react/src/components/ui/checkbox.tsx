import { Check, Minus } from "lucide-react";
import { Checkbox as C } from "radix-ui";
import { type ComponentProps, forwardRef } from "react";
import { cn } from "../../lib/utils";

export const Checkbox = forwardRef<HTMLButtonElement, ComponentProps<typeof C.Root>>(
  function Checkbox({ className, ...props }, ref) {
    return (
      <C.Root
        ref={ref}
        className={cn(
          "peer grid size-4 shrink-0 place-items-center rounded-[4px] border border-border-strong bg-surface shadow-xs transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
          "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
          className,
        )}
        {...props}
      >
        <C.Indicator>
          {props.checked === "indeterminate" ? (
            <Minus className="size-3" strokeWidth={3} />
          ) : (
            <Check className="size-3" strokeWidth={3} />
          )}
        </C.Indicator>
      </C.Root>
    );
  },
);
