import {
  type Condition,
  detectCollision,
  type FilterNode,
  isCycle,
  type ListRequest,
  ORDER_GAP,
  orderBetween,
  type ParentLookup,
  type Row,
  type SchemaDoc,
  type TreeOptions,
  type TreeReparentRequest,
  treeReparentFields,
} from "@jsudc/core";

/*
 * The tree's pure parts: building a tree from flat rows, sibling order,
 * search highlight and expansion, drop targets and the payloads it writes.
 * The renderer only wires these to queries and the DOM.
 */

export const idOf = (r: Row) => r.__meta.id;

export function parentOf(row: Row, opts: Pick<TreeOptions, "parent_field">): string | null {
  const v = row[opts.parent_field];
  return typeof v === "string" && v !== "" ? v : null;
}

export function numberOf(row: Row | undefined, field: string | undefined): number | null {
  if (!row || !field) return null;
  const v = row[field];
  const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

const missing = (v: unknown) => v === null || v === undefined || v === "";

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/** Siblings in `sibling_sort` order (missing values last either way, as the server), ties by id. */
export function sortSiblings(rows: readonly Row[], sort: TreeOptions["sibling_sort"]): Row[] {
  return [...rows].sort((x, y) => {
    for (const { field, dir } of sort) {
      const [a, b] = [x[field], y[field]];
      if (missing(a) || missing(b)) {
        if (missing(a) && missing(b)) continue;
        return missing(a) ? 1 : -1;
      }
      const c = compare(a, b);
      if (c !== 0) return dir === "desc" ? -c : c;
    }
    return idOf(x) < idOf(y) ? -1 : idOf(x) > idOf(y) ? 1 : 0;
  });
}

export interface BuiltTree {
  roots: Row[];
  /** Parent id → its children, sorted. */
  children: ReadonlyMap<string, Row[]>;
  byId: ReadonlyMap<string, Row>;
  /** Rows drawn as roots because their parent is not among the rows (a filter left it out). */
  orphans: ReadonlySet<string>;
  /** Depth in the drawn tree (an orphan is at 0). */
  depth: ReadonlyMap<string, number>;
}

/**
 * The tree of a flat list: a row whose parent is in the list sits under it;
 * every other row is a root — an orphan when it does have a parent, so a
 * chip that filters parents out still shows their children. A row caught
 * in a parent cycle is drawn as a root too, never lost.
 */
export function buildTree(
  rows: readonly Row[],
  opts: Pick<TreeOptions, "parent_field" | "sibling_sort">,
): BuiltTree {
  const byId = new Map(rows.map((r) => [idOf(r), r]));
  const kids = new Map<string, Row[]>();
  const roots: Row[] = [];
  const orphans = new Set<string>();
  for (const row of rows) {
    const p = parentOf(row, opts);
    if (p !== null && byId.has(p) && p !== idOf(row)) {
      kids.set(p, [...(kids.get(p) ?? []), row]);
    } else {
      roots.push(row);
      if (p !== null) orphans.add(idOf(row));
    }
  }
  const depth = new Map<string, number>();
  const visit = (row: Row, d: number) => {
    depth.set(idOf(row), d);
    for (const c of kids.get(idOf(row)) ?? []) if (!depth.has(idOf(c))) visit(c, d + 1);
  };
  for (const r of roots) visit(r, 0);
  // Rows only reachable through a cycle: break it at one of them.
  for (const row of rows) {
    if (depth.has(idOf(row))) continue;
    roots.push(row);
    orphans.add(idOf(row));
    visit(row, 0);
  }
  const children = new Map(
    [...kids].map(([p, list]) => [p, sortSiblings(list, opts.sibling_sort)] as const),
  );
  return { roots: sortSiblings(roots, opts.sibling_sort), children, byId, orphans, depth };
}

/** Child → parent of every row, for `isCycle`. */
export function parentLookup(rows: Iterable<Row>, opts: Pick<TreeOptions, "parent_field">) {
  const map = new Map<string, string | null>();
  for (const r of rows) map.set(idOf(r), parentOf(r, opts));
  return map as ParentLookup;
}

// search ------------------------------------------------------------------------

/** Start / end indices of every case-insensitive occurrence of `term`, taken literally. */
export function findMatchRanges(text: string, term: string): [number, number][] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];
  const hay = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
    ranges.push([i, i + needle.length]);
  }
  return ranges;
}

