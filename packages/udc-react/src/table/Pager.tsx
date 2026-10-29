import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../components/ui/button";
import { Tip } from "../components/ui/tooltip";
import { useI18n } from "../i18n/i18n";
import { cn } from "../lib/utils";

/** Page numbers to show: first, last, and a window around the current one; `null` is a gap. */
export function pageWindow(page: number, pages: number, radius = 1): (number | null)[] {
  const out: (number | null)[] = [];
  for (let p = 1; p <= pages; p++) {
    const keep = p === 1 || p === pages || Math.abs(p - page) <= radius;
    // A gap of exactly one page shows that page rather than an ellipsis.
    const bridge =
      (p === 2 && page - radius === 3) || (p === pages - 1 && page + radius === pages - 2);
    if (keep || bridge) out.push(p);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
}

export function Pager({
  page,
  limit,
  total,
  onPage,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { t, intlLocale } = useI18n();
  const pages = Math.max(1, Math.ceil(total / limit));
  const fmt = (n: number) => new Intl.NumberFormat(intlLocale).format(n);
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);

  const nav = (label: string, target: number, disabled: boolean, icon: ReactNode, id: string) => (
    <Tip label={label}>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={label}
        data-testid={`pager-${id}`}
        disabled={disabled}
        onClick={() => onPage(target)}
      >
        {icon}
      </Button>
    </Tip>
  );

  return (
    <nav
      aria-label={t("APP", "PAGING")}
      data-testid="pager"
      className="flex h-11 shrink-0 items-center justify-between gap-4 border-t border-border bg-surface px-3 text-xs text-muted-foreground"
    >
      <div className="tabular-nums">
        {t("APP", "SHOWING_RANGE", { from: fmt(from), to: fmt(to), total: fmt(total) })}
        <span className="mx-2 text-border-strong">·</span>
        {t("APP", "PER_PAGE", { n: limit })}
      </div>
      <div className="flex items-center gap-0.5">
        {nav(t("APP", "PAGE_FIRST"), 1, page <= 1, <ChevronsLeft />, "first")}
        {nav(t("APP", "PAGE_PREV"), page - 1, page <= 1, <ChevronLeft />, "prev")}
        {pageWindow(page, pages).map((p, i) =>
          p === null ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: gaps have no identity
            <span key={`gap-${i}`} className="w-7 text-center">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              data-testid={`pager-page-${p}`}
              aria-current={p === page ? "page" : undefined}
              onClick={() => onPage(p)}
              className={cn(
                "h-7 min-w-7 rounded-md px-1.5 text-xs font-medium tabular-nums transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                p === page
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-foreground hover:bg-hover",
              )}
            >
              {p}
            </button>
          ),
        )}
        {nav(t("APP", "PAGE_NEXT"), page + 1, page >= pages, <ChevronRight />, "next")}
        {nav(t("APP", "PAGE_LAST"), pages, page >= pages, <ChevronsRight />, "last")}
      </div>
      <div className="tabular-nums" data-testid="pager-status">
        {t("APP", "PAGE_OF", { page, pages })}
      </div>
    </nav>
  );
}
