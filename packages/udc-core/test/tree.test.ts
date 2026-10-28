import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  ACTIONS,
  isCycle,
  SchemaDocSchema,
  TreeOptionsSchema,
  treeOptionsProblems,
  treeReparentFields,
  ViewConfigSchema,
} from "../src/index.js";

describe("TreeOptions", () => {
  it("fills every default from an empty block, root filter and sort from the field names", () => {
    expect(TreeOptionsSchema.parse({})).toEqual({
      parent_field: "parent_id",
      order_field: "order",
      label_field: "name",
      label_i18n: false,
      lazy: false,
      lazy_page_size: 512,
      root_filter: { field: "parent_id", op: "is_null" },
      sibling_sort: [{ field: "order", dir: "asc" }],
      expand: { persist: "localstorage", default_depth: 1 },
      interactive: { rename: false, reparent: false, reply: false, delete: false },
      on_search: { mode: "highlight_and_expand", collapse_others: true },
    });
  });

  it("derives the defaults from renamed fields and keeps keys jsudc does not read", () => {
    const opts = TreeOptionsSchema.parse({
      parent_field: "up",
      order_field: "pos",
      interactive: { star: true },
      starred_section: { show: true },
    });
    expect(opts.root_filter).toEqual({ field: "up", op: "is_null" });
    expect(opts.sibling_sort).toEqual([{ field: "pos", dir: "asc" }]);
    expect(opts.interactive).toMatchObject({ star: true, rename: false });
    expect(opts).toHaveProperty("starred_section");
  });

  it("refuses a lazy tree without children_count_field", () => {
    const res = TreeOptionsSchema.safeParse({ lazy: true });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(["children_count_field"]);
    expect(TreeOptionsSchema.safeParse({ lazy: true, children_count_field: "n" }).success).toBe(
      true,
    );
  });

  it.each([
    [{ root_filter: { field: "parent_id", op: "eq" } }],
    [{ root_filter: { field: "parent_id", op: "in", value: [1] } }],
    [{ expand: { persist: "server" } }],
    [{ on_search: { mode: "fuzzy" } }],
    [{ lazy_page_size: 0 }],
    [{ sibling_sort: [{ field: "order", dir: "up" }] }],
  ])("refuses %j", (block) => {
    expect(TreeOptionsSchema.safeParse(block).success).toBe(false);
  });

  it("is validated inside a view; tree is a renderer name", () => {
    expect(ViewConfigSchema.safeParse({ tree_options: { lazy: true } }).success).toBe(false);
    const view = ViewConfigSchema.parse({
      available_renderers: ["tree", "table"],
      default_renderer: "tree",
      tree_options: { label_field: "title" },
    });
    expect(view.tree_options?.label_field).toBe("title");
  });

  it("names the structure fields tree.reparent takes, without the absent ones", () => {
    expect(treeReparentFields(TreeOptionsSchema.parse({ depth_field: "depth" }))).toEqual({
      parent_field: "parent_id",
      order_field: "order",
      depth_field: "depth",
    });
  });
});

describe("the backend's tree views", () => {
  const view = (name: string) =>
    ViewConfigSchema.parse(
      parse(
        readFileSync(
          new URL(`../../../backend/collections/${name}/view.yaml`, import.meta.url),
          "utf8",
        ),
      ),
    );

  it("comments: one page, built client-side, reply", () => {
    const v = view("comments");
    expect(v.default_renderer).toBe("tree");
    expect(v.available_renderers).toEqual(["tree", "table"]);
    expect(v.page_size_default).toBe(200);
    expect(v.tree_options).toMatchObject({
      label_field: "body",
      avatar_field: "author_initials",
      depth_field: "depth",
      lazy: false,
      sibling_sort: [{ field: "created_at", dir: "asc" }],
      expand: { persist: "localstorage", key: "comments", default_depth: 99 },
      interactive: { reply: true, rename: false, reparent: false },
      on_search: { mode: "highlight_and_expand", collapse_others: true },
    });
  });

  it("org: lazy, rename and reparent", () => {
    const v = view("org");
    expect(v.tree_options).toMatchObject({
      label_field: "name",
      icon_field: "icon",
      children_count_field: "children_count",
      ancestor_ids_field: "ancestor_ids",
      lazy: true,
      sibling_sort: [
        { field: "kind", dir: "asc" },
        { field: "order", dir: "asc" },
      ],
      expand: { persist: "localstorage", key: "org", default_depth: 1 },
      interactive: { rename: true, reparent: true, reply: false },
    });
  });
});

