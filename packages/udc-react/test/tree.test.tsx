import {
  type DescribeResponse,
  type Row,
  SchemaDocSchema,
  TreeOptionsSchema,
  ViewConfigSchema,
} from "@jsudc/core";
import { UdcClient } from "@jsudc/core/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "../src/components/ui/toast";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { UdcI18nProvider } from "../src/i18n/i18n";
import type { RendererProps } from "../src/renderers/types";
import {
  expandStorageKey,
  FIRST_VISIT,
  isExpanded,
  loadExpand,
  toggled,
  useTreeExpand,
} from "../src/tree/expand";
import {
  buildTree,
  canDrop,
  findMatchRanges,
  highlightParts,
  i18nKey,
  lazyChildrenQuery,
  lazyRootsQuery,
  parseDropId,
  planDrop,
  reparentRequest,
  replyRow,
  searchExpansion,
  sortSiblings,
} from "../src/tree/model";
import { TreeRenderer, withMoves } from "../src/tree/TreeRenderer";
import type { UdcCollectionResult } from "../src/udc/hooks";
import { createUdcQueryClient, UdcProvider } from "../src/udc/provider";
import { listOf, mockUdcFetch, row } from "./fetchMock";

const thread = TreeOptionsSchema.parse({
  label_field: "body",
  avatar_field: "author_initials",
  depth_field: "depth",
  sibling_sort: [{ field: "created_at" }],
  interactive: { reply: true },
});
const org = TreeOptionsSchema.parse({
  label_field: "name",
  depth_field: "depth",
  children_count_field: "children_count",
  ancestor_ids_field: "ancestor_ids",
  lazy: true,
  lazy_page_size: 300,
  sibling_sort: [{ field: "kind" }, { field: "order" }],
  interactive: { rename: true, reparent: true },
});

const c = (id: string, parent: string | null, at: string, body = id, extra = {}) =>
  row(id, 1, { parent_id: parent, body, created_at: at, order: 100, depth: 0, ...extra });

//  a ─ a1 ─ a11
//    └ a2
//  b
//  x (its parent "gone" is filtered out)
const rows: Row[] = [
  c("a2", "a", "2026-10-20T10:02:00Z", "drugi odgovor"),
  c("a", null, "2026-10-20T10:00:00Z", "Prvi komentar iz Beograda"),
  c("b", null, "2026-10-20T09:00:00Z", "ranije"),
  c("a11", "a1", "2026-10-20T10:05:00Z", "duboko u Beogradu"),
  c("a1", "a", "2026-10-20T10:01:00Z", "prvi odgovor"),
  c("x", "gone", "2026-10-20T11:00:00Z", "siroče"),
];
const ids = (list: readonly Row[]) => list.map((r) => r.__meta.id);

describe("buildTree", () => {
  it("nests rows under their parents, siblings by sibling_sort, orphans as roots", () => {
    const t = buildTree(rows, thread);
    expect(ids(t.roots)).toEqual(["b", "a", "x"]);
    expect(ids(t.children.get("a") ?? [])).toEqual(["a1", "a2"]);
    expect(ids(t.children.get("a1") ?? [])).toEqual(["a11"]);
    expect([...t.orphans]).toEqual(["x"]);
    expect(Object.fromEntries(t.depth)).toEqual({ b: 0, a: 0, a1: 1, a11: 2, a2: 1, x: 0 });
  });

  it("never loses a row caught in a parent cycle", () => {
    const loop = [c("p", "q", "1"), c("q", "p", "2"), c("r", null, "3")];
    const t = buildTree(loop, thread);
    expect(t.depth.size).toBe(3);
    expect(ids(t.roots)).toContain("r");
  });
});

describe("sortSiblings", () => {
  it("sorts by every key, missing values last, then by id", () => {
    const list = [
      row("4", 1, { kind: "team", order: 200 }),
      row("1", 1, { kind: "person", order: 300 }),
      row("3", 1, { kind: "team", order: 100 }),
      row("2", 1, { kind: "person" }),
      row("5", 1, { kind: "person", order: 300 }),
    ];
    expect(ids(sortSiblings(list, org.sibling_sort))).toEqual(["1", "5", "2", "3", "4"]);
    expect(ids(sortSiblings(list, [{ field: "order", dir: "desc" }]))).toEqual([
      "1",
      "5",
      "4",
      "3",
      "2",
    ]);
  });
});

