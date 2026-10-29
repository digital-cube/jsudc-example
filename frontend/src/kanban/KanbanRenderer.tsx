import {
  type CollisionDetection,
  closestCenter,
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import {
  detectCollision,
  isVersionConflict,
  type KanbanOptions,
  orderBetween,
  type Row,
} from "@jsudc/core";
import { useQueryClient } from "@tanstack/react-query";
import { KanbanSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "../components/ui/misc";
import { useToast } from "../components/ui/toast";
import { useI18n } from "../i18n/i18n";
import { AllRowsStatus } from "../renderers/AllRowsStatus";
import type { RendererProps } from "../renderers/types";
import { EmptyState, ErrorState } from "../table/states";
import { useUdcAllRows, useUdcCollection, useUdcMutate } from "../udc/hooks";
import { udcKeys } from "../udc/keys";
import { useUdcClient } from "../udc/provider";
import { CardDetailDialog } from "./CardDetailDialog";
import { cardShellClass, KanbanCardBody } from "./KanbanCard";
import {
  AddBucketSlot,
  bucketDndId,
  cardsContainerId,
  KanbanColumn,
  type PendingAdd,
} from "./KanbanColumn";
import {
  type AddWhere,
  boardFilter,
  bucketsOf,
  cardsFilter,
  type DropPlan,
  groupCards,
  isReadOnly,
  newBucketRow,
  orderOf,
  type PendingMove,
  planDrop,
  priorityTone,
  quickAddRow,
} from "./model";
import { persistOrder } from "./persist";
import { useKanbanBoard } from "./useKanbanBoard";

const MAX_BUCKETS = 500;
/** Stable keys for the loading placeholders. */
const SKELETON_COLUMNS = ["s1", "s2", "s3", "s4"];

type Active = { type: "card" | "bucket"; id: string } | null;

const asBucketId = (dndId: string) => (dndId.startsWith("bucket:") ? dndId.slice(7) : null);

/**
 * A dragged column only meets other columns. A dragged card meets the card
 * under the pointer, else what is nearest (the keyboard has no pointer); when
 * that is a column holding cards, the nearest of its cards instead, so a
 * drop always lands next to a card and not just "somewhere in the column".
 */
const collision: CollisionDetection = (args) => {
  if (args.active.data.current?.type === "bucket") {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (c) => c.data.current?.type === "bucket",
      ),
    });
  }
  const within = pointerWithin(args);
  const hits = within.length > 0 ? within : closestCorners(args);
  const card = within.find((c) => !String(c.id).startsWith("bucket:"));
  if (card) return [card];
  const first = hits[0];
  const bucketId = first ? asBucketId(String(first.id)) : null;
  if (!first || !bucketId) return hits;
  const inColumn = args.droppableContainers.filter(
    (c) => c.data.current?.sortable?.containerId === cardsContainerId(bucketId),
  );
  if (inColumn.length === 0) return [first];
  return closestCenter({ ...args, droppableContainers: inColumn });
};

/** The `kanban` tab: buckets as columns, cards in order, drag and drop to move them. */
export function KanbanRenderer(props: RendererProps) {
  const opts = props.describe.view.kanban_options;
  const { t } = useI18n();
  if (!opts) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground" data-testid="kanban-missing">
        {t("APP", "KANBAN_NO_OPTIONS")}
      </div>
    );
  }
  return <Board {...props} opts={opts} />;
}