/** `text` split into plain and matching parts, in order, each with its start offset. */
export function highlightParts(
  text: string,
  term: string,
): { text: string; match: boolean; at: number }[] {
  const parts: { text: string; match: boolean; at: number }[] = [];
  let at = 0;
  for (const [from, to] of findMatchRanges(text, term)) {
    if (from > at) parts.push({ text: text.slice(at, from), match: false, at });
    parts.push({ text: text.slice(from, to), match: true, at: from });
    at = to;
  }
  if (at < text.length || parts.length === 0) {
    parts.push({ text: text.slice(at), match: false, at });
  }
  return parts;
}

/**
 * `highlight_and_expand`: the rows any search field of which contains the
 * term (as the server's `contains` would), and every ancestor of one — the
 * nodes to open so each match is on screen.
 */
export function searchExpansion(
  tree: BuiltTree,
  term: string,
  fields: readonly string[],
  opts: Pick<TreeOptions, "parent_field">,
): { matches: Set<string>; open: Set<string> } {
  const matches = new Set<string>();
  const open = new Set<string>();
  const needle = term.trim().toLowerCase();
  if (!needle) return { matches, open };
  for (const row of tree.byId.values()) {
    if (
      !fields.some((f) =>
        String(row[f] ?? "")
          .toLowerCase()
          .includes(needle),
      )
    )
      continue;
    matches.add(idOf(row));
    let p = tree.orphans.has(idOf(row)) ? null : parentOf(row, opts);
    while (p !== null && !open.has(p) && tree.byId.has(p)) {
      open.add(p);
      const up = tree.byId.get(p) as Row;
      p = tree.orphans.has(p) ? null : parentOf(up, opts);
    }
  }
  return { matches, open };
}

// labels ------------------------------------------------------------------------

/** The `<SECTION>_<TERM>` split of an i18n label, on the first underscore; `null` when it has none. */
export function i18nKey(value: string): [string, string] | null {
  const i = value.indexOf("_");
  return i > 0 && i < value.length - 1 ? [value.slice(0, i), value.slice(i + 1)] : null;
}

// lazy queries --------------------------------------------------------------------

const and = (parts: (FilterNode | undefined)[]): FilterNode | undefined => {
  const list = parts.filter((p): p is FilterNode => p !== undefined);
  return list.length === 0 ? undefined : list.length === 1 ? list[0] : { and: list };
};

export function rootCondition(opts: TreeOptions): Condition {
  const { field, op, value } = opts.root_filter;
  return op === "is_null" ? { field, op } : { field, op, value };
}

/**
 * The roots of a lazy tree: `root_filter` and the data view's filter. With
 * a filter on, every matching row is listed instead (the ones under a
 * matching parent are dropped by the renderer and show when it opens).
 */
export function lazyRootsQuery(
  opts: TreeOptions,
  filter: FilterNode | undefined,
): Pick<ListRequest, "filter" | "sort"> & { limit: number } {
  const f = filter === undefined ? rootCondition(opts) : filter;
  return { filter: f, sort: opts.sibling_sort, limit: opts.lazy_page_size };
}

/** One level of a lazy tree: the children of `parentId` that pass the data view's filter. */
export function lazyChildrenQuery(
  opts: TreeOptions,
  parentId: string,
  filter: FilterNode | undefined,
): Pick<ListRequest, "filter" | "sort"> & { limit: number } {
  const own: Condition = { field: opts.parent_field, op: "eq", value: parentId };
  return {
    filter: and([own, filter]) as FilterNode,
    sort: opts.sibling_sort,
    limit: opts.lazy_page_size,
  };
}

/** The siblings under `parent` (or the roots), by order: what a drop's order is computed from. */
export function siblingsQuery(
  opts: TreeOptions,
  parent: string | null,
): Pick<ListRequest, "filter" | "sort"> & { limit: number } {
  const filter: Condition =
    parent === null
      ? { field: opts.parent_field, op: "is_null" }
      : { field: opts.parent_field, op: "eq", value: parent };
  return { filter, sort: [{ field: opts.order_field }], limit: opts.lazy_page_size };
}

// drops -----------------------------------------------------------------------------

/** Onto a node (it becomes the last child) or into the gap above a node (same parent). */
export type DropTarget = { kind: "into"; id: string } | { kind: "before"; id: string };

export function dropId(t: DropTarget): string {
  return `${t.kind}:${t.id}`;
}

export function parseDropId(id: string): DropTarget | null {
  const m = /^(into|before):(.+)$/.exec(id);
  return m ? { kind: m[1] as DropTarget["kind"], id: m[2] as string } : null;
}

