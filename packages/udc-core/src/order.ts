/*
 * Sparse integer orders, shared by the server's tests and the browser (the
 * kanban, and the tree after it). Rows sit at 100, 200, 300, …; a drop takes
 * the integer midpoint of its neighbours. When two neighbours are adjacent
 * integers there is no room left: the caller renumbers the scope with
 * `reindex` and computes the order again.
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
