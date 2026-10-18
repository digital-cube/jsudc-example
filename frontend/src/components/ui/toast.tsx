import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { Toast as T } from "radix-ui";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { cn } from "../../lib/utils";

export type ToastVariant = "info" | "success" | "warning" | "danger";

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

const ICON: Record<ToastVariant, ReactNode> = {
  info: <Info className="size-4 text-sem-info" />,
  success: <CheckCircle2 className="size-4 text-sem-success" />,
  warning: <AlertTriangle className="size-4 text-sem-warning" />,
  danger: <AlertTriangle className="size-4 text-sem-danger" />,
};

let nextId = 1;

/** Radix toasts, stacked bottom-right. `useToast()` returns the function that shows one. */
export function Toaster({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback((t: ToastInput) => {
    const id = nextId++;
    setItems((prev) => [...prev.slice(-3), { ...t, id }]);
  }, []);
  const remove = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={show}>
      <T.Provider swipeDirection="right" duration={6000}>
        {children}
        {items.map((t) => (
          <T.Root
            key={t.id}
            data-testid="toast"
            data-variant={t.variant ?? "info"}
            onOpenChange={(open) => !open && remove(t.id)}
            className={cn(
              "grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-lg border border-border bg-surface-raised p-3 pr-2 shadow-lg shadow-black/10 dark:shadow-black/40",
              "data-[state=open]:animate-in data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]",
            )}
          >
            <span className="mt-0.5">{ICON[t.variant ?? "info"]}</span>
            <div className="min-w-0">
              <T.Title className="text-[13px] font-semibold">{t.title}</T.Title>
              {t.description ? (
                <T.Description className="mt-0.5 text-xs text-muted-foreground">
                  {t.description}
                </T.Description>
              ) : null}
            </div>
            <T.Close
              aria-label="Close"
              className="rounded p-1 text-muted-foreground hover:bg-hover hover:text-foreground"
            >
              <X className="size-3.5" />
            </T.Close>
          </T.Root>
        ))}
        <T.Viewport className="fixed right-0 bottom-0 z-[100] m-0 flex w-[380px] max-w-[100vw] list-none flex-col gap-2 p-4 outline-none" />
      </T.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast needs a <Toaster> above it");
  return useMemo(() => ({ toast: show }), [show]);
}