describe("highlight and search", () => {
  it("finds every case-insensitive occurrence, literally", () => {
    expect(findMatchRanges("Beograd i beograd", "BEOGRAD")).toEqual([
      [0, 7],
      [10, 17],
    ]);
    expect(findMatchRanges("a.b.c", ".")).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(findMatchRanges("anything", "  ")).toEqual([]);
  });

  it("splits a label into plain and marked parts", () => {
    expect(highlightParts("U Beogradu ima", "beograd")).toEqual([
      { text: "U ", match: false, at: 0 },
      { text: "Beograd", match: true, at: 2 },
      { text: "u ima", match: false, at: 9 },
    ]);
    expect(highlightParts("bez", "")).toEqual([{ text: "bez", match: false, at: 0 }]);
  });

  it("opens every ancestor of a match and nothing else", () => {
    const t = buildTree(rows, thread);
    const res = searchExpansion(t, "beograd", ["body"], thread);
    expect([...res.matches].sort()).toEqual(["a", "a11"]);
    expect([...res.open].sort()).toEqual(["a", "a1"]);
    expect(searchExpansion(t, " ", ["body"], thread).open.size).toBe(0);
  });

  it("splits an i18n label on the first underscore", () => {
    expect(i18nKey("ORG_SALES_TEAM")).toEqual(["ORG", "SALES_TEAM"]);
    expect(i18nKey("plain")).toBeNull();
    expect(i18nKey("_X")).toBeNull();
  });
});

describe("expand state", () => {
  beforeEach(() => localStorage.clear());

  it("opens the first default_depth levels until the user changes something", () => {
    expect(isExpanded(FIRST_VISIT, "a", 0, 1)).toBe(true);
    expect(isExpanded(FIRST_VISIT, "a1", 1, 1)).toBe(false);
    const s = toggled(toggled(FIRST_VISIT, "a", false), "a1", true);
    expect(isExpanded(s, "a", 0, 1)).toBe(false);
    expect(isExpanded(s, "a1", 1, 1)).toBe(true);
  });

  it("persists under udc:tree:<key> with localstorage", () => {
    const opts = TreeOptionsSchema.parse({ expand: { key: "comments", default_depth: 1 } });
    const { result, unmount } = renderHook(() => useTreeExpand(opts, "fallback"));
    act(() => result.current.set("a", false));
    act(() => result.current.set("a1", true));
    expect(JSON.parse(localStorage.getItem(expandStorageKey("comments")) ?? "null")).toEqual({
      defaults: true,
      open: ["a1"],
      closed: ["a"],
    });
    unmount();
    const again = renderHook(() => useTreeExpand(opts, "fallback"));
    expect(again.result.current.isOpen("a", 0)).toBe(false);
    expect(again.result.current.isOpen("a1", 1)).toBe(true);
    act(() => again.result.current.collapseAll());
    expect(loadExpand("comments")).toEqual({ defaults: false, open: [], closed: [] });
  });

  it("keys by the collection when expand.key is absent, and forgets with persist: none", () => {
    const keyed = TreeOptionsSchema.parse({});
    const { result } = renderHook(() => useTreeExpand(keyed, "org"));
    act(() => result.current.set("n", true));
    expect(loadExpand("org").open).toEqual(["n"]);

    const none = TreeOptionsSchema.parse({ expand: { persist: "none", key: "x" } });
    const first = renderHook(() => useTreeExpand(none, "x"));
    act(() => first.result.current.set("n", true));
    expect(localStorage.getItem(expandStorageKey("x"))).toBeNull();
    first.unmount();
    expect(renderHook(() => useTreeExpand(none, "x")).result.current.isOpen("n", 5)).toBe(false);
  });

  it("reads a damaged entry as a first visit", () => {
    localStorage.setItem(expandStorageKey("bad"), "{not json");
    expect(loadExpand("bad")).toEqual(FIRST_VISIT);
  });
});