describe("treeOptionsProblems", () => {
  const schema = SchemaDocSchema.parse({
    version: "v1",
    fields: {
      parent_id: { type: "string" },
      order: { type: "integer" },
      name: { type: "string" },
      depth: { type: "integer" },
      kids: { type: "integer" },
      title: { type: "string" },
      gone: { type: "string", deleted: true },
    },
  });
  const problems = (block: Record<string, unknown>) =>
    treeOptionsProblems(TreeOptionsSchema.parse(block), schema);

  it("is empty when every field fits", () => {
    expect(problems({ depth_field: "depth", children_count_field: "kids", lazy: true })).toEqual(
      [],
    );
  });

  it("names a missing or deleted field, wherever the block names it", () => {
    expect(
      problems({
        label_field: "label",
        icon_field: "gone",
        sibling_sort: [{ field: "created_at" }],
      }),
    ).toEqual([
      "label_field: label is not a field of the schema",
      "icon_field: gone is not a field of the schema",
      "sibling_sort[0]: created_at is not a field of the schema",
    ]);
  });

  it("wants numbers for order, depth and children count", () => {
    expect(problems({ depth_field: "title" })).toEqual([
      "depth_field: title is string, a tree needs a number",
    ]);
  });
});

describe("tree.reparent payloads", () => {
  const fields = { parent_field: "parent_id", order_field: "order" };

  it.each([
    [{ collection: "org", id: "a", parent: "b", order: 150, fields }],
    [{ collection: "org", id: "a", parent: null, order: -100, expected_version: 3, fields }],
    [
      {
        collection: "org",
        id: "a",
        parent: "b",
        order: 1.5,
        fields: {
          ...fields,
          depth_field: "depth",
          ancestor_ids_field: "ancestor_ids",
          children_count_field: "children_count",
        },
      },
    ],
  ])("accepts %j", (req) => {
    expect(ACTIONS["tree.reparent"].request.safeParse(req).error).toBeUndefined();
  });

  it.each([
    [{ collection: "org", id: "a", order: 1, fields }],
    [{ collection: "org", id: "a", parent: "", order: 1, fields }],
    [{ collection: "org", id: "a", parent: null, order: Number.NaN, fields }],
    [{ collection: "org", id: "a", parent: null, order: 1, fields: { parent_field: "p" } }],
    [{ collection: "org", id: "a", parent: null, order: 1, expected_version: 0, fields }],
  ])("refuses %j", (req) => {
    expect(ACTIONS["tree.reparent"].request.safeParse(req).success).toBe(false);
  });

  it("answers the row and a count", () => {
    const row = { __meta: { id: "a", version: 2 }, name: "x" };
    expect(ACTIONS["tree.reparent"].response.safeParse({ row, updated: 4 }).success).toBe(true);
    expect(ACTIONS["tree.reparent"].response.safeParse({ row }).success).toBe(false);
  });
});

describe("isCycle", () => {
  // r ─ a ─ a1 ─ a11
  //   └ b
  const parents = new Map<string, string | null>([
    ["r", null],
    ["a", "r"],
    ["a1", "a"],
    ["a11", "a1"],
    ["b", "r"],
  ]);

  it.each([
    // [node, new parent, cycle?]
    ["a", null, false],
    ["a", "a", true],
    ["a", "a1", true],
    ["a", "a11", true],
    ["r", "a11", true],
    ["a", "b", false],
    ["a11", "b", false],
    ["b", "a11", false],
    ["a1", "r", false],
    ["a", "unknown", false],
  ] as const)("%s under %s: %s", (node, parent, cycle) => {
    expect(isCycle(node, parent, parents)).toBe(cycle);
  });

  it.each([
    ["a", "a11", ["r", "a", "a1"], true],
    ["b", "a11", ["r", "a", "a1"], false],
    ["a", "a", [], true],
    ["a", "r", [], false],
  ] as const)("%s under %s with ancestors %j: %s", (node, parent, ancestors, cycle) => {
    expect(isCycle(node, parent, ancestors)).toBe(cycle);
  });

  it("stops on data that already holds a cycle", () => {
    const loop = new Map([
      ["x", "y"],
      ["y", "x"],
    ]);
    expect(isCycle("z", "x", loop)).toBe(false);
  });
});
