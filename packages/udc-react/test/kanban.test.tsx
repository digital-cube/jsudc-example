import {
  type DescribeResponse,
  KanbanOptionsSchema,
  type Row,
  SchemaDocSchema,
  ViewConfigSchema,
} from "@jsudc/core";
import { UdcClient } from "@jsudc/core/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { Toaster } from "../src/components/ui/toast";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { UdcI18nProvider } from "../src/i18n/i18n";
import { KanbanRenderer } from "../src/kanban/KanbanRenderer";
import {
  boardSource,
  bucketsOf,
  groupCards,
  isOverdue,
  isReadOnly,
  newBucketRow,
  planDrop,
  priorityTone,
  quickAddRow,
} from "../src/kanban/model";
import { persistOrder } from "../src/kanban/persist";
import { rendererEntry, rendererTabs, resolveTab } from "../src/renderers/registry";
import type { RendererProps } from "../src/renderers/types";
import type { UdcCollectionResult } from "../src/udc/hooks";
import { createUdcQueryClient, UdcProvider } from "../src/udc/provider";
import { listOf, mockUdcFetch, row } from "./fetchMock";

const opts = KanbanOptionsSchema.parse({
  bucket_collection: "buckets",
  bucket_filter_field: "board_id",
  bucket_color_field: "color",
  ticket_board_field: "board_id",
  ticket_bucket_field: "bucket_id",
  card: { title_field: "title", priority_field: "priority", tags_field: "tags" },
});

const schema = SchemaDocSchema.parse({
  version: "v1",
  fields: {
    board_id: { type: "relation", ref: "boards", label_field: "name" },
    bucket_id: { type: "relation", ref: "buckets" },
    order: { type: "integer" },
    title: { type: "string" },
    priority: { type: "enum", values: ["low", "normal", "high", "urgent"] },
    tags: { type: "string_array" },
  },
});

describe("renderer registry", () => {
  it("knows table, cards, kanban, calendar, tree, map and chart; other names have no component", () => {
    expect(rendererEntry("kanban")?.paging).toBe(false);
    expect(rendererEntry("table")).toMatchObject({ paging: true, editMode: true });
    expect(rendererEntry("cards")).toMatchObject({ paging: true, editMode: false });
    expect(rendererEntry("calendar")?.paging).toBe(false);
    expect(rendererEntry("tree")).toMatchObject({ paging: false, editMode: false });
    expect(rendererEntry("map")).toMatchObject({ paging: false, editMode: false });
    expect(rendererEntry("chart")).toMatchObject({ paging: false, editMode: false });
    expect(rendererEntry("gantt")).toBeUndefined();
    expect(rendererEntry("toString")).toBeUndefined();
  });

  it("builds a tab per available name, disabled when it has no component", () => {
    const tabs = rendererTabs(["kanban", "gantt", "table"]);
    expect(tabs.map((t) => [t.name, t.entry !== undefined])).toEqual([
      ["kanban", true],
      ["gantt", false],
      ["table", true],
    ]);
  });

  it.each([
    ["cards", ["table", "cards"], "table", "cards"],
    ["gantt", ["gantt", "kanban"], "gantt", "kanban"],
    ["", ["kanban", "table"], "kanban", "kanban"],
    ["table", ["kanban"], "kanban", "kanban"],
    ["", ["gantt"], "gantt", "table"],
  ] as const)("asked %s of %j (default %s) → %s", (requested, available, fallback, expected) => {
    expect(resolveTab(requested, available, fallback)).toBe(expected);
  });
});

const card = (id: string, bucket: string, order: number | null, extra = {}) =>
  row(id, 1, { bucket_id: bucket, order, title: id, ...extra });

