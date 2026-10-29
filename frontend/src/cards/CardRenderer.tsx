import type { ColumnColor, DescribeResponse, Row } from "@jsudc/core";
import { useEffect, useMemo, useRef } from "react";
import { Skeleton, Spinner } from "../components/ui/misc";
import { FolderEntry } from "../data-view/FolderEntry";
import { tableSection, useI18n } from "../i18n/i18n";
import { cn } from "../lib/utils";
import type { FolderNav } from "../renderers/types";
import { CellValue, displayText, isBlank, renderKind } from "../table/cells";
import { Pager } from "../table/Pager";
import { Sparkline } from "../table/sparkline";
import { EmptyState, ErrorState } from "../table/states";
import { resolveRowColor } from "../table/style";
import { useInfiniteSentinel } from "../table/useInfiniteSentinel";
import { useTimezone } from "../time/timezone";
import type { UdcCollectionResult } from "../udc/hooks";
import type { PagingMode } from "../udc/keys";
import {
  avatarTone,
  CARD_MIN_WIDTH,
  type CardSlots,
  cardSlots,
  initials,
  metricText,
} from "./cardModel";

/** The `row_color` accent bar on the left edge. Literal classes so Tailwind sees them. */
const ACCENT_BAR: Record<ColumnColor, string> = {
  default: "bg-border-strong",
  accent: "bg-sem-accent",
  success: "bg-sem-success",
  warning: "bg-sem-warning",
  danger: "bg-sem-danger",
  info: "bg-sem-info",
  muted: "bg-sem-muted/60",
};

const AVATAR: Record<ColumnColor, string> = {
  default: "bg-muted text-muted-foreground",
  accent: "bg-sem-accent-bg text-sem-accent",
  success: "bg-sem-success-bg text-sem-success",
  warning: "bg-sem-warning-bg text-sem-warning",
  danger: "bg-sem-danger-bg text-sem-danger",
  info: "bg-sem-info-bg text-sem-info",
  muted: "bg-sem-muted-bg text-sem-muted",
};

const SKELETON_CARDS = 12;

export interface CardRendererProps {
  collection: string;
  describe: DescribeResponse;
  data: UdcCollectionResult;
  mode: PagingMode;
  page: number;
  limit: number;
  onPage: (page: number) => void;
  filtered: boolean;
  onClearFilters: () => void;
  /** Changes whenever the cards are a different query; scrolls back to the top. */
  resetKey: string;
  /** A folder listing: a folder card opens the folder, a file card its preview. */
  folder?: FolderNav | undefined;
}

/**
 * The rows as a responsive grid of cards, from `view.card_options`. Same
 * data, paging and states as the table; read-only in phase 1.
 */
