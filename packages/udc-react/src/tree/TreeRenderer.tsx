import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  type FilterNode,
  isVersionConflict,
  type Row,
  type TreeOptions,
  UdcError,
} from "@jsudc/core";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronsDownUp, ChevronsUpDown, ListTree } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "../components/ui/button";
import { Skeleton, Spinner } from "../components/ui/misc";
import { useToast } from "../components/ui/toast";
import { useI18n } from "../i18n/i18n";
import { CardDetailDialog } from "../kanban/CardDetailDialog";
import { AllRowsStatus } from "../renderers/AllRowsStatus";
import type { RendererProps } from "../renderers/types";
import { EmptyState, ErrorState } from "../table/states";
import { useUdcAllRows, useUdcCollection, useUdcMutate } from "../udc/hooks";
import { udcKeys } from "../udc/keys";
import { useUdcClient } from "../udc/provider";
import { type TreeExpand, useTreeExpand } from "./expand";
import {
  type BuiltTree,
  buildTree,
  canDrop,
  type DropTarget,
  dropParent,
  idOf,
  lazyChildrenQuery,
  lazyRootsQuery,
  numberOf,
  parentOf,
  parseDropId,
  planDrop,
  reparentRequest,
  replyRow,
  searchExpansion,
  siblingsQuery,
  sortSiblings,
} from "./model";
import { TreeNode, TreeNodeLabel } from "./TreeNode";

/** A node moved in this session, drawn at its new place until the lists are read again. */
interface Moved {
  row: Row;
  parent: string | null;
  order: number;
}

export interface TreeCtx {
  collection: string;
  opts: TreeOptions;
  describe: RendererProps["describe"];
  lazy: boolean;
  /** What every lazy branch adds to its own condition: the data view's filter. */
  dataFilter: FilterNode | undefined;
  /** The highlighted search term ("" when none). */
  term: string;
  isOpen: (id: string, depth: number) => boolean;
  setOpen: (id: string, open: boolean) => void;
  /** Non-lazy: the children of a node as built from the loaded rows. */
  childrenOf: (id: string) => Row[];
  /** Rows moved in this session, by id. */
  moved: ReadonlyMap<string, Moved>;
  orphans: ReadonlySet<string>;
  can: { rename: boolean; reply: boolean; reparent: boolean };
  /** The id being dragged, and the loaded rows the drop targets are checked against. */
  drag: { id: string; rowsById: ReadonlyMap<string, Row> } | null;
  /** Lazy branches report the rows they loaded (for drop gating). */
  report: (parent: string, rows: Row[]) => void;
  onOpenDetail: (row: Row) => void;
  onRename: (row: Row, label: string) => Promise<void>;
  onReply: (parent: Row, text: string) => Promise<void>;
}

const Ctx = createContext<TreeCtx | null>(null);

export function useTree(): TreeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTree needs a <TreeRenderer> above it");
  return ctx;
}

/** Rows as drawn under `parent`: the loaded ones minus those moved away, plus those moved here. */
export function withMoves(
  rows: readonly Row[],
  parent: string | null,
  moved: ReadonlyMap<string, Moved>,
  ctx: Pick<TreeCtx, "opts">,
): Row[] {
  const { opts } = ctx;
  const stay = rows.filter((r) => {
    const m = moved.get(idOf(r));
    return !m || m.parent === parent;
  });
  const here = [...moved.values()]
    .filter((m) => m.parent === parent && !stay.some((r) => idOf(r) === idOf(m.row)))
    .map((m) => m.row);
  const patched = [...stay, ...here].map((r) => {
    const m = moved.get(idOf(r));
    return m ? { ...r, [opts.parent_field]: m.parent, [opts.order_field]: m.order } : r;
  });
  return sortSiblings(patched, opts.sibling_sort);
}

export function TreeRenderer(props: RendererProps) {
  const { t } = useI18n();
  const opts = props.describe.view.tree_options;
  if (!opts) {
    return (
      <div className="p-6 text-sm text-muted-foreground" data-testid="tree-no-options">
        {t("APP", "TREE_NO_OPTIONS")}
      </div>
    );
  }
  return <Tree {...props} opts={opts} />;
}

const SKELETON = ["a", "b", "c", "d", "e", "f"];

