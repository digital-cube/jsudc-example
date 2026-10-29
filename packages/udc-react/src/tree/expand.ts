import type { TreeOptions } from "@jsudc/core";
import { useCallback, useMemo, useState } from "react";
import { storage } from "../lib/utils";

/**
 * What is open, relative to `default_depth`: a node is expanded when it is
 * in `open`, or when `defaults` still apply, it is not in `closed` and it
 * sits above `default_depth`. "Collapse all" switches the defaults off. A
 * lazy tree does not know its nodes ahead of time, so the state is kept as
 * these differences rather than one list of every expanded id.
 */
export interface ExpandState {
  defaults: boolean;
  open: string[];
  closed: string[];
}

export const FIRST_VISIT: ExpandState = { defaults: true, open: [], closed: [] };

export const expandStorageKey = (key: string) => `udc:tree:${key}`;

export function loadExpand(key: string): ExpandState {
  const raw = storage.get(expandStorageKey(key));
  if (!raw) return FIRST_VISIT;
  try {
    const v = JSON.parse(raw) as Partial<ExpandState>;
    const ids = (x: unknown) =>
      Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : [];
    return { defaults: v.defaults !== false, open: ids(v.open), closed: ids(v.closed) };
  } catch {
    return FIRST_VISIT;
  }
}

export function saveExpand(key: string, state: ExpandState): void {
  storage.set(expandStorageKey(key), JSON.stringify(state));
}

export function isExpanded(
  state: ExpandState,
  id: string,
  depth: number,
  defaultDepth: number,
): boolean {
  if (state.open.includes(id)) return true;
  return state.defaults && depth < defaultDepth && !state.closed.includes(id);
}

export function toggled(state: ExpandState, id: string, expand: boolean): ExpandState {
  const open = state.open.filter((i) => i !== id);
  const closed = state.closed.filter((i) => i !== id);
  return expand
    ? { ...state, open: [...open, id], closed }
    : { ...state, open, closed: [...closed, id] };
}

/**
 * The tree's expand state: under `udc:tree:<key>` in localStorage with
 * `persist: localstorage`, in memory (fresh on every mount) with `none`.
 */
export function useTreeExpand(opts: TreeOptions, collection: string) {
  const key = opts.expand.key ?? collection;
  const persist = opts.expand.persist === "localstorage";
  const [state, setState] = useState<ExpandState>(() => (persist ? loadExpand(key) : FIRST_VISIT));

  const update = useCallback(
    (next: (s: ExpandState) => ExpandState) =>
      setState((s) => {
        const n = next(s);
        if (persist) saveExpand(key, n);
        return n;
      }),
    [key, persist],
  );

  return useMemo(
    () => ({
      state,
      isOpen: (id: string, depth: number) =>
        isExpanded(state, id, depth, opts.expand.default_depth),
      set: (id: string, expand: boolean) => update((s) => toggled(s, id, expand)),
      expandAll: (ids: string[]) => update(() => ({ defaults: false, open: ids, closed: [] })),
      collapseAll: () => update(() => ({ defaults: false, open: [], closed: [] })),
    }),
    [state, update, opts.expand.default_depth],
  );
}

export type TreeExpand = ReturnType<typeof useTreeExpand>;