export function CardRenderer(props: CardRendererProps) {
  const { collection, describe, data, mode } = props;
  const { view } = describe;
  const { t, intlLocale } = useI18n();
  const slots = useMemo(() => cardSlots(view), [view]);
  const section = tableSection(collection);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useInfiniteSentinel(mode === "infinite", scrollRef, sentinelRef, data);

  useEffect(() => {
    if (props.resetKey && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [props.resetKey]);

  const showSkeleton = data.isLoading && data.rows.length === 0;
  const showError = data.error !== null && data.rows.length === 0;
  const showEmpty = !showSkeleton && !showError && data.rows.length === 0;
  const total = data.total ?? data.rows.length;
  const grid = {
    gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${CARD_MIN_WIDTH[slots.size]}px), 1fr))`,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        data-testid="cards-scroll"
        className="scroll-thin relative min-h-0 flex-1 overflow-auto bg-background/60"
      >
        {data.isFetching && !data.isLoading && !data.isFetchingNextPage ? (
          <div className="pointer-events-none sticky top-0 z-30 h-0">
            <div className="h-0.5 w-full overflow-hidden bg-primary/15">
              <div className="h-full w-1/3 animate-[shimmer_1s_linear_infinite] bg-primary/70" />
            </div>
          </div>
        ) : null}

        {showSkeleton || data.rows.length > 0 ? (
          <div
            data-testid="card-grid"
            data-size={slots.size}
            aria-busy={data.isFetching}
            className="grid gap-3 p-4"
            style={grid}
          >
            {showSkeleton
              ? Array.from({ length: SKELETON_CARDS }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
                  <SkeletonCard key={i} meta={slots.meta.length} seed={i} />
                ))
              : data.rows.map((row) => (
                  <Card
                    key={row.__meta.id}
                    row={row}
                    slots={slots}
                    describe={describe}
                    section={section}
                    accent={resolveRowColor(row, view.row_color)}
                    folder={props.folder}
                  />
                ))}
          </div>
        ) : null}

        {showError && data.error ? <ErrorState error={data.error} onRetry={data.refetch} /> : null}
        {showEmpty ? <EmptyState filtered={props.filtered} onClear={props.onClearFilters} /> : null}

        {mode === "infinite" && data.rows.length > 0 ? (
          <div
            data-testid="infinite-footer"
            className="flex h-12 items-center justify-center gap-2 text-xs text-muted-foreground"
          >
            {data.isFetchingNextPage ? (
              <>
                <Spinner />
                {t("APP", "LOADING_MORE")}
              </>
            ) : data.hasNextPage ? null : (
              t("APP", "ALL_LOADED", { total: new Intl.NumberFormat(intlLocale).format(total) })
            )}
          </div>
        ) : null}
        <div ref={sentinelRef} data-testid="infinite-sentinel" className="h-px" />
      </div>

      {mode === "pages" && !showError && (data.total ?? 0) > 0 ? (
        <Pager
          page={props.page}
          limit={props.limit}
          total={data.total ?? 0}
          onPage={props.onPage}
        />
      ) : null}
    </div>
  );
}

function Card({
  row,
  slots,
  describe,
  section,
  accent,
  folder,
}: {
  row: Row;
  slots: CardSlots;
  describe: DescribeResponse;
  section: string;
  accent: ReturnType<typeof resolveRowColor>;
  folder?: FolderNav | undefined;
}) {
  const { t, locale, intlLocale } = useI18n();
  const { timeZone } = useTimezone();
  const { schema } = describe;
  const text = (col: CardSlots["title"]) => {
    const v = row[col.field];
    if (isBlank(v)) return "";
    const kind = renderKind(col, schema.fields[col.field]);
    return displayText(v, col, kind, locale, intlLocale, timeZone);
  };
  const title = text(slots.title);
  const subtitle = slots.subtitle ? text(slots.subtitle) : "";
  const image = slots.image ? row[slots.image] : null;
  const hasImage = typeof image === "string" && image !== "";
  const cover = hasImage && slots.imageStyle === "cover";
  const tone = accent?.color ?? accent?.bg;

  return (
    <article
      data-testid="card"
      data-row-id={row.__meta.id}
      data-accent={tone ?? undefined}
      className={cn(
        "group/card relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xs shadow-black/[0.03]",
        "transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md hover:shadow-black/[0.06] dark:hover:shadow-black/40",
      )}
    >
      {tone && tone !== "default" ? (
        <span
          aria-hidden
          data-testid="card-accent"
          className={cn("absolute inset-y-0 left-0 w-[3px]", ACCENT_BAR[tone])}
        />
      ) : null}
      {cover ? (
        <img
          src={image as string}
          alt=""
          loading="lazy"
          data-testid="card-cover"
          className="aspect-[16/9] w-full border-b border-border bg-muted object-cover"
        />
      ) : null}
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-3">
        {hasImage && !cover ? (
          <img
            src={image as string}
            alt=""
            loading="lazy"
            data-testid="card-image-avatar"
            className="size-9 shrink-0 rounded-full border border-border bg-muted object-cover"
          />
        ) : null}
        {hasImage ? null : (
          <span
            aria-hidden
            data-testid="card-avatar"
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg text-[13px] font-semibold tracking-tight",
              AVATAR[avatarTone(title)],
            )}
          >
            {initials(title)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3
            data-testid="card-title"
            className="truncate text-sm leading-5 font-semibold tracking-tight"
            title={title}
          >
            {folder ? (
              <FolderEntry row={row} nav={folder}>
                <span className="truncate">{title}</span>
              </FolderEntry>
            ) : (
              title || <span className="text-muted-foreground/60">—</span>
            )}
          </h3>
          {slots.subtitle ? (
            <p
              data-testid="card-subtitle"
              className="truncate text-xs leading-4 text-muted-foreground tabular-nums"
            >
              {subtitle ? (
                <>
                  <span className="text-muted-foreground/70">
                    {t(section, slots.subtitle.field)}
                  </span>{" "}
                  {subtitle}
                </>
              ) : (
                "—"
              )}
            </p>
          ) : null}
        </div>
      </div>
      {slots.metric ? (
        <div
          data-testid="card-metric"
          className="flex items-baseline justify-between gap-3 border-t border-border/70 px-4 py-2.5"
        >
          <span className="text-xs text-muted-foreground">
            {slots.metric.label ?? t(section, slots.metric.field)}
          </span>
          <span
            data-testid="card-metric-value"
            className="text-xl leading-7 font-semibold tracking-tight tabular-nums"
          >
            {metricText(row[slots.metric.field], slots.metric, intlLocale) ?? (
              <span className="text-muted-foreground/50">—</span>
            )}
          </span>
        </div>
      ) : null}
      {slots.meta.length ? (
        <dl className="mt-auto flex flex-col border-t border-border/70 px-4 py-2">
          {slots.meta.map((col) => (
            <div
              key={col.field}
              data-testid={`card-meta-${col.field}`}
              className="flex min-h-7 min-w-0 items-center justify-between gap-3 border-b border-dashed border-border/80 py-1 last:border-b-0"
            >
              <dt className="shrink-0 text-xs text-muted-foreground">{t(section, col.field)}</dt>
              <dd className="flex min-w-0 items-center justify-end text-right text-[13px] font-medium">
                <CellValue
                  value={row[col.field]}
                  column={col}
                  def={schema.fields[col.field]}
                  locale={locale}
                  intlLocale={intlLocale}
                />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {slots.sparkline ? (
        <div data-testid="card-sparkline" className="border-t border-border/70 px-4 py-2.5">
          <Sparkline
            value={row[slots.sparkline.field]}
            width={slots.sparkline.width}
            height={slots.sparkline.height}
            format={(n) =>
              slots.metric ? (metricText(n, slots.metric, intlLocale) ?? "") : String(n)
            }
            className="h-auto max-w-full"
          />
        </div>
      ) : null}
    </article>
  );
}

function SkeletonCard({ meta, seed }: { meta: number; seed: number }) {
  return (
    <div
      data-testid="skeleton-card"
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-3">
        <Skeleton className="size-9 rounded-lg" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3.5" style={{ width: `${55 + ((seed * 17) % 35)}%` }} />
          <Skeleton className="h-2.5 w-1/3" />
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-border/70 px-4 py-3.5">
        {Array.from({ length: Math.max(2, meta) }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
          <div key={i} className="flex items-center justify-between gap-6">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-3" style={{ width: `${20 + ((seed + i * 11) % 35)}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