function Board({
  collection,
  describe,
  filter,
  filtered,
  onClearFilters,
  onCount,
  opts,
}: RendererProps & { opts: KanbanOptions }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const client = useUdcClient();
  const qc = useQueryClient();
  const { schema, capabilities } = describe;
  const readOnly = isReadOnly(opts, capabilities);
  const board = useKanbanBoard(describe);
  const { boardId } = board;

  // --- data ------------------------------------------------------------------
  const bucketsQ = useUdcCollection({
    collection: opts.bucket_collection,
    ...(boardId ? { filter: { field: opts.bucket_filter_field, op: "eq", value: boardId } } : {}),
    sort: [{ field: opts.bucket_order_field }],
    mode: "pages",
    pageLimit: MAX_BUCKETS,
    enabled: boardId !== null,
  });
  const cardsQ = useUdcAllRows({
    collection,
    filter: boardId ? cardsFilter(opts, boardId, filter) : undefined,
    sort: [{ field: opts.ticket_order_field }],
    capabilities,
    enabled: boardId !== null,
    refetchInterval: describe.view.refresh_interval_ms,
  });
  // Every card on the board, whatever the filter: the "of N" in the toolbar.
  const boardTotal = useUdcCollection({
    collection,
    ...(boardId ? { filter: boardFilter(opts, boardId) } : {}),
    mode: "pages",
    pageLimit: 1,
    enabled: boardId !== null,
  });

  useEffect(() => {
    onCount(boardId ? { shown: cardsQ.rows.length, total: boardTotal.total } : null);
  }, [onCount, boardId, cardsQ.rows.length, boardTotal.total]);
  useEffect(() => () => onCount(null), [onCount]);

  // --- what is drawn -------------------------------------------------------------
  const [pendingMoves, setPendingMoves] = useState<ReadonlyMap<string, PendingMove>>(new Map());
  const [pendingBuckets, setPendingBuckets] = useState<ReadonlyMap<string, number>>(new Map());
  const [pendingAdds, setPendingAdds] = useState<PendingAdd[]>([]);
  const addKey = useRef(0);

  const buckets = useMemo(
    () =>
      bucketsOf(
        bucketsQ.rows.map((r) =>
          pendingBuckets.has(r.__meta.id)
            ? { ...r, [opts.bucket_order_field]: pendingBuckets.get(r.__meta.id) }
            : r,
        ),
        opts,
      ),
    [bucketsQ.rows, pendingBuckets, opts],
  );
  const columns = useMemo(
    () => groupCards(cardsQ.rows, buckets, opts, pendingMoves),
    [cardsQ.rows, buckets, opts, pendingMoves],
  );
  const rowById = useMemo(
    () => new Map(Object.values(columns).flatMap((rows) => rows.map((r) => [r.__meta.id, r]))),
    [columns],
  );
  const baseIds = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(columns).map(([b, rows]) => [b, rows.map((r) => r.__meta.id)]),
      ) as Record<string, string[]>,
    [columns],
  );

  const [dragIds, setDragIds] = useState<Record<string, string[]> | null>(null);
  const [active, setActive] = useState<Active>(null);
  const ids = dragIds ?? baseIds;
  const [detailId, setDetailId] = useState<string | null>(null);

  // --- writes ------------------------------------------------------------------------
  const cardMutate = useUdcMutate(collection);
  const bucketMutate = useUdcMutate(opts.bucket_collection);

  const fail = useCallback(
    (err: unknown, title: string) => {
      if (isVersionConflict(err)) {
        toast({
          variant: "warning",
          title: t("APP", "KANBAN_CONFLICT_TITLE"),
          description: t("APP", "KANBAN_CONFLICT_BODY"),
        });
      } else {
        toast({ variant: "danger", title, description: (err as Error).message });
      }
    },
    [toast, t],
  );

  const moveCard = async (plan: DropPlan) => {
    const draw = (order: number) =>
      setPendingMoves((m) => new Map(m).set(plan.id, { bucketId: plan.bucketId, order }));
    draw(plan.order);
    let reindexed = plan.collision;
    try {
      ({ reindexed } = await persistOrder({
        client,
        collection,
        orderField: opts.ticket_order_field,
        scope: { [opts.ticket_bucket_field]: plan.bucketId },
        plan,
        version: rowById.get(plan.id)?.__meta.version,
        patch: plan.moved ? { [opts.ticket_bucket_field]: plan.bucketId } : {},
        mutate: (vars) => cardMutate.mutateAsync(vars),
        onOrder: draw,
      }));
    } catch (err) {
      fail(err, t("APP", "KANBAN_MOVE_FAILED"));
    } finally {
      if (reindexed) await qc.invalidateQueries({ queryKey: udcKeys.lists(collection) });
      setPendingMoves((m) => {
        const next = new Map(m);
        next.delete(plan.id);
        return next;
      });
    }
  };

  const moveBucket = async (id: string, toIndex: number) => {
    if (!boardId) return;
    const others = buckets.filter((b) => b.id !== id);
    const prevB = others[toIndex - 1] ?? null;
    const nextB = others[toIndex] ?? null;
    const prev = prevB?.order ?? null;
    const next = nextB?.order ?? null;
    const plan: DropPlan = {
      id,
      bucketId: id,
      moved: false,
      order: orderBetween(prev, next),
      collision: detectCollision(prev, next),
      prevId: prevB?.id ?? null,
      nextId: nextB?.id ?? null,
    };
    const draw = (order: number) => setPendingBuckets((m) => new Map(m).set(id, order));
    draw(plan.order);
    let reindexed = plan.collision;
    try {
      ({ reindexed } = await persistOrder({
        client,
        collection: opts.bucket_collection,
        orderField: opts.bucket_order_field,
        scope: { [opts.bucket_filter_field]: boardId },
        plan,
        version: buckets.find((b) => b.id === id)?.row.__meta.version,
        patch: {},
        mutate: (vars) => bucketMutate.mutateAsync(vars),
        onOrder: draw,
      }));
    } catch (err) {
      fail(err, t("APP", "KANBAN_MOVE_FAILED"));
    } finally {
      if (reindexed) {
        await qc.invalidateQueries({ queryKey: udcKeys.lists(opts.bucket_collection) });
      }
      setPendingBuckets((m) => {
        const n = new Map(m);
        n.delete(id);
        return n;
      });
    }
  };

  const quickAdd = async (bucketId: string, where: AddWhere, title: string) => {
    if (!boardId) return;
    const key = ++addKey.current;
    setPendingAdds((p) => [...p, { key, bucketId, where, title }]);
    try {
      await cardMutate.mutateAsync({
        op: "insert",
        row: quickAddRow(opts, {
          title,
          boardId,
          bucketId,
          orders: (columns[bucketId] ?? []).map((r) => orderOf(r, opts.ticket_order_field)),
          where,
        }),
      });
    } catch (err) {
      fail(err, t("APP", "KANBAN_ADD_FAILED"));
    } finally {
      // The insert settles after the lists were refetched: the real card is drawn by now.
      setPendingAdds((p) => p.filter((x) => x.key !== key));
    }
  };

  const renameBucket = (id: string, name: string) => {
    const row = buckets.find((b) => b.id === id)?.row;
    bucketMutate
      .mutateAsync({
        op: "update",
        id,
        row: { [opts.bucket_label_field]: name },
        ...(row ? { expected_version: row.__meta.version } : {}),
      })
      .catch((err: unknown) => fail(err, t("APP", "KANBAN_RENAME_FAILED")));
  };

  const deleteBucket = async (id: string) => {
    try {
      // The column may look empty under a filter: ask the server.
      const left = await client.list({
        collection,
        filter: { field: opts.ticket_bucket_field, op: "eq", value: id },
        page: { limit: 1 },
      });
      if ((left.total ?? left.rows.length) > 0) {
        toast({ variant: "warning", title: t("APP", "KANBAN_DELETE_NOT_EMPTY") });
        return;
      }
      const row = buckets.find((b) => b.id === id)?.row;
      await bucketMutate.mutateAsync({
        op: "delete",
        id,
        ...(row ? { expected_version: row.__meta.version } : {}),
      });
    } catch (err) {
      fail(err, t("APP", "KANBAN_DELETE_FAILED"));
    }
  };

  const addBucket = (name: string) => {
    if (!boardId) return;
    bucketMutate
      .mutateAsync({ op: "insert", row: newBucketRow(opts, { name, boardId, buckets }) })
      .catch((err: unknown) => fail(err, t("APP", "KANBAN_ADD_FAILED")));
  };

  // --- drag and drop ---------------------------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Enter stays free for opening the card.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  const containerOf = (dndId: string, from: Record<string, string[]>) =>
    asBucketId(dndId) ?? Object.keys(from).find((b) => from[b]?.includes(dndId)) ?? null;

  const onDragStart = ({ active: a }: DragStartEvent) => {
    const type = a.data.current?.type === "bucket" ? "bucket" : "card";
    setActive({ type, id: String(a.id) });
    if (type === "card") setDragIds(baseIds);
  };

  const onDragOver = ({ active: a, over }: DragOverEvent) => {
    if (a.data.current?.type !== "card" || !over) return;
    const id = String(a.id);
    setDragIds((prev) => {
      if (!prev) return prev;
      const from = containerOf(id, prev);
      const to = containerOf(String(over.id), prev);
      if (!from || !to || from === to) return prev;
      const target = prev[to] ?? [];
      const overIndex = target.indexOf(String(over.id));
      const translated = a.rect.current.translated;
      const below = translated && translated.top > over.rect.top + over.rect.height / 2;
      const at = overIndex < 0 ? target.length : overIndex + (below ? 1 : 0);
      return {
        ...prev,
        [from]: (prev[from] ?? []).filter((x) => x !== id),
        [to]: [...target.slice(0, at), id, ...target.slice(at)],
      };
    });
  };

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    const id = String(a.id);
    const type = active?.type;
    setActive(null);
    if (type === "bucket") {
      const from = buckets.findIndex((b) => bucketDndId(b.id) === id);
      const to = over ? buckets.findIndex((b) => bucketDndId(b.id) === String(over.id)) : -1;
      const bucketId = asBucketId(id);
      if (bucketId && from >= 0 && to >= 0 && from !== to) void moveBucket(bucketId, to);
      return;
    }
    const current = dragIds ?? baseIds;
    setDragIds(null);
    if (!over) return;
    const to = containerOf(String(over.id), current);
    const fromBucket = containerOf(id, baseIds);
    if (!to || !fromBucket) return;
    let toIds = current[to] ?? [];
    const oldIndex = toIds.indexOf(id);
    const overIndex = toIds.indexOf(String(over.id));
    if (oldIndex >= 0 && overIndex >= 0 && oldIndex !== overIndex) {
      toIds = arrayMove(toIds, oldIndex, overIndex);
    }
    const orders = new Map(
      [...rowById].map(([rid, r]) => [rid, orderOf(r, opts.ticket_order_field)] as const),
    );
    const plan = planDrop({
      id,
      fromBucket,
      fromIds: baseIds[fromBucket] ?? [],
      toBucket: to,
      toIds,
      orders,
    });
    if (plan) void moveCard(plan);
  };

  // --- render ----------------------------------------------------------------------
  const error = cardsQ.error ?? bucketsQ.error;
  if (error && cardsQ.rows.length === 0) {
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void cardsQ.refetch();
          bucketsQ.refetch();
        }}
      />
    );
  }
  if (!board.isLoading && boardId === null) {
    return (
      <div
        data-testid="kanban-no-board"
        className="flex flex-col items-center gap-2 px-6 py-16 text-center text-sm text-muted-foreground"
      >
        <KanbanSquare className="size-6" />
        {t("APP", "KANBAN_NO_BOARD")}
      </div>
    );
  }

  const loading =
    board.isLoading || bucketsQ.isLoading || (cardsQ.isLoading && !cardsQ.rows.length);
  const activeRow = active?.type === "card" ? rowById.get(active.id) : undefined;
  const detail = detailId ? rowById.get(detailId) : undefined;
  const labels = {
    [opts.ticket_board_field]: new Map(board.boards.map((b) => [b.id, b.label])),
    [opts.ticket_bucket_field]: new Map(buckets.map((b) => [b.id, b.label])),
  };
  const noMatches = filtered && !loading && cardsQ.rows.length === 0;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="kanban"
      data-board-id={boardId ?? undefined}
    >
      <AllRowsStatus result={cardsQ} />
      {noMatches ? (
        <div className="border-b border-border">
          <EmptyState filtered onClear={onClearFilters} />
        </div>
      ) : null}
      <div
        data-testid="kanban-scroll"
        className="scroll-thin flex min-h-0 flex-1 items-start gap-3 overflow-x-auto overflow-y-hidden bg-background/60 p-4"
      >
        {loading ? (
          SKELETON_COLUMNS.map((key, i) => (
            <div
              key={key}
              className="flex w-72 shrink-0 flex-col gap-2 rounded-xl border border-border bg-muted/40 p-3"
            >
              <Skeleton className="h-4 w-24" />
              {SKELETON_COLUMNS.slice(0, 3 - (i % 2)).map((card) => (
                <Skeleton key={card} className="h-20 rounded-lg" />
              ))}
            </div>
          ))
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collision}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={() => {
              setActive(null);
              setDragIds(null);
            }}
          >
            <SortableContext
              items={buckets.map((b) => bucketDndId(b.id))}
              strategy={horizontalListSortingStrategy}
            >
              {buckets.map((bucket) => (
                <KanbanColumn
                  key={bucket.id}
                  bucket={bucket}
                  ids={ids[bucket.id] ?? []}
                  rowById={rowById}
                  opts={opts}
                  schema={schema}
                  readOnly={readOnly}
                  pending={pendingAdds.filter((p) => p.bucketId === bucket.id)}
                  onOpen={(row: Row) => setDetailId(row.__meta.id)}
                  onQuickAdd={(where, title) => void quickAdd(bucket.id, where, title)}
                  onRename={(name) => renameBucket(bucket.id, name)}
                  onDelete={() => void deleteBucket(bucket.id)}
                />
              ))}
            </SortableContext>
            {opts.board.extendable_with_buckets && !readOnly ? (
              <AddBucketSlot onAdd={addBucket} />
            ) : null}
            <DragOverlay>
              {activeRow ? (
                <div
                  className={`${cardShellClass(
                    opts.card.priority_field
                      ? priorityTone(
                          activeRow[opts.card.priority_field],
                          schema.fields[opts.card.priority_field],
                        )
                      : null,
                    opts,
                  )} rotate-2 cursor-grabbing shadow-xl shadow-black/15`}
                  style={{ width: opts.buckets.min_width_px - 16 }}
                >
                  <KanbanCardBody row={activeRow} opts={opts} schema={schema} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
      <CardDetailDialog
        row={detail}
        describe={describe}
        collection={collection}
        labels={labels}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}
