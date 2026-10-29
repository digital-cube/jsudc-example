import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { KanbanOptions, Row, SchemaDoc } from "@jsudc/core";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import { useI18n } from "../i18n/i18n";
import { cn } from "../lib/utils";
import { KanbanCard, PendingCard, TONE_DOT } from "./KanbanCard";
import type { AddWhere, Bucket } from "./model";

export const bucketDndId = (id: string) => `bucket:${id}`;
/** The id of a column's card list (dnd-kit's sortable container). */
export const cardsContainerId = (id: string) => `cards:${id}`;

export interface PendingAdd {
  key: number;
  bucketId: string;
  where: AddWhere;
  title: string;
}

export interface KanbanColumnProps {
  bucket: Bucket;
  /** Card ids in column order (during a drag, where the cards are drawn). */
  ids: readonly string[];
  rowById: ReadonlyMap<string, Row>;
  opts: KanbanOptions;
  schema: SchemaDoc;
  readOnly: boolean;
  pending: readonly PendingAdd[];
  onOpen: (row: Row) => void;
  onQuickAdd: (where: AddWhere, title: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

/** Enter commits, Escape cancels; a blank value commits nothing. */
function useTextEntry(commit: (text: string) => void, close: () => void) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const text = e.currentTarget.value.trim();
      if (text) commit(text);
      e.currentTarget.value = "";
    }
  };
}

function QuickAdd({ where, onAdd }: { where: AddWhere; onAdd: (title: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const onKeyDown = useTextEntry(onAdd, () => setOpen(false));
  if (!open) {
    return (
      <button
        type="button"
        data-testid={`kanban-add-${where}`}
        onClick={() => setOpen(true)}
        className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="size-3.5" />
        {t("APP", "KANBAN_ADD_TICKET")}
      </button>
    );
  }
  return (
    <Input
      autoFocus
      data-testid={`kanban-add-input-${where}`}
      placeholder={t("APP", "KANBAN_ADD_PLACEHOLDER")}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!e.currentTarget.value.trim()) setOpen(false);
      }}
    />
  );
}

