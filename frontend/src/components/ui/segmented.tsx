import { ToggleGroup } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  testId?: string;
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
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          data-testid={o.testId}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium text-muted-foreground transition-colors",
            "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "data-[state=on]:bg-surface data-[state=on]:text-foreground data-[state=on]:shadow-sm",
            "[&_svg]:size-3.5",
          )}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