describe("drops", () => {
  // c ─ d1 ─ t1
  //   └ d2
  const nodes = [
    row("c", 1, { parent_id: null, ancestor_ids: [], order: 100 }),
    row("d1", 1, { parent_id: "c", ancestor_ids: ["c"], order: 100 }),
    row("d2", 1, { parent_id: "c", ancestor_ids: ["c"], order: 200 }),
    row("t1", 1, { parent_id: "d1", ancestor_ids: ["c", "d1"], order: 100 }),
  ];
  const byId = new Map(nodes.map((n) => [n.__meta.id, n]));

  it.each([
    ["d1", "into", "t1", false],
    ["d1", "into", "d1", false],
    ["c", "into", "t1", false],
    ["d1", "before", "t1", false],
    ["d1", "before", "d1", false],
    ["t1", "into", "d2", true],
    ["t1", "before", "d2", true],
    ["d2", "into", "t1", true],
    ["d1", "into", "missing", true],
    ["d1", "before", "missing", false],
  ] as const)("%s %s %s: allowed %s (isCycle)", (drag, kind, target, ok) => {
    expect(canDrop(drag, { kind, id: target }, byId, org)).toBe(ok);
  });

  it("checks the loaded links too when stored ancestors are stale", () => {
    const stale = new Map(byId).set(
      "t1",
      row("t1", 2, { parent_id: "d2", ancestor_ids: ["c", "d1"], order: 100 }),
    );
    expect(canDrop("d2", { kind: "into", id: "t1" }, stale, org)).toBe(false);
  });

  it("plans the last child, a gap, and a collision", () => {
    const sibs = [
      { id: "a", order: 100 },
      { id: "b", order: 200 },
      { id: "m", order: 300 },
      { id: "c", order: 201 },
    ].sort((x, y) => x.order - y.order);
    expect(planDrop("m", { kind: "into", id: "p" }, "p", sibs)).toEqual({
      id: "m",
      parent: "p",
      order: 301,
      collision: false,
    });
    expect(planDrop("m", { kind: "before", id: "b" }, "p", sibs).order).toBe(150);
    expect(planDrop("m", { kind: "before", id: "a" }, "p", sibs).order).toBe(0);
    expect(planDrop("m", { kind: "before", id: "c" }, "p", sibs).collision).toBe(true);
    expect(planDrop("m", { kind: "into", id: "p" }, "p", []).order).toBe(100);
  });

  it("round-trips drop ids", () => {
    expect(parseDropId("before:a:b")).toEqual({ kind: "before", id: "a:b" });
    expect(parseDropId("t1")).toBeNull();
  });

  it("sends the structure fields the options name, and only those", () => {
    const plan = { id: "t1", parent: "d2", order: 300, collision: false };
    expect(reparentRequest("org", org, plan, 4)).toEqual({
      collection: "org",
      id: "t1",
      parent: "d2",
      order: 300,
      expected_version: 4,
      fields: {
        parent_field: "parent_id",
        order_field: "order",
        depth_field: "depth",
        ancestor_ids_field: "ancestor_ids",
        children_count_field: "children_count",
      },
    });
    const bare = TreeOptionsSchema.parse({ parent_field: "up", order_field: "pos" });
    expect(reparentRequest("x", bare, plan, undefined)).toEqual({
      collection: "x",
      id: "t1",
      parent: "d2",
      order: 300,
      fields: { parent_field: "up", order_field: "pos" },
    });
  });

  it("draws moved rows at their new parent before the lists are read again", () => {
    const moved = new Map([["t1", { row: byId.get("t1") as Row, parent: "d2", order: 50 }]]);
    expect(ids(withMoves([], "d2", moved, { opts: org }))).toEqual(["t1"]);
    expect(ids(withMoves([byId.get("t1") as Row], "d1", moved, { opts: org }))).toEqual([]);
  });
});

describe("lazy queries", () => {
  const chip = { field: "kind", op: "in" as const, value: ["team"] };

  it("roots by root_filter, or every match when filtered", () => {
    expect(lazyRootsQuery(org, undefined)).toEqual({
      filter: { field: "parent_id", op: "is_null" },
      sort: org.sibling_sort,
      limit: 300,
    });
    expect(lazyRootsQuery(org, chip).filter).toEqual(chip);
    const eq = TreeOptionsSchema.parse({
      lazy: true,
      children_count_field: "n",
      root_filter: { field: "level", op: "eq", value: 0 },
    });
    expect(lazyRootsQuery(eq, undefined).filter).toEqual({ field: "level", op: "eq", value: 0 });
  });

  it("children: parent eq id and the data view's filter, sibling_sort, lazy_page_size", () => {
    expect(lazyChildrenQuery(org, "d1", undefined)).toEqual({
      filter: { field: "parent_id", op: "eq", value: "d1" },
      sort: [
        { field: "kind", dir: "asc" },
        { field: "order", dir: "asc" },
      ],
      limit: 300,
    });
    expect(lazyChildrenQuery(org, "d1", chip).filter).toEqual({
      and: [{ field: "parent_id", op: "eq", value: "d1" }, chip],
    });
  });
});

describe("replyRow", () => {
  const schema = SchemaDocSchema.parse({
    version: "v1",
    fields: {
      parent_id: { type: "string" },
      order: { type: "integer" },
      depth: { type: "integer" },
      body: { type: "text" },
      author: { type: "string" },
      author_initials: { type: "string" },
      created_at: { type: "datetime" },
    },
  });

  it("is the next sparse order, one level deeper, by You, now", () => {
    const parent = row("p", 3, { depth: 2 });
    const sibs = [row("s1", 1, { order: 100 }), row("s2", 1, { order: 700 })];
    expect(
      replyRow(thread, schema, parent, sibs, "Slažem se", new Date("2026-10-28T08:00:00Z")),
    ).toEqual({
      parent_id: "p",
      body: "Slažem se",
      order: 800,
      depth: 3,
      author_initials: "YO",
      author: "You",
      created_at: "2026-10-28T08:00:00.000Z",
    });
    expect(replyRow(thread, schema, parent, [], "x", new Date()).order).toBe(100);
  });
});