export function KanbanColumn(props: KanbanColumnProps) {
  const { bucket, ids, rowById, opts, schema, readOnly } = props;
  const { t, intlLocale } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [visible, setVisible] = useState(opts.buckets.max_visible_tickets);
  const sortable = opts.board.buckets_sortable && !readOnly;
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: bucketDndId(bucket.id),
    data: { type: "bucket", bucketId: bucket.id },
    // Always a drop target for cards; draggable only when the board allows it.
    disabled: { draggable: !sortable, droppable: false },
  });
  const onRenameKey = useTextEntry(
    (name) => {
      setRenaming(false);
      if (name !== bucket.label) props.onRename(name);
    },
    () => setRenaming(false),
  );

  const shown = ids.slice(0, visible);
  const hidden = ids.length - shown.length;
  const top = props.pending.filter((p) => p.where === "top");
  const bottom = props.pending.filter((p) => p.where === "bottom");
  const showAdd = opts.buckets.show_add_ticket_button && !readOnly;

  return (
    <section
      ref={setNodeRef}
      data-testid="kanban-column"
      data-bucket-id={bucket.id}
      data-bucket-name={bucket.label}
      data-count={ids.length}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        width: opts.buckets.min_width_px,
        minWidth: opts.buckets.min_width_px,
      }}
      className={cn(
        "flex max-h-full shrink-0 flex-col rounded-xl border border-border/80 bg-muted/45 dark:bg-muted/30",
        isDragging && "opacity-50",
      )}
    >
      <header
        ref={setActivatorNodeRef}
        {...(sortable ? { ...attributes, ...listeners } : {})}
        data-testid="kanban-column-header"
        className={cn(
          "flex h-11 shrink-0 items-center gap-2 rounded-t-xl pr-1.5 pl-3 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          sortable && "cursor-grab active:cursor-grabbing",
        )}
      >
        <span
          aria-hidden
          className={cn("size-2.5 shrink-0 rounded-full", TONE_DOT[bucket.color ?? "default"])}
        />
        {renaming ? (
          <Input
            autoFocus
            data-testid="kanban-rename-input"
            defaultValue={bucket.label}
            className="h-7"
            onKeyDown={onRenameKey}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={() => setRenaming(false)}
          />
        ) : (
          <h3
            data-testid="kanban-column-name"
            className="min-w-0 truncate text-[13px] font-semibold tracking-tight"
            title={bucket.label}
            onDoubleClick={readOnly ? undefined : () => setRenaming(true)}
          >
            {bucket.label}
          </h3>
        )}
        {opts.buckets.show_count && !renaming ? (
          <span
            data-testid="kanban-column-count"
            className="rounded-full bg-surface px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums ring-1 ring-border"
          >
            {new Intl.NumberFormat(intlLocale).format(ids.length)}
          </span>
        ) : null}
        <span className="flex-1" />
        {readOnly ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="kanban-column-menu"
                aria-label={t("APP", "KANBAN_BUCKET_MENU", { name: bucket.label })}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem data-testid="kanban-rename" onSelect={() => setRenaming(true)}>
                <Pencil />
                {t("APP", "KANBAN_RENAME")}
              </DropdownMenuItem>
              <DropdownMenuItem
                tone="danger"
                data-testid="kanban-delete-bucket"
                disabled={ids.length > 0}
                onSelect={props.onDelete}
              >
                <Trash2 />
                {ids.length > 0 ? t("APP", "KANBAN_DELETE_NOT_EMPTY") : t("APP", "KANBAN_DELETE")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {showAdd ? (
        <div className="px-2 pb-1">
          <QuickAdd where="top" onAdd={(title) => props.onQuickAdd("top", title)} />
        </div>
      ) : null}

      <SortableContext
        id={cardsContainerId(bucket.id)}
        items={shown as string[]}
        strategy={verticalListSortingStrategy}
      >
        <div
          data-testid="kanban-column-cards"
          className="scroll-thin flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pt-0.5 pb-2"
        >
          {top.map((p) => (
            <PendingCard key={p.key} title={p.title} />
          ))}
          {shown.map((id) => {
            const row = rowById.get(id);
            return row ? (
              <KanbanCard
                key={id}
                row={row}
                bucketId={bucket.id}
                opts={opts}
                schema={schema}
                readOnly={readOnly}
                onOpen={props.onOpen}
              />
            ) : null;
          })}
          {hidden > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              data-testid="kanban-show-more"
              onClick={() => setVisible((v) => v + opts.buckets.max_visible_tickets)}
            >
              {t("APP", "KANBAN_SHOW_MORE", {
                n: new Intl.NumberFormat(intlLocale).format(hidden),
              })}
            </Button>
          ) : null}
          {ids.length === 0 && props.pending.length === 0 ? (
            <div className="grid h-16 place-items-center rounded-lg border border-dashed border-border text-xs text-muted-foreground/80">
              {t("APP", "KANBAN_EMPTY_COLUMN")}
            </div>
          ) : null}
          {bottom.map((p) => (
            <PendingCard key={p.key} title={p.title} />
          ))}
        </div>
      </SortableContext>

      {showAdd ? (
        <div className="border-t border-border/60 px-2 py-1.5">
          <QuickAdd where="bottom" onAdd={(title) => props.onQuickAdd("bottom", title)} />
        </div>
      ) : null}
    </section>
  );
}

/** The `+ Add bucket` slot after the last column. */
export function AddBucketSlot({ onAdd }: { onAdd: (name: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const onKeyDown = useTextEntry(
    (name) => {
      onAdd(name);
      setOpen(false);
    },
    () => setOpen(false),
  );
  return (
    <div className="w-64 shrink-0">
      {open ? (
        <Input
          autoFocus
          data-testid="kanban-add-bucket-input"
          placeholder={t("APP", "KANBAN_ADD_BUCKET_PLACEHOLDER")}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
        />
      ) : (
        <button
          type="button"
          data-testid="kanban-add-bucket"
          onClick={() => setOpen(true)}
          className="flex h-11 w-full items-center gap-1.5 rounded-xl border border-dashed border-border-strong/70 px-3 text-[13px] font-medium text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-4" />
          {t("APP", "KANBAN_ADD_BUCKET")}
        </button>
      )}
    </div>
  );
}
