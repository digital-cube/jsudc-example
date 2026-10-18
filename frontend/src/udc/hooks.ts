import {
  type ActionRequest,
  type FilterNode,
  isVersionConflict,
  type ListResponse,
  type Row,
  type SortKey,
} from "@jsudc/udc-core";
import {
  type InfiniteData,
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type ListKeyParams, type PagingMode, udcKeys } from "./keys";
import { useUdcClient } from "./provider";

export function useUdcCollections() {
  const client = useUdcClient();
  return useQuery({ queryKey: udcKeys.collections(), queryFn: () => client.collections() });
}

export function useUdcDescribe(collection: string) {
  const client = useUdcClient();
  return useQuery({
    queryKey: udcKeys.describe(collection),
    queryFn: () => client.describe(collection),
    staleTime: 5 * 60_000,
  });
}

export interface UseUdcCollectionArgs {
  collection: string;
  filter?: FilterNode | undefined;
  sort?: SortKey[];
  mode: PagingMode;
  pageLimit: number;
  /** 1-based; pages mode only. */
  page?: number;
  enabled?: boolean;
}

export interface UdcCollectionResult {
  rows: Row[];
  total: number | null;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
  /** Infinite mode only; always false in pages mode. */
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

/** The `offset` a 1-based page asks for. */
export function pageOffset(page: number, limit: number): number {
  return Math.max(0, Math.floor(page) - 1) * limit;
}

/**
 * Rows of one collection. Infinite mode follows `next_cursor` page by page
 * (`useInfiniteQuery`); pages mode asks for one `offset` page (`useQuery`).
 * Both hooks are always mounted and the inactive one is disabled, so
 * switching modes keeps each cache warm.
 */
export function useUdcCollection(args: UseUdcCollectionArgs): UdcCollectionResult {
  const client = useUdcClient();
  const { collection, filter, mode, pageLimit: limit } = args;
  const sort = args.sort ?? [];
  const page = Math.max(1, args.page ?? 1);
  const enabled = args.enabled ?? true;

  const infiniteParams: ListKeyParams = { filter, sort, limit, mode: "infinite" };
  const infinite = useInfiniteQuery({
    queryKey: udcKeys.list(collection, infiniteParams),
    queryFn: ({ pageParam, signal }) =>
      client.list(
        {
          collection,
          ...(filter ? { filter } : {}),
          sort,
          page: pageParam ? { limit, cursor: pageParam } : { limit },
        },
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled: enabled && mode === "infinite",
  });

  const pagesParams: ListKeyParams = { filter, sort, limit, mode: "pages", page };
  const paged = useQuery({
    queryKey: udcKeys.list(collection, pagesParams),
    queryFn: ({ signal }) =>
      client.list(
        {
          collection,
          ...(filter ? { filter } : {}),
          sort,
          page: { limit, offset: pageOffset(page, limit) },
        },
        { signal },
      ),
    placeholderData: keepPreviousData,
    enabled: enabled && mode === "pages",
  });

  if (mode === "infinite") {
    const pages = infinite.data?.pages ?? [];
    return {
      rows: pages.flatMap((p) => p.rows),
      total: pages[0]?.total ?? null,
      isLoading: infinite.isLoading,
      isFetching: infinite.isFetching,
      error: infinite.error,
      refetch: () => void infinite.refetch(),
      hasNextPage: infinite.hasNextPage,
      isFetchingNextPage: infinite.isFetchingNextPage,
      fetchNextPage: () => void infinite.fetchNextPage(),
    };
  }
  return {
    rows: paged.data?.rows ?? [],
    total: paged.data?.total ?? null,
    isLoading: paged.isLoading,
    isFetching: paged.isFetching,
    error: paged.error,
    refetch: () => void paged.refetch(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => {},
  };
}

type ListCache = ListResponse | InfiniteData<ListResponse, unknown>;

function isInfinite(data: ListCache): data is InfiniteData<ListResponse, unknown> {
  return "pages" in data;
}

/** `data` with every row whose id is `id` passed through `patch`. */
export function patchRowInList(
  data: ListCache | undefined,
  id: string,
  patch: (row: Row) => Row,
): ListCache | undefined {
  if (!data) return data;
  const patchPage = (page: ListResponse): ListResponse =>
    page.rows.some((r) => r.__meta.id === id)
      ? { ...page, rows: page.rows.map((r) => (r.__meta.id === id ? patch(r) : r)) }
      : page;
  return isInfinite(data) ? { ...data, pages: data.pages.map(patchPage) } : patchPage(data);
}

function patchRowEverywhere(
  qc: QueryClient,
  collection: string,
  id: string,
  patch: (row: Row) => Row,
) {
  qc.setQueriesData<ListCache>({ queryKey: udcKeys.lists(collection) }, (data) =>
    patchRowInList(data, id, patch),
  );
}

export type UdcMutateVars = Omit<ActionRequest<"mutate">, "collection">;

/**
 * Insert / update / delete one row. An update is applied optimistically to
 * the row in every cached list page and rolled back if the server says no.
 * A `version_conflict` additionally re-reads the row, so the cache holds the
 * value that won; the error still reaches the caller. Lists are invalidated
 * once the call settles.
 */
export function useUdcMutate(collection: string) {
  const client = useUdcClient();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (vars: UdcMutateVars) => client.mutate({ collection, ...vars }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: udcKeys.lists(collection) });
      const snapshot = qc.getQueriesData<ListCache>({ queryKey: udcKeys.lists(collection) });
      const { id, row } = vars;
      if (vars.op === "update" && id && row) {
        patchRowEverywhere(qc, collection, id, (r) => ({ ...r, ...row, __meta: r.__meta }));
      }
      return { snapshot };
    },
    onSuccess: (res) => {
      patchRowEverywhere(qc, collection, res.row.__meta.id, () => res.row);
    },
    onError: async (err, vars, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
      if (isVersionConflict(err) && vars.id) {
        try {
          const fresh = await client.read(collection, vars.id);
          patchRowEverywhere(qc, collection, vars.id, () => fresh.row);
        } catch {
          // The invalidation below refetches the lists anyway.
        }
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: udcKeys.lists(collection) }),
  });
}

/**
 * The three schema edits. Each answers the new schema; `describe` (which
 * derives the columns) and the lists are refetched afterwards.
 */
export function useUdcSchema(collection: string) {
  const client = useUdcClient();
  const qc = useQueryClient();
  const onSuccess = async () => {
    await qc.invalidateQueries({ queryKey: udcKeys.describe(collection) });
    await qc.invalidateQueries({ queryKey: udcKeys.lists(collection) });
  };

  const addField = useMutation({
    mutationFn: (req: Omit<ActionRequest<"schema.add_field">, "collection">) =>
      client.schemaAddField({ collection, ...req }),
    onSuccess,
  });
  const updateField = useMutation({
    mutationFn: (req: Omit<ActionRequest<"schema.update_field">, "collection">) =>
      client.schemaUpdateField({ collection, ...req }),
    onSuccess,
  });
  const softDeleteField = useMutation({
    mutationFn: (field: string) => client.schemaSoftDeleteField({ collection, field }),
    onSuccess,
  });
  return { addField, updateField, softDeleteField };
}