describe("kanban model", () => {
  const buckets = bucketsOf(
    [
      row("b2", 1, { name: "Doing", order: 200, color: "accent" }),
      row("b1", 1, { name: "Todo", order: 100, color: "plum" }),
    ],
    opts,
  );

  it("orders the buckets and keeps only known colours", () => {
    expect(buckets.map((b) => [b.id, b.label, b.color])).toEqual([
      ["b1", "Todo", null],
      ["b2", "Doing", "accent"],
    ]);
  });

  it("groups cards by bucket in order, NULLs last, and applies pending moves", () => {
    const cards = [
      card("c", "b1", 300),
      card("a", "b1", null),
      card("b", "b1", 100),
      card("x", "zz", 1),
    ];
    const grouped = groupCards(
      cards,
      buckets,
      opts,
      new Map([["c", { bucketId: "b2", order: 5 }]]),
    );
    expect(grouped.b1?.map((r) => r.__meta.id)).toEqual(["b", "a"]);
    expect(grouped.b2?.map((r) => [r.__meta.id, r.order])).toEqual([["c", 5]]);
  });

  const orders = new Map<string, number | null>([
    ["a", 100],
    ["b", 200],
    ["c", 300],
    ["d", 100],
    ["e", 101],
  ]);

  it.each([
    [
      "top of another bucket",
      { id: "a", fromBucket: "b1", fromIds: ["a"], toBucket: "b2", toIds: ["a", "b", "c"] },
      { order: 100, moved: true, prevId: null, nextId: "b" },
    ],
    [
      "end of another bucket",
      { id: "a", fromBucket: "b1", fromIds: ["a"], toBucket: "b2", toIds: ["b", "c", "a"] },
      { order: 400, moved: true, prevId: "c", nextId: null },
    ],
    [
      "empty bucket",
      { id: "a", fromBucket: "b1", fromIds: ["a"], toBucket: "b2", toIds: ["a"] },
      { order: 100, collision: false },
    ],
    [
      "down within the bucket",
      {
        id: "a",
        fromBucket: "b1",
        fromIds: ["a", "b", "c"],
        toBucket: "b1",
        toIds: ["b", "a", "c"],
      },
      { order: 250, moved: false },
    ],
    [
      "between colliding orders",
      { id: "a", fromBucket: "b1", fromIds: ["a"], toBucket: "b2", toIds: ["d", "a", "e"] },
      { order: 100, collision: true },
    ],
  ])("drop: %s", (_, input, expected) => {
    expect(planDrop({ ...input, orders })).toMatchObject({
      id: "a",
      collision: false,
      ...expected,
    });
  });

  it("a drop on its own slot is no move", () => {
    expect(
      planDrop({
        id: "b",
        fromBucket: "b1",
        fromIds: ["a", "b"],
        toBucket: "b1",
        toIds: ["a", "b"],
        orders,
      }),
    ).toBeNull();
  });

  it("quick-add writes title, board, bucket and order first−100 or last+100", () => {
    const base = { title: "New", boardId: "B", bucketId: "b1", orders: [100, 200, null] };
    expect(quickAddRow(opts, { ...base, where: "top" })).toEqual({
      title: "New",
      board_id: "B",
      bucket_id: "b1",
      order: 0,
    });
    expect(quickAddRow(opts, { ...base, where: "bottom" }).order).toBe(300);
    expect(quickAddRow(opts, { ...base, orders: [], where: "bottom" }).order).toBe(100);
  });

  it("a new bucket goes after the last one", () => {
    expect(newBucketRow(opts, { name: "Later", boardId: "B", buckets })).toEqual({
      name: "Later",
      board_id: "B",
      order: 300,
    });
  });

  it("priority tone follows the enum order", () => {
    const def = schema.fields.priority;
    expect(["low", "normal", "high", "urgent", "nope"].map((p) => priorityTone(p, def))).toEqual([
      "muted",
      "info",
      "warning",
      "danger",
      null,
    ]);
    expect(priorityTone("low", schema.fields.title)).toBeNull();
  });

  it("finds the board collection from the relation", () => {
    expect(boardSource(schema, opts)).toEqual({ collection: "boards", labelField: "name" });
  });

  it("overdue is before today", () => {
    const today = new Date(2026, 9, 27);
    expect(isOverdue("2026-10-26", today)).toBe(true);
    expect(isOverdue("2026-10-27", today)).toBe(false);
    expect(isOverdue(null, today)).toBe(false);
  });

  it("read-only from the options or the capabilities", () => {
    expect(isReadOnly(opts, { mutate: true })).toBe(false);
    expect(isReadOnly(opts, { mutate: false })).toBe(true);
    expect(isReadOnly({ ...opts, permissions: { read_only: true } }, { mutate: true })).toBe(true);
  });
});

