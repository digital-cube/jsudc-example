import { type ComponentProps, forwardRef } from "react";
import { cn } from "../../lib/utils";

export const inputClass = cn(
  "h-8 w-full min-w-0 rounded-md border border-input bg-surface px-2.5 text-[13px] text-foreground shadow-xs",
  "placeholder:text-muted-foreground/80 transition-[border-color,box-shadow]",
  "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "[&::-webkit-inner-spin-button]:opacity-40",
);

export const Input = forwardRef<HTMLInputElement, ComponentProps<"input">>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(inputClass, className)} {...props} />;
});

/** A native select styled like the inputs: keyboard and test friendly. */
export const NativeSelect = forwardRef<HTMLSelectElement, ComponentProps<"select">>(
  function NativeSelect({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          inputClass,
          "appearance-none bg-[length:14px] bg-[right_8px_center] bg-no-repeat pr-7",
          "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);
