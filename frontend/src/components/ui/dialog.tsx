import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { type ComponentProps, forwardRef, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

/** A centred Radix dialog over a dimmed backdrop, with a title row and a close button. */
export const DialogContent = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof D.Content> & { title: ReactNode; description?: ReactNode }
>(function DialogContent({ className, title, description, children, ...props }, ref) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/35 data-[state=open]:animate-[overlay-in_140ms_ease-out] dark:bg-black/55" />
      <D.Content
        ref={ref}
        className={cn(
          "fixed top-[12vh] left-1/2 z-50 flex max-h-[80vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 flex-col rounded-xl border border-border bg-surface-raised text-foreground shadow-2xl shadow-black/15 outline-none",
          "data-[state=open]:animate-in dark:shadow-black/50",
          className,
        )}
        {...(description ? {} : { "aria-describedby": undefined })}
        {...props}
      >
        <div className="flex items-start gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <D.Title className="text-[15px] font-semibold tracking-tight">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 text-[13px] text-muted-foreground">
                {description}
              </D.Description>
            ) : null}
          </div>
          <D.Close
            aria-label="Close"
            className="-mr-1.5 rounded-md p-1 text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
});

/** The scrolling middle of a dialog. */
export function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("scroll-thin min-h-0 overflow-y-auto px-5 pb-4", className)} {...props} />
  );
}

/** The button row at the bottom of a dialog. */
export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 rounded-b-xl border-t border-border bg-muted/50 px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}