describe("<TreeRenderer>", () => {
  beforeEach(() => localStorage.clear());

  const schema = SchemaDocSchema.parse({
    version: "v1",
    fields: {
      parent_id: { type: "string" },
      order: { type: "integer" },
      depth: { type: "integer" },
      body: { type: "text" },
      created_at: { type: "datetime" },
    },
  });

  function renderTree(search = "", treeOptions: Record<string, unknown> = {}) {
    const mock = mockUdcFetch({ list: () => ({ ok: listOf(rows) }) });
    const client = new UdcClient({ httpUrl: "http://api", fetch: mock.fetch });
    const describe: DescribeResponse = {
      collection: "comments",
      capabilities: {
        mutate: true,
        subscribe: false,
        total_count: true,
        schema_edit: false,
        config_edit: false,
        reindex: true,
        tree_reparent: true,
        source_yaml: false,
        supported_filter_ops: [],
      },
      schema,
      view: ViewConfigSchema.parse({
        available_renderers: ["tree"],
        search: { fields: ["body"] },
        tree_options: {
          label_field: "body",
          sibling_sort: [{ field: "created_at" }],
          expand: { default_depth: 99, key: "t" },
          ...treeOptions,
        },
      }),
      filterable: { fields: [] },
      source_kind: "postgres_jsonb",
    };
    const onCount = vi.fn();
    const props: RendererProps = {
      collection: "comments",
      describe,
      data: {} as UdcCollectionResult,
      filter: search ? { field: "body", op: "contains", value: search } : undefined,
      baseFilter: undefined,
      search,
      sort: [],
      onSort: () => {},
      mode: "infinite",
      page: 1,
      limit: 50,
      onPage: () => {},
      filtered: false,
      onClearFilters: () => {},
      resetKey: "",
      onCount,
    };
    render(
      <UdcI18nProvider>
        <UdcProvider client={client}>
          <QueryClientProvider client={createUdcQueryClient()}>
            <TooltipProvider>
              <Toaster>
                <MemoryRouter>
                  <TreeRenderer {...props} />
                </MemoryRouter>
              </Toaster>
            </TooltipProvider>
          </QueryClientProvider>
        </UdcProvider>
      </UdcI18nProvider>,
    );
    return { mock, onCount };
  }

  it("draws the whole thread expanded, an orphan marked, and counts nodes", async () => {
    const { onCount } = renderTree();
    await waitFor(() => expect(screen.getAllByTestId("tree-row")).toHaveLength(6));
    expect(screen.getAllByTestId("tree-orphan")).toHaveLength(1);
    await waitFor(() =>
      expect(onCount).toHaveBeenLastCalledWith({ shown: 6, total: 6, unit: "nodes" }),
    );
  });

  it("highlight_and_expand: searches in the browser, not on the server", async () => {
    const { mock } = renderTree("beograd");
    await waitFor(() => expect(screen.getAllByTestId("tree-highlight")).toHaveLength(2));
    // collapse_others: only the way to the matches is open, the rest of "a" stays loaded but shut.
    const open = screen.getAllByTestId("tree-row").filter((r) => r.hasAttribute("data-open"));
    expect(open.map((r) => r.dataset.id).sort()).toEqual(["a", "a1"]);
    for (const call of mock.calls) expect(call.body.filter).toBeUndefined();
  });

  it("filter_only hands the search to the server", async () => {
    const { mock } = renderTree("beograd", { on_search: { mode: "filter_only" } });
    await waitFor(() => expect(mock.calls.length).toBeGreaterThan(0));
    expect(mock.calls[0]?.body.filter).toEqual({ field: "body", op: "contains", value: "beograd" });
    await screen.findAllByTestId("tree-row");
    expect(screen.queryByTestId("tree-highlight")).toBeNull();
  });

  it("collapses with the keyboard and opens the detail on Enter", async () => {
    renderTree();
    const a = await screen.findByText("Prvi komentar iz Beograda");
    const rowEl = a.closest("[data-tree-row]") as HTMLElement;
    rowEl.focus();
    fireEvent.keyDown(rowEl, { key: "ArrowLeft" });
    await waitFor(() => expect(screen.getAllByTestId("tree-row")).toHaveLength(3));
    fireEvent.keyDown(rowEl, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getAllByTestId("tree-row")).toHaveLength(6));
    fireEvent.keyDown(rowEl, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("data-id")).toBe("a1");
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });
    expect(await screen.findByTestId("tree-detail")).toBeInTheDocument();
  });
});