function Tree({
  collection,
  describe,
  filter,
  baseFilter,
  search,
  filtered,
  onClearFilters,
  onCount,
  opts,
}: RendererProps & { opts: TreeOptions }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const client = useUdcClient();
  const qc = useQueryClient();
  const { capabilities, schema, view } = describe;
  const lazy = opts.lazy;
  const term = search.trim();
  // highlight_and_expand on a loaded tree searches in the browser; anything else asks the server.
  const clientSearch = !lazy && opts.on_search.mode === "highlight_and_expand";
  const dataFilter: FilterNode | undefined = clientSearch ? baseFilter : filter;
  const highlight = opts.on_search.mode === "highlight_and_expand" ? term : "";

  // --- rows ----------------------------------------------------------------------
  const all = useUdcAllRows({
    collection,
    filter: dataFilter,
    sort: opts.sibling_sort,
    capabilities,
    enabled: !lazy,
    refetchInterval: describe.view.refresh_interval_ms,
  });
  const rootsQ = lazyRootsQuery(opts, dataFilter);
  const roots = useUdcCollection({
    collection,
    filter: rootsQ.filter,
    sort: rootsQ.sort ?? [],
    mode: "pages",
    pageLimit: rootsQ.limit,
    enabled: lazy,
  });
  const totalQ = useUdcCollection({
    collection,
    filter: dataFilter,
    mode: "pages",
    pageLimit: 1,
    enabled: lazy,
  });

  const [moved, setMoved] = useState<ReadonlyMap<string, Moved>>(new Map());
  const tree: BuiltTree = useMemo(
    () =>
      buildTree(
        all.rows.map((r) => {
          const m = moved.get(idOf(r));
          return m ? { ...r, [opts.parent_field]: m.parent, [opts.order_field]: m.order } : r;
        }),
        opts,
      ),
    [all.rows, moved, opts],
  );

  // A filtered lazy tree lists every match; those under a listed parent show when it opens.
  const lazyRoots = useMemo(() => {
    const ids = new Set(roots.rows.map(idOf));
    const top = roots.rows.filter((r) => {
      const p = parentOf(r, opts);
      return p === null || !ids.has(p);
    });
    return withMoves(top, null, moved, { opts });
  }, [roots.rows, moved, opts]);
  const lazyOrphans = useMemo(
    () => new Set(lazyRoots.filter((r) => parentOf(r, opts) !== null).map(idOf)),
    [lazyRoots, opts],
  );

  useEffect(() => {
    onCount(
      lazy
        ? totalQ.total === null
          ? null
          : { shown: lazyRoots.length, total: totalQ.total, unit: "nodes" }
        : all.total === null
          ? null
          : { shown: all.rows.length, total: all.rows.length, unit: "nodes" },
    );
  }, [onCount, lazy, lazyRoots.length, totalQ.total, all.rows.length, all.total]);
  useEffect(() => () => onCount(null), [onCount]);

  // --- expand state (with the search's own, while there is a term) ---------------------
  const expand: TreeExpand = useTreeExpand(opts, collection);
  const expansion = useMemo(
    () =>
      clientSearch && term
        ? searchExpansion(tree, term, view.search?.fields ?? [opts.label_field], opts)
        : null,
    [clientSearch, term, tree, view.search?.fields, opts],
  );
  const [searchToggles, setSearchToggles] = useState<ReadonlyMap<string, boolean>>(new Map());
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new term starts from its own expansion
  useEffect(() => setSearchToggles(new Map()), [term]);
  // A filtered lazy tree lists matches at every depth: none is opened by default.
  const defaultsOn = !(lazy && dataFilter !== undefined);

  const isOpen = useCallback(
    (id: string, depth: number) => {
      if (expansion) {
        const toggled = searchToggles.get(id);
        if (toggled !== undefined) return toggled;
        if (expansion.open.has(id)) return true;
        return !opts.on_search.collapse_others && expand.isOpen(id, depth);
      }
      return expand.isOpen(id, defaultsOn ? depth : Number.POSITIVE_INFINITY);
    },
    [expansion, searchToggles, opts.on_search.collapse_others, expand, defaultsOn],
  );
  const setOpen = useCallback(
    (id: string, open: boolean) => {
      if (expansion) setSearchToggles((m) => new Map(m).set(id, open));
      else expand.set(id, open);
    },
    [expansion, expand],
  );

  // --- writes -------------------------------------------------------------------------
  const can = {
    rename: opts.interactive.rename && capabilities.mutate,
    reply: opts.interactive.reply && capabilities.mutate,
    reparent: opts.interactive.reparent && capabilities.mutate && capabilities.tree_reparent,
  };
  const mutate = useUdcMutate(collection);
  const fail = useCallback(
    (err: unknown, title: string) => {
      if (isVersionConflict(err)) {
        toast({
          variant: "warning",
          title: t("APP", "TREE_CONFLICT_TITLE"),
          description: t("APP", "TREE_CONFLICT_BODY"),
        });
      } else {
        toast({ variant: "danger", title, description: (err as Error).message });
      }
    },
    [toast, t],
  );

  const onRename = async (row: Row, label: string) => {
    try {
      await mutate.mutateAsync({
        op: "update",
        id: idOf(row),
        row: { [opts.label_field]: label },
        expected_version: row.__meta.version,
      });
    } catch (err) {
      fail(err, t("APP", "TREE_RENAME_FAILED"));
    }
  };

  const onReply = async (parent: Row, text: string) => {
    try {
      await mutate.mutateAsync({
        op: "insert",
        row: replyRow(
          opts,
          schema,
          parent,
          tree.children.get(idOf(parent)) ?? [],
          text,
          new Date(),
        ),
      });
      setOpen(idOf(parent), true);
    } catch (err) {
      fail(err, t("APP", "TREE_REPLY_FAILED"));
      throw err;
    }
  };

  // --- drag and drop ---------------------------------------------------------------------
  const branches = useRef(new Map<string, Row[]>());
  const report = useCallback((parent: string, rows: Row[]) => {
    branches.current.set(parent, rows);
  }, []);
  const loadedRows = (): Map<string, Row> => {
    if (!lazy) return new Map(tree.byId);
    const map = new Map<string, Row>();
    for (const r of roots.rows) map.set(idOf(r), r);
    for (const rows of branches.current.values()) for (const r of rows) map.set(idOf(r), r);
    for (const m of moved.values()) {
      map.set(idOf(m.row), {
        ...m.row,
        [opts.parent_field]: m.parent,
        [opts.order_field]: m.order,
      });
    }
    return map;
  };
  const [drag, setDrag] = useState<TreeCtx["drag"]>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );
  // The gap strip above a row wins over the row it overlaps.
  const collision: CollisionDetection = (args) =>
    pointerWithin(args).sort(
      (a, b) =>
        Number(String(b.id).startsWith("before:")) - Number(String(a.id).startsWith("before:")),
    );

  const onDragStart = (e: DragStartEvent) =>
    setDrag({ id: String(e.active.id), rowsById: loadedRows() });

  const siblingOrders = async (parent: string | null) => {
    const q = siblingsQuery(opts, parent);
    const res = await client.list({ collection, ...q, page: { limit: q.limit } });
    return res.rows.map((r) => ({ id: idOf(r), order: numberOf(r, opts.order_field), row: r }));
  };

  const move = async (dragId: string, target: DropTarget, rowsById: ReadonlyMap<string, Row>) => {
    const parent = dropParent(target, rowsById, opts);
    const row = rowsById.get(dragId);
    if (parent === undefined || !row) return;
    // Drawn at once: last under the new parent, or just above the target.
    const above = numberOf(rowsById.get(target.id), opts.order_field);
    const provisional =
      target.kind === "before" && above !== null ? above - 0.5 : Number.MAX_SAFE_INTEGER;
    setMoved((m) => new Map(m).set(dragId, { row, parent, order: provisional }));
    if (parent !== null) setOpen(parent, true);
    try {
      let siblings = await siblingOrders(parent);
      let plan = planDrop(dragId, target, parent, siblings);
      let version = row.__meta.version;
      if (plan.collision) {
        if (parent === null) throw new UdcError("internal", t("APP", "TREE_NO_ROOM"));
        await client.reindex({
          collection,
          scope: { [opts.parent_field]: parent },
          order_field: opts.order_field,
        });
        siblings = await siblingOrders(parent);
        plan = planDrop(dragId, target, parent, siblings);
        if (plan.collision) throw new UdcError("internal", t("APP", "TREE_NO_ROOM"));
        // A reindex of the node's own siblings bumped its version too.
        version = siblings.find((s) => s.id === dragId)?.row.__meta.version ?? version;
      }
      await client.treeReparent(reparentRequest(collection, opts, plan, version));
    } catch (err) {
      fail(err, t("APP", "TREE_MOVE_FAILED"));
    } finally {
      await qc.invalidateQueries({ queryKey: udcKeys.lists(collection) });
      setMoved((m) => {
        const next = new Map(m);
        next.delete(dragId);
        return next;
      });
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    const current = drag;
    setDrag(null);
    const target = e.over ? parseDropId(String(e.over.id)) : null;
    if (!current || !target || !canDrop(current.id, target, current.rowsById, opts)) return;
    void move(current.id, target, current.rowsById);
  };

  // --- detail -------------------------------------------------------------------------------
  const [detail, setDetail] = useState<Row | null>(null);

  const ctx: TreeCtx = {
    collection,
    opts,
    describe,
    lazy,
    dataFilter,
    term: highlight,
    isOpen,
    setOpen,
    childrenOf: (id) => tree.children.get(id) ?? [],
    moved,
    orphans: lazy ? lazyOrphans : tree.orphans,
    can,
    drag,
    report,
    onOpenDetail: setDetail,
    onRename,
    onReply,
  };

  const topRows = lazy ? lazyRoots : tree.roots;
  const loading = lazy ? roots.isLoading : all.isLoading;
  const error = lazy ? roots.error : all.error;
  const allIds = () => [...tree.children.keys()];
  const dragRow = drag ? drag.rowsById.get(drag.id) : undefined;

  return (
    <Ctx.Provider value={ctx}>
      <div
        className="flex min-h-0 flex-1 flex-col"
        data-testid="tree"
        data-lazy={lazy || undefined}
        data-searching={expansion ? true : undefined}
      >
        {lazy ? null : <AllRowsStatus result={all} />}
        <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-3 py-1.5">
          {lazy ? null : (
            <Button
              size="sm"
              variant="ghost"
              data-testid="tree-expand-all"
              onClick={() => expand.expandAll(allIds())}
            >
              <ChevronsUpDown />
              {t("APP", "TREE_EXPAND_ALL")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            data-testid="tree-collapse-all"
            onClick={() => {
              setSearchToggles(new Map([...tree.children.keys()].map((id) => [id, false])));
              expand.collapseAll();
            }}
          >
            <ChevronsDownUp />
            {t("APP", "TREE_COLLAPSE_ALL")}
          </Button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-auto py-1">
          {error ? (
            <ErrorState
              error={error}
              onRetry={() => void (lazy ? roots.refetch() : all.refetch())}
            />
          ) : loading ? (
            <div className="flex flex-col gap-2 p-4">
              {SKELETON.map((k, i) => (
                <Skeleton key={k} className="h-6" style={{ marginLeft: (i % 3) * 20 }} />
              ))}
            </div>
          ) : topRows.length === 0 ? (
            <EmptyState filtered={filtered} onClear={onClearFilters} />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={collision}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={() => setDrag(null)}
            >
              <div role="tree" aria-label={t("COLLECTIONS", collection)} data-testid="tree-root">
                <NodeList rows={topRows} depth={0} />
              </div>
              <DragOverlay dropAnimation={null}>
                {dragRow ? (
                  <div className="flex max-w-md items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] shadow-lg shadow-black/15">
                    <ListTree className="size-3.5 text-muted-foreground" />
                    <TreeNodeLabel row={dragRow} />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </div>
      <CardDetailDialog
        row={detail ?? undefined}
        describe={describe}
        collection={collection}
        labels={{}}
        titleField={opts.label_field}
        bodyField={undefined}
        testId="tree-detail"
        onClose={() => setDetail(null)}
      />
    </Ctx.Provider>
  );
}

export function NodeList({ rows, depth }: { rows: readonly Row[]; depth: number }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: an ARIA tree group has no native element
    <div role="group">
      {rows.map((row) => (
        <TreeNode key={idOf(row)} row={row} depth={depth} />
      ))}
    </div>
  );
}

/** One level of a lazy tree, read when its parent opens. */
export function LazyChildren({ parent, depth }: { parent: string; depth: number }) {
  const { t } = useI18n();
  const ctx = useTree();
  const { opts, collection, moved, report, dataFilter } = ctx;
  const q = lazyChildrenQuery(opts, parent, dataFilter);
  const res = useUdcCollection({
    collection,
    filter: q.filter,
    sort: q.sort ?? [],
    mode: "pages",
    pageLimit: q.limit,
  });
  useEffect(() => report(parent, res.rows), [report, parent, res.rows]);
  const rows = withMoves(res.rows, parent, moved, ctx);
  if (res.isLoading) {
    return (
      <div
        className="flex items-center gap-2 py-1 text-xs text-muted-foreground"
        style={{ paddingLeft: 12 + (depth + 1) * 20 }}
        data-testid="tree-branch-loading"
      >
        <Spinner className="size-3.5" />
        {t("APP", "TREE_LOADING")}
      </div>
    );
  }
  return <NodeList rows={rows} depth={depth + 1} />;
}
