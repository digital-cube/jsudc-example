import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ColumnColor, KanbanOptions, Row, SchemaDoc } from "@jsudc/core";
import { CalendarDays } from "lucide-react";
import type { CSSProperties, KeyboardEvent } from "react";
import { avatarTone, initials } from "../cards/cardModel";
import { Spinner } from "../components/ui/misc";
import { useI18n } from "../i18n/i18n";
import { cn } from "../lib/utils";
import { formatDate } from "../table/cells";
import { isOverdue, priorityTone } from "./model";

/** Literal classes, so Tailwind sees them. */
export const TONE_BORDER: Record<ColumnColor, string> = {
  default: "border-l-border-strong",
  accent: "border-l-sem-accent",
  success: "border-l-sem-success",
  warning: "border-l-sem-warning",
  danger: "border-l-sem-danger",
  info: "border-l-sem-info",
  muted: "border-l-sem-muted/60",
};

export const TONE_DOT: Record<ColumnColor, string> = {
  default: "bg-border-strong",
  accent: "bg-sem-accent",
  success: "bg-sem-success",
  warning: "bg-sem-warning",
  danger: "bg-sem-danger",
  info: "bg-sem-info",
  muted: "bg-sem-muted",
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

const MAX_AVATARS = 3;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];

const clamp = (lines: number): CSSProperties => ({
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: lines,
  overflow: "hidden",
});

export interface KanbanCardBodyProps {
  row: Row;
  opts: KanbanOptions;
  schema: SchemaDoc;
}

/** What a card shows; the sortable wrapper and the drag overlay both draw it. */
export function KanbanCardBody({ row, opts, schema }: KanbanCardBodyProps) {
  const { t, intlLocale } = useI18n();
  const { card, cards } = opts;
  const title = String(row[card.title_field] ?? "");
  const body = card.body_field ? row[card.body_field] : null;
  const priority = card.priority_field ? row[card.priority_field] : null;
  const tone = card.priority_field
    ? priorityTone(priority, schema.fields[card.priority_field])
    : null;
  const tags = card.tags_field ? strings(row[card.tags_field]) : [];
  const shownTags = tags.slice(0, cards.tags_max_visible);
  const due = card.due_field ? row[card.due_field] : null;
  const overdue = isOverdue(due);
  const people = card.assignees_field ? strings(row[card.assignees_field]) : [];
  const footer = (card.footer_fields ?? [])
    .map((f) => row[f])
    .filter((v) => v !== null && v !== undefined && v !== "");
  const compact = cards.density === "compact";

  return (
    <div className={cn("flex flex-col", compact ? "gap-1.5 px-2.5 py-2" : "gap-2 px-3 py-2.5")}>
      <div className="flex items-start gap-2">
        {tone ? (
          <span
            aria-hidden
            data-testid="kanban-priority-dot"
            className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE_DOT[tone])}
          />
        ) : null}
        <h4
          data-testid="kanban-card-title"
          className="min-w-0 flex-1 text-[13px] leading-5 font-medium break-words"
          style={clamp(cards.title_lines)}
          title={title}
        >
          {title || <span className="text-muted-foreground/60">—</span>}
        </h4>
      </div>
      {typeof body === "string" && body && cards.body_lines > 0 ? (
        <p
          data-testid="kanban-card-body"
          className="text-xs leading-[1.35rem] text-muted-foreground"
          style={clamp(cards.body_lines)}
        >
          {body}
        </p>
      ) : null}
      {shownTags.length ? (
        <div className="flex flex-wrap gap-1" data-testid="kanban-card-tags">
          {shownTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex h-5 items-center rounded-full border border-border bg-muted/60 px-2 text-[11px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
          {tags.length > shownTags.length ? (
            <span className="inline-flex h-5 items-center px-1 text-[11px] text-muted-foreground">
              +{tags.length - shownTags.length}
            </span>
          ) : null}
        </div>
      ) : null}
      {due || people.length || footer.length ? (
        <div className="flex min-h-6 items-center gap-2 text-[11px] text-muted-foreground">
          {footer.length ? (
            <span className="truncate font-mono tabular-nums" data-testid="kanban-card-footer">
              {footer.map(String).join(" · ")}
            </span>
          ) : null}
          {typeof due === "string" && due ? (
            <span
              data-testid="kanban-card-due"
              data-overdue={overdue || undefined}
              title={overdue ? t("APP", "KANBAN_OVERDUE") : undefined}
              className={cn(
                "inline-flex items-center gap-1 tabular-nums",
                overdue && "font-medium text-sem-danger",
              )}
            >
              <CalendarDays className="size-3" />
              {formatDate(due, intlLocale)}
            </span>
          ) : null}
          {people.length ? (
            <span className="ml-auto flex -space-x-1" data-testid="kanban-card-assignees">
              {people.slice(0, MAX_AVATARS).map((name) => (
                <span
                  key={name}
                  title={name}
                  className={cn(
                    "grid size-6 place-items-center rounded-full text-[10px] font-semibold ring-2 ring-surface",
                    AVATAR[avatarTone(name)],
                  )}
                >
                  {initials(name)}
                </span>
              ))}
              {people.length > MAX_AVATARS ? (
                <span
                  title={people.slice(MAX_AVATARS).join(", ")}
                  className="grid size-6 place-items-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-2 ring-surface"
                >
                  +{people.length - MAX_AVATARS}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function cardShellClass(tone: ColumnColor | null, opts: KanbanOptions): string {
  return cn(
    "block w-full rounded-lg border border-border bg-surface text-left shadow-xs shadow-black/[0.04]",
    opts.cards.show_priority_left_border && tone && cn("border-l-[3px]", TONE_BORDER[tone]),
  );
}

export function KanbanCard({
  row,
  bucketId,
  opts,
  schema,
  readOnly,
  onOpen,
}: KanbanCardBodyProps & { bucketId: string; readOnly: boolean; onOpen: (row: Row) => void }) {
  const id = row.__meta.id;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { type: "card", bucketId },
    disabled: readOnly,
  });
  const tone = opts.card.priority_field
    ? priorityTone(row[opts.card.priority_field], schema.fields[opts.card.priority_field])
    : null;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    listeners?.onKeyDown?.(e);
    if (e.key === "Enter" && !e.defaultPrevented) onOpen(row);
  };
  return (
    // A div, not a button: the card holds headings and paragraphs. dnd-kit's
    // `attributes` give it the sortable description.
    // biome-ignore lint/a11y/useSemanticElements: a <button> cannot hold the card's headings
    <div
      ref={setNodeRef}
      data-testid="kanban-card"
      data-card-id={id}
      data-bucket-id={bucketId}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      role="button"
      // Focusable even when read-only (no drag), so Enter still opens the card.
      tabIndex={0}
      onClick={() => onOpen(row)}
      className={cn(
        cardShellClass(tone, opts),
        "outline-none transition-[box-shadow,border-color] hover:border-border-strong hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring",
        readOnly ? "cursor-pointer" : "cursor-grab touch-manipulation active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      <KanbanCardBody row={row} opts={opts} schema={schema} />
    </div>
  );
}

/** A quick-added card until the server row arrives. */
export function PendingCard({ title }: { title: string }) {
  return (
    <div
      data-testid="kanban-pending-card"
      className="flex items-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface/60 px-3 py-2.5 text-[13px] text-muted-foreground"
    >
      <Spinner className="size-3" />
      <span className="truncate">{title}</span>
    </div>
  );
}
