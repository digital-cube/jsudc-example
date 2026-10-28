/*
 * Sparse integer orders, shared by the server's tests and the browser (the
 * kanban, and the tree after it). Rows sit at 100, 200, 300, …; a drop takes
 * the integer midpoint of its neighbours. When two neighbours are adjacent
 * integers there is no room left: the caller renumbers the scope with
 * `reindex` and computes the order again. `isCycle` gates a tree's drop
 * targets in the browser and is what the server's refusal is tested against.
 */

export const ORDER_GAP = 100;

/**
 * The order of a row dropped between `prev` (the row above, `null` at the
 * top) and `next` (the row below, `null` at the bottom): the floor of the
 * midpoint, `prev + gap` at the end, `next - gap` at the start (it may go
 * below zero, the scale has no floor), `gap` in an empty scope. On a
 * collision (`detectCollision`) the midpoint equals `prev`; check first.
 */
export function orderBetween(prev: number | null, next: number | null, gap = ORDER_GAP): number {
  if (prev === null) return next === null ? gap : next - gap;
  if (next === null) return prev + gap;
  return Math.floor((prev + next) / 2);
}

/** No integer strictly between the neighbours: the scope needs a `reindex`. An open end never collides. */
export function detectCollision(prev: number | null, next: number | null): boolean {
  if (prev === null || next === null) return false;
  return next - prev <= 1;
}

/** The neighbours of slot `index` in an ascending list of orders that no longer holds the moved row. */
export function neighbours(
  orders: readonly number[],
  index: number,
): { prev: number | null; next: number | null } {
  const i = Math.max(0, Math.min(index, orders.length));
  return { prev: orders[i - 1] ?? null, next: orders[i] ?? null };
}

// Trees -----------------------------------------------------------------------

/** Child → parent, for `isCycle` over rows already loaded. */
export type ParentLookup = ReadonlyMap<string, string | null | undefined>;

/**
 * Whether moving `nodeId` under `newParentId` would make a cycle: the new
 * parent is the node itself or lies inside its subtree. `ancestry` is the
 * new parent's `ancestor_ids` (root first, the parent itself excluded), or a
 * child → parent map to walk up from it. Moving to the root never cycles.
 */
export function isCycle(
  nodeId: string,
  newParentId: string | null,
  ancestry: readonly string[] | ParentLookup,
): boolean {
  if (newParentId === null) return false;
  if (newParentId === nodeId) return true;
  if (Array.isArray(ancestry)) return ancestry.includes(nodeId);
  const parents = ancestry as ParentLookup;
  // A visited set, so data that already holds a cycle cannot loop forever.
  const seen = new Set<string>([newParentId]);
  let at = parents.get(newParentId);
  while (at != null && !seen.has(at)) {
    if (at === nodeId) return true;
    seen.add(at);
    at = parents.get(at);
  }
  return false;
}