/** The parent a drop on `target` gives the moved node; `undefined` when the target is not loaded. */
export function dropParent(
  target: DropTarget,
  rowsById: ReadonlyMap<string, Row>,
  opts: Pick<TreeOptions, "parent_field">,
): string | null | undefined {
  if (target.kind === "into") return target.id;
  const row = rowsById.get(target.id);
  return row ? parentOf(row, opts) : undefined;
}

/**
 * Whether `dragId` may land on `target`: never into itself or its subtree
 * (`isCycle`, over the target parent's `ancestor_ids` when the tree has
 * them, else the loaded rows' parent links), never above itself.
 */
export function canDrop(
  dragId: string,
  target: DropTarget,
  rowsById: ReadonlyMap<string, Row>,
  opts: Pick<TreeOptions, "parent_field" | "ancestor_ids_field">,
): boolean {
  if (target.kind === "before" && target.id === dragId) return false;
  const parent = dropParent(target, rowsById, opts);
  if (parent === undefined) return false;
  const stored = parent === null ? [] : rowsById.get(parent)?.[opts.ancestor_ids_field ?? ""];
  const ancestry = Array.isArray(stored)
    ? (stored as string[])
    : parentLookup(rowsById.values(), opts);
  // Stored ancestors may be stale for rows moved in this session: the loaded links must agree too.
  return (
    !isCycle(dragId, parent, ancestry) &&
    !isCycle(dragId, parent, parentLookup(rowsById.values(), opts))
  );
}

export interface DropPlan {
  id: string;
  parent: string | null;
  order: number;
  /** No integer left between the neighbours: renumber the siblings and plan again. */
  collision: boolean;
}

/**
 * The order of a drop, from the new parent's children by order (the moved
 * node left out): last child for `into`, between the target and the one
 * above it for `before`.
 */
export function planDrop(
  dragId: string,
  target: DropTarget,
  parent: string | null,
  siblings: readonly { id: string; order: number | null }[],
): DropPlan {
  const orders = siblings
    .filter((s) => s.id !== dragId)
    .map((s, i) => ({ id: s.id, order: s.order ?? (i + 1) * ORDER_GAP }));
  let prev: number | null = orders.at(-1)?.order ?? null;
  let next: number | null = null;
  if (target.kind === "before") {
    const i = orders.findIndex((s) => s.id === target.id);
    if (i !== -1) {
      prev = orders[i - 1]?.order ?? null;
      next = orders[i]?.order ?? null;
    }
  }
  return {
    id: dragId,
    parent,
    order: orderBetween(prev, next),
    collision: detectCollision(prev, next),
  };
}

/** The `tree.reparent` call of a plan; the structure fields come from `tree_options`. */
export function reparentRequest(
  collection: string,
  opts: TreeOptions,
  plan: DropPlan,
  version: number | undefined,
): TreeReparentRequest {
  return {
    collection,
    id: plan.id,
    parent: plan.parent,
    order: plan.order,
    ...(version === undefined ? {} : { expected_version: version }),
    fields: treeReparentFields(opts),
  };
}

// reply -------------------------------------------------------------------------------

export const REPLY_AUTHOR = { name: "You", initials: "YO" } as const;

/**
 * A reply under `parent`: the text in `label_field`, the next sparse order
 * after the last sibling, depth one below, "You" as author when the schema
 * has one, and now in every datetime field the siblings sort by (so the
 * reply reads last, as a new comment should).
 */
export function replyRow(
  opts: TreeOptions,
  schema: Pick<SchemaDoc, "fields">,
  parent: Row,
  siblings: readonly Row[],
  text: string,
  now: Date,
): Record<string, unknown> {
  const live = (f: string | undefined) => (f && schema.fields[f]?.deleted !== true ? f : undefined);
  const orders = siblings
    .map((s) => numberOf(s, opts.order_field))
    .filter((n): n is number => n !== null);
  const row: Record<string, unknown> = {
    [opts.parent_field]: idOf(parent),
    [opts.label_field]: text,
    [opts.order_field]: (orders.length ? Math.max(...orders) : 0) + ORDER_GAP,
  };
  const depthField = live(opts.depth_field);
  if (depthField) row[depthField] = (numberOf(parent, depthField) ?? 0) + 1;
  const avatar = live(opts.avatar_field);
  if (avatar) row[avatar] = REPLY_AUTHOR.initials;
  if (schema.fields.author?.type === "string") row.author = REPLY_AUTHOR.name;
  for (const { field } of opts.sibling_sort) {
    if (schema.fields[field]?.type === "datetime") row[field] = now.toISOString();
  }
  return row;
}
