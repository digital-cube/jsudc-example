import { ToggleGroup } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Tip } from "./tooltip";

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  testId?: string;
  /** Shown, not choosable; `tooltip` says why. */
  disabled?: boolean;
  tooltip?: string;
}

/** A single-choice segmented control (pages | infinite, table | cards, en | sr). */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
  className,
  "data-testid": testId,
}: {
  value: V;
  onChange: (v: V) => void;
  options: readonly SegmentedOption<V>[];
  "aria-label": string;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as V)}
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn("inline-flex h-8 items-center gap-0.5 rounded-md bg-muted p-0.5", className)}
    >
      {options.map((o) => {
        const item = (
          <ToggleGroup.Item
            key={o.value}
            value={o.value}
            data-testid={o.testId}
            disabled={o.disabled}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium text-muted-foreground transition-colors",
              "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "data-[state=on]:bg-surface data-[state=on]:text-foreground data-[state=on]:shadow-sm",
              "disabled:pointer-events-none disabled:opacity-45",
              "[&_svg]:size-3.5",
            )}
          >
            {o.label}
          </ToggleGroup.Item>
        );
        // A disabled button gets no pointer events: the tooltip hangs on a wrapper.
        return o.tooltip ? (
          <Tip key={o.value} label={o.tooltip}>
            <span className="inline-flex">{item}</span>
          </Tip>
        ) : (
          item
        );
      })}
    </ToggleGroup.Root>
  );
}