describe("persistOrder", () => {
  const plan = {
    id: "m",
    bucketId: "b1",
    moved: true,
    order: 100,
    collision: true,
    prevId: "p",
    nextId: "n",
  };

  it("reindexes, re-reads the neighbours and retries once with their new orders", async () => {
    const mock = mockUdcFetch({
      reindex: () => ({ ok: { updated: 2 } }),
      list: () => ({ ok: listOf([row("p", 2, { order: 100 }), row("n", 2, { order: 200 })]) }),
      read: () => ({ ok: { row: row("m", 4, { order: 7 }) } }),
    });
    const mutate = vi.fn(async () => ({}));
    const onOrder = vi.fn();
    const res = await persistOrder({
      client: new UdcClient({ httpUrl: "http://api", fetch: mock.fetch }),
      collection: "tickets",
      orderField: "order",
      scope: { bucket_id: "b1" },
      plan,
      version: 3,
      patch: { bucket_id: "b1" },
      mutate,
      onOrder,
    });
    expect(res).toEqual({ reindexed: true });
    expect(mock.calls.map((c) => c.action)).toEqual(["reindex", "list", "read"]);
    expect(mock.calls[0]?.body).toEqual({
      collection: "tickets",
      scope: { bucket_id: "b1" },
      order_field: "order",
    });
    expect(onOrder).toHaveBeenCalledWith(150);
    expect(mutate).toHaveBeenCalledWith({
      op: "update",
      id: "m",
      row: { bucket_id: "b1", order: 150 },
      expected_version: 4,
    });
  });

  it("gives up when there is still no room", async () => {
    const mock = mockUdcFetch({
      reindex: () => ({ ok: { updated: 2 } }),
      list: () => ({ ok: listOf([row("p", 2, { order: 100 }), row("n", 2, { order: 101 })]) }),
    });
    const mutate = vi.fn();
    await expect(
      persistOrder({
        client: new UdcClient({ httpUrl: "http://api", fetch: mock.fetch }),
        collection: "tickets",
        orderField: "order",
        scope: { bucket_id: "b1" },
        plan,
        version: 3,
        patch: {},
        mutate,
      }),
    ).rejects.toThrow(/no room/);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("without a collision it only updates", async () => {
    const mock = mockUdcFetch({});
    const mutate = vi.fn(async () => ({}));
    await persistOrder({
      client: new UdcClient({ httpUrl: "http://api", fetch: mock.fetch }),
      collection: "tickets",
      orderField: "order",
      scope: { bucket_id: "b1" },
      plan: { ...plan, collision: false, order: 150 },
      version: 3,
      patch: {},
      mutate,
    });
    expect(mock.calls).toEqual([]);
    expect(mutate).toHaveBeenCalledWith({
      op: "update",
      id: "m",
      row: { order: 150 },
      expected_version: 3,
    });
  });
});

describe("KanbanRenderer read-only gating", () => {
  const view = ViewConfigSchema.parse({
    available_renderers: ["kanban"],
    default_renderer: "kanban",
    kanban_options: opts,
  });

  function renderBoard(capabilities: { mutate: boolean }, readOnly = false) {
    const handlers = {
      describe: () => ({
        ok: {
          collection: "boards",
          capabilities: { ...describeOf().capabilities },
          schema: SchemaDocSchema.parse({
            version: "v1",
            fields: { name: { type: "string" }, order: { type: "integer" } },
          }),
          view: ViewConfigSchema.parse({}),
          filterable: { fields: [] },
          source_kind: "postgres_jsonb",
        },
      }),
      list: (body: Record<string, unknown>) => {
        if (body.collection === "boards") return { ok: listOf([row("B", 1, { name: "Board" })]) };
        if (body.collection === "buckets")
          return { ok: listOf([row("b1", 1, { name: "Todo", order: 100, board_id: "B" })]) };
        return { ok: listOf([card("c1", "b1", 100, { board_id: "B" }) as Row]) };
      },
    };
    const mock = mockUdcFetch(handlers);
    const client = new UdcClient({ httpUrl: "http://api", fetch: mock.fetch });
    const d = describeOf();
    const describe: DescribeResponse = {
      ...d,
      capabilities: { ...d.capabilities, ...capabilities },
      view: { ...view, kanban_options: { ...opts, permissions: { read_only: readOnly } } },
    };
    const props: RendererProps = {
      collection: "tickets",
      describe,
      data: {} as UdcCollectionResult,
      filter: undefined,
      baseFilter: undefined,
      search: "",
      sort: [],
      onSort: () => {},
      mode: "infinite",
      page: 1,
      limit: 50,
      onPage: () => {},
      filtered: false,
      onClearFilters: () => {},
      resetKey: "",
      onCount: vi.fn(),
    };
    render(
      <UdcI18nProvider>
        <UdcProvider client={client}>
          <QueryClientProvider client={createUdcQueryClient()}>
            <TooltipProvider>
              <Toaster>
                <MemoryRouter>
                  <KanbanRenderer {...props} />
                </MemoryRouter>
              </Toaster>
            </TooltipProvider>
          </QueryClientProvider>
        </UdcProvider>
      </UdcI18nProvider>,
    );
    return { props, mock };
  }

  function describeOf(): DescribeResponse {
    return {
      collection: "tickets",
      capabilities: {
        mutate: true,
        subscribe: false,
        total_count: true,
        schema_edit: false,
        config_edit: false,
        reindex: true,
        tree_reparent: false,
        source_yaml: false,
        supported_filter_ops: [],
      },
      schema,
      view,
      filterable: { fields: [] },
      source_kind: "postgres_jsonb",
    };
  }

  it("a writable board offers quick-add, the column menu and add bucket", async () => {
    const { props } = renderBoard({ mutate: true });
    await screen.findByText("c1");
    expect(screen.getAllByTestId(/^kanban-add-(top|bottom)$/)).toHaveLength(2);
    expect(screen.getByTestId("kanban-column-menu")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-add-bucket")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-card")).toHaveAttribute("aria-roledescription", "sortable");
    await waitFor(() => expect(props.onCount).toHaveBeenCalledWith({ shown: 1, total: 1 }));
  });

  it.each([
    ["capabilities.mutate false", { mutate: false }, false],
    ["permissions.read_only", { mutate: true }, true],
  ])("%s hides every write affordance", async (_, caps, readOnly) => {
    renderBoard(caps, readOnly);
    await screen.findByText("c1");
    expect(screen.queryByTestId(/^kanban-add/)).toBeNull();
    expect(screen.queryByTestId("kanban-column-menu")).toBeNull();
    expect(screen.getByTestId("kanban-card")).toHaveAttribute("aria-disabled", "true");
  });
});
