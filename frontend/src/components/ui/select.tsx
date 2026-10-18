import { Check, ChevronDown } from "lucide-react";
import { Select as S } from "radix-ui";
import { cn } from "../../lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

/** A Radix select with the input look. `value` must not be "" (Radix reserves it). */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: {
  value: string | undefined;
  onValueChange: (v: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  return (
    <S.Root {...(value ? { value } : {})} onValueChange={onValueChange}>
      <S.Trigger
        aria-label={ariaLabel}
        data-testid={testId}
        className={cn(
          "inline-flex h-8 w-full min-w-0 items-center justify-between gap-1 rounded-md border border-input bg-surface px-2.5 text-left text-[13px] shadow-xs",
          "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20",
          "data-[placeholder]:text-muted-foreground",
          className,
        )}
      >
        <span className="truncate">
          <S.Value placeholder={placeholder} />
        </span>
        <S.Icon>
          <ChevronDown className="size-3.5 opacity-60" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          className="z-[60] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg shadow-black/5 data-[state=open]:animate-in dark:shadow-black/40"
        >
          <S.Viewport className="scroll-thin p-1">
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                className="relative flex h-7 cursor-default select-none items-center rounded-md pr-2 pl-7 text-[13px] outline-none data-[highlighted]:bg-hover data-[state=checked]:font-medium"
              >
                <S.ItemIndicator className="absolute left-2 inline-flex">
                  <Check className="size-3.5 text-primary" />
                </S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
