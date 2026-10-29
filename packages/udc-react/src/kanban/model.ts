import {
  COLUMN_COLORS,
  type ColumnColor,
  detectCollision,
  type FieldDef,
  type FilterNode,
  type KanbanOptions,
  orderBetween,
  type Row,
  type SchemaDoc,
} from "@jsudc/core";

/*
 * The kanban's pure parts: which rows are columns and cards, where a dropped
 * card lands, what a quick-add inserts. The renderer is the glue around them.
 */

export interface Bucket {
  id: string;
  label: string;
  color: ColumnColor | null;
  order: number | null;
  row: Row;
}

export function orderOf(row: Row | undefined, field: string): number | null {
  const v = row?.[field];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const isColor = (v: unknown): v is ColumnColor =>
  typeof v === "string" && (COLUMN_COLORS as readonly string[]).includes(v);

/** Ascending order, a missing order last, then the id: the server's `ORDER BY`. */
export function byOrder(field: string) {
  return (a: Row, b: Row) => {
    const x = orderOf(a, field);
    const y = orderOf(b, field);
    if (x !== y) {
      if (x === null) return 1;
      if (y === null) return -1;
      return x - y;
    }
    return a.__meta.id < b.__meta.id ? -1 : a.__meta.id > b.__meta.id ? 1 : 0;
  };
}

export function bucketsOf(rows: readonly Row[], opts: KanbanOptions): Bucket[] {
  return [...rows].sort(byOrder(opts.bucket_order_field)).map((row) => {
    const color = opts.bucket_color_field ? row[opts.bucket_color_field] : null;
    return {
      id: row.__meta.id,
      label: String(row[opts.bucket_label_field] ?? ""),
      color: isColor(color) ? color : null,
      order: orderOf(row, opts.bucket_order_field),
      row,
    };
  });
}

/** A card move not yet confirmed by the server: drawn where it was dropped. */
export interface PendingMove {
  bucketId: string;
  order: number;
}

/**
 * Cards per bucket id, each column in order. `pending` overrides a card's
 * bucket and order until the server answers; a card whose bucket is not on
 * the board is left out.
 */
export function groupCards(
  cards: readonly Row[],
  buckets: readonly Bucket[],
  opts: KanbanOptions,
  pending: ReadonlyMap<string, PendingMove> = new Map(),
): Record<string, Row[]> {
  const out: Record<string, Row[]> = Object.fromEntries(buckets.map((b) => [b.id, []]));
  for (const card of cards) {
    const move = pending.get(card.__meta.id);
    const shown = move
      ? {
          ...card,
          [opts.ticket_bucket_field]: move.bucketId,
          [opts.ticket_order_field]: move.order,
        }
      : card;
    const bucket = String(shown[opts.ticket_bucket_field] ?? "");
    out[bucket]?.push(shown);
  }
  for (const list of Object.values(out)) list.sort(byOrder(opts.ticket_order_field));
  return out;
}

export interface DropInput {
  /** The card. */
  id: string;
  fromBucket: string;
  /** The column's card ids before the drag (the source column). */
  fromIds: readonly string[];
  toBucket: string;
  /** The target column's card ids after the drop, the card included. */
  toIds: readonly string[];
  /** Current order of every card by id. */
  orders: ReadonlyMap<string, number | null>;
}

export interface DropPlan {
  id: string;
  bucketId: string;
  /** The bucket changed: the update carries it. */
  moved: boolean;
  order: number;
  /** No integer is left between the neighbours: reindex the bucket first. */
  collision: boolean;
  prevId: string | null;
  nextId: string | null;
}

/**
 * Where a dropped card goes. `null` when it was dropped on its own slot (no
 * request). The order sits between the neighbours it was dropped between;
 * a neighbour without an order counts as an open end.
 */
export function planDrop(input: DropInput): DropPlan | null {
  const { id, fromBucket, toBucket, toIds, orders } = input;
  const at = toIds.indexOf(id);
  if (at < 0) return null;
  const moved = fromBucket !== toBucket;
  if (!moved && input.fromIds.indexOf(id) === at) return null;
  const prevId = toIds[at - 1] ?? null;
  const nextId = toIds[at + 1] ?? null;
  const prev = prevId ? (orders.get(prevId) ?? null) : null;
  const next = nextId ? (orders.get(nextId) ?? null) : null;
  return {
    id,
    bucketId: toBucket,
    moved,
    order: orderBetween(prev, next),
    collision: detectCollision(prev, next),
    prevId,
    nextId,
  };
}

/** The same drop again, with the neighbours' orders as they are after a reindex. */
export function replanDrop(plan: DropPlan, orders: ReadonlyMap<string, number | null>): DropPlan {
  const prev = plan.prevId ? (orders.get(plan.prevId) ?? null) : null;
  const next = plan.nextId ? (orders.get(plan.nextId) ?? null) : null;
  return { ...plan, order: orderBetween(prev, next), collision: detectCollision(prev, next) };
}

export type AddWhere = "top" | "bottom";

/** The row a quick-add inserts: first order − 100 at the top, last + 100 at the bottom. */
export function quickAddRow(
  opts: KanbanOptions,
  args: {
    title: string;
    boardId: string;
    bucketId: string;
    /** The column's orders, ascending. */
    orders: readonly (number | null)[];
    where: AddWhere;
  },
): Record<string, unknown> {
  const known = args.orders.filter((o): o is number => o !== null);
  const order =
    args.where === "top"
      ? orderBetween(null, known[0] ?? null)
      : orderBetween(known.at(-1) ?? null, null);
  return {
    [opts.card.title_field]: args.title,
    [opts.ticket_board_field]: args.boardId,
    [opts.ticket_bucket_field]: args.bucketId,
    [opts.ticket_order_field]: order,
  };
}

/** The row `+ Add bucket` inserts, after the last column. */
export function newBucketRow(
  opts: KanbanOptions,
  args: { name: string; boardId: string; buckets: readonly Bucket[] },
): Record<string, unknown> {
  const last = args.buckets
    .map((b) => b.order)
    .filter((o): o is number => o !== null)
    .at(-1);
  return {
    [opts.bucket_label_field]: args.name,
    [opts.bucket_filter_field]: args.boardId,
    [opts.bucket_order_field]: orderBetween(last ?? null, null),
  };
}

export function boardFilter(opts: KanbanOptions, boardId: string): FilterNode {
  return { field: opts.ticket_board_field, op: "eq", value: boardId };
}

/** The board's cards narrowed by the data view's filter (search, chips, tree). */
export function cardsFilter(
  opts: KanbanOptions,
  boardId: string,
  viewFilter: FilterNode | undefined,
): FilterNode {
  const board = boardFilter(opts, boardId);
  return viewFilter ? { and: [board, viewFilter] } : board;
}

const PRIORITY_SCALE: readonly ColumnColor[] = ["muted", "info", "warning", "danger"];

/**
 * A priority's tone from its place in the field's enum: the first value is
 * the calmest, the last the loudest. A non-enum or unknown value has none.
 */
export function priorityTone(value: unknown, def: FieldDef | undefined): ColumnColor | null {
  const values = def?.type === "enum" ? (def.values ?? []) : [];
  const i = typeof value === "string" ? values.indexOf(value) : -1;
  if (i < 0) return null;
  if (values.length === 1) return PRIORITY_SCALE[1] ?? null;
  const step = Math.round((i / (values.length - 1)) * (PRIORITY_SCALE.length - 1));
  return PRIORITY_SCALE[step] ?? null;
}

/** The board collection: the `ref` of the card's board field, with its label field. */
export function boardSource(
  schema: SchemaDoc,
  opts: KanbanOptions,
): { collection: string; labelField: string } | null {
  const def = schema.fields[opts.ticket_board_field];
  if (!def?.ref) return null;
  return { collection: def.ref, labelField: def.label_field ?? "name" };
}

/** A due date before today (local calendar day). */
export function isOverdue(value: unknown, today = new Date()): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return false;
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  return value.slice(0, 10) < `${y}-${m}-${d}`;
}

/** Writes are off: the view says read-only, or the source cannot mutate. */
export function isReadOnly(opts: KanbanOptions, capabilities: { mutate: boolean }): boolean {
  return opts.permissions.read_only || !capabilities.mutate;
}
