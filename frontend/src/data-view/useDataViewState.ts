import type { FilterNode, SortKey, ViewConfig } from "@jsudc/core";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { storage } from "../lib/utils";
import { resolveTab } from "../renderers/registry";
import type { PagingMode } from "../udc/keys";
import {
  type ChipState,
  decodeChipParam,
  decodeFilterParam,
  decodeModeParam,
  decodePageParam,
  decodeSortParam,
  encodeChipParam,
  encodeFilterParam,
  encodeSortParam,
  PARAM,
} from "./urlState";

export const pagingStorageKey = (collection: string) => `udc:paging:${collection}`;

/** URL `?mode=` wins, then the user's last choice for this collection, then the view. */
export function resolvePagingMode(
  urlMode: PagingMode | null,
  stored: string | null,
  viewDefault: PagingMode,
): PagingMode {
  if (urlMode) return urlMode;
  return stored === "pages" || stored === "infinite" ? stored : viewDefault;
}

export interface DataViewState {
  tab: string;
  search: string;
  chips: ChipState;
  tree: FilterNode | null;
  sort: SortKey[];
  mode: PagingMode;
  page: number;
  setTab: (tab: string) => void;
  setSearch: (q: string) => void;
  setChips: (chips: ChipState) => void;
  setTree: (tree: FilterNode | null) => void;
  setSort: (sort: SortKey[]) => void;
  setMode: (mode: PagingMode) => void;
  setPage: (page: number) => void;
  clearFilters: () => void;
}

/**
 * Everything the data view lets the user choose, kept in the address bar
 * (replace, not push: a filter tweak is not a history entry). A change to
 * what the rows are (search, chips, tree, sort) drops `?p=` back to page 1.
 */
/** The pseudo-tab of a collection's README; offered when `describe.docs` has text. */
export const DOC_TAB = "doc";

/** The pseudo-tab of the file a collection is read from; offered when `capabilities.source_yaml`. */
export const SOURCE_TAB = "source";

export function useDataViewState(
  collection: string,
  view: ViewConfig | undefined,
  opts: { doc?: boolean; source?: boolean } = {},
): DataViewState {
  const [params, setParams] = useSearchParams();

  const update = useCallback(
    (edit: (p: URLSearchParams) => void, resetPage = false) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          edit(next);
          if (resetPage) next.delete(PARAM.page);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const setOrDelete = (p: URLSearchParams, key: string, v: string | null) =>
    v ? p.set(key, v) : p.delete(key);

  const raw = {
    tab: params.get(PARAM.tab),
    q: params.get(PARAM.search),
    cf: params.get(PARAM.chips),
    f: params.get(PARAM.filter),
    sort: params.get(PARAM.sort),
    mode: params.get(PARAM.mode),
    p: params.get(PARAM.page),
  };

  const chips = useMemo(() => decodeChipParam(raw.cf), [raw.cf]);
  const tree = useMemo(() => decodeFilterParam(raw.f), [raw.f]);
  const sort = useMemo(() => decodeSortParam(raw.sort), [raw.sort]);

  const renderers = view?.available_renderers ?? ["table"];
  // The Doc and Source tabs are chosen, never the default: the view's default_renderer opens.
  const tab =
    opts.doc && raw.tab === DOC_TAB
      ? DOC_TAB
      : opts.source && raw.tab === SOURCE_TAB
        ? SOURCE_TAB
        : resolveTab(raw.tab ?? "", renderers, view?.default_renderer ?? "table");
  const mode = resolvePagingMode(
    decodeModeParam(raw.mode),
    storage.get(pagingStorageKey(collection)),
    view?.pagination ?? "infinite",
  );

  return {
    tab,
    search: raw.q ?? "",
    chips,
    tree,
    sort,
    mode,
    page: mode === "pages" ? decodePageParam(raw.p) : 1,
    setTab: (v) => update((p) => p.set(PARAM.tab, v)),
    setSearch: (q) => update((p) => setOrDelete(p, PARAM.search, q.trim() ? q : null), true),
    setChips: (c) => update((p) => setOrDelete(p, PARAM.chips, encodeChipParam(c)), true),
    setTree: (t) => update((p) => setOrDelete(p, PARAM.filter, encodeFilterParam(t)), true),
    setSort: (s) => update((p) => setOrDelete(p, PARAM.sort, encodeSortParam(s)), true),
    setMode: (m) => {
      storage.set(pagingStorageKey(collection), m);
      update((p) => {
        p.set(PARAM.mode, m);
        if (m === "infinite") p.delete(PARAM.page);
      });
    },
    setPage: (n) => update((p) => setOrDelete(p, PARAM.page, n > 1 ? String(n) : null)),
    clearFilters: () =>
      update((p) => {
        p.delete(PARAM.search);
        p.delete(PARAM.chips);
        p.delete(PARAM.filter);
      }, true),
  };
}
