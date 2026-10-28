import { describe, expect, it } from "vitest";
import {
  ACTION_NAMES,
  ACTIONS,
  FIELD_TYPES,
  filter as f,
  isActionName,
  isPhase1Type,
  isValidFieldName,
  PHASE1_FIELD_TYPES,
  SchemaDocSchema,
  SUPPORTED_OPS,
} from "../src/index.js";

const schema = { version: "v1", core_fields: [], fields: { name: { type: "string" } } };
const capabilities = {
  mutate: true,
  subscribe: false,
  total_count: true,
  schema_edit: true,
  config_edit: false,
  reindex: false,
  tree_reparent: false,
  supported_filter_ops: [...SUPPORTED_OPS],
};
const row = { __meta: { id: "r1", version: 2 }, name: "Alfa" };

describe("ACTIONS registry", () => {
  it("lists every action", () => {
    expect(ACTION_NAMES).toEqual([
      "collections",
      "describe",
      "list",
      "read",
      "mutate",
      "schema.add_field",
      "schema.update_field",
      "schema.soft_delete_field",
      "reindex",
      "tree.reparent",
      "source.read",
    ]);
    expect(isActionName("list")).toBe(true);
    expect(isActionName("toString")).toBe(false);
  });

  const OK: [keyof typeof ACTIONS, unknown, unknown][] = [
    [
      "collections",
      {},
      {
        collections: [
          {
            name: "companies",
            default_renderer: "table",
            capabilities,
            source_kind: "postgres_jsonb",
            group: "database",
          },
        ],
      },
    ],
    [
      "describe",
      { collection: "companies" },
      {
        collection: "companies",
        source_kind: "postgres_jsonb",
        docs: { en: "# Companies" },
        capabilities,
        schema,
        view: {},
        filterable: {
          fields: [
            {
              field: "name",
              type: "string",
              ops: ["contains"],
              default_op: "contains",
              widget: "text",
            },
          ],
        },
      },
    ],
    [
      "list",
      {
        collection: "companies",
        filter: f.eq("name", "x"),
        sort: [{ field: "name" }],
        page: { limit: 10 },
      },
      { rows: [row], next_cursor: null, total: 1 },
    ],
    ["read", { collection: "companies", id: "r1" }, { row }],
    [
      "source.read",
      { collection: "menu" },
      { path: "menu/data/menu.yaml", text: "- code: HOME\n", mtime: "2026-10-28T10:00:00.000Z" },
    ],
    [
      "mutate",
      { collection: "companies", op: "update", id: "r1", row: { name: "B" }, expected_version: 2 },
      { row },
    ],
    [
      "schema.add_field",
      {
        collection: "companies",
        name: "rating",
        fielddef: { type: "decimal" },
        position: { where: "after", anchor: "name" },
      },
      { schema },
    ],
    [
      "schema.update_field",
      { collection: "companies", name: "name", fielddef: { type: "string", length: 9 } },
      { schema },
    ],
    ["schema.soft_delete_field", { collection: "companies", field: "name" }, { schema }],
  ];

  it.each(OK)("%s accepts a valid request and response", (action, request, response) => {
    expect(ACTIONS[action].request.safeParse(request).error).toBeUndefined();
    expect(ACTIONS[action].response.safeParse(response).error).toBeUndefined();
  });

  it.each([
    ["describe", {}],
    ["list", { collection: "c", filter: { field: "a", op: "like" } }],
    ["list", { collection: "c", page: { cursor: "x", offset: 1 } }],
    ["read", { collection: "c" }],
    ["mutate", { collection: "c", op: "update", row: {} }],
    ["mutate", { collection: "c", op: "insert" }],
    ["mutate", { collection: "c", op: "upsert", row: {} }],
    [
      "schema.add_field",
      {
        collection: "c",
        name: "Bad Name",
        fielddef: { type: "string" },
        position: { where: "end" },
      },
    ],
    [
      "schema.add_field",
      { collection: "c", name: "x", fielddef: { type: "string" }, position: { where: "before" } },
    ],
    [
      "schema.add_field",
      { collection: "c", name: "x", fielddef: { type: "money" }, position: { where: "end" } },
    ],
    ["schema.soft_delete_field", { collection: "c", name: "x" }],
  ] as const)("%s rejects %j", (action, request) => {
    expect(ACTIONS[action].request.safeParse(request).success).toBe(false);
  });

  it("mutate delete needs only an id", () => {
    expect(
      ACTIONS.mutate.request.safeParse({ collection: "c", op: "delete", id: "1" }).success,
    ).toBe(true);
  });

  it("list response requires next_cursor and total", () => {
    expect(ACTIONS.list.response.safeParse({ rows: [] }).success).toBe(false);
  });
});

describe("SchemaDoc", () => {
  it("defaults field_order to the field keys and appends unlisted ones", () => {
    const doc = SchemaDocSchema.parse({
      version: "v2",
      fields: { a: { type: "string" }, b: { type: "integer" }, c: { type: "bool" } },
      field_order: ["c", "a"],
    });
    expect(doc.field_order).toEqual(["c", "a", "b"]);
    expect(doc.core_fields).toEqual([]);
  });

  it.each([
    [{ version: 1, fields: {} }],
    [{ version: "v1", fields: { Name: { type: "string" } } }],
    [{ version: "v1", fields: { a: { type: "string" } }, field_order: ["a", "zz"] }],
    [{ version: "v1", fields: { a: { type: "string" } }, field_order: ["a", "a"] }],
    [{ version: "v1", fields: { a: { type: "enum" } } }],
    [{ version: "v1", fields: { a: { type: "integer", min: 5, max: 1 } } }],
  ])("rejects %j", (raw) => {
    expect(SchemaDocSchema.safeParse(raw).success).toBe(false);
  });

  it("keeps field-def extras", () => {
    const doc = SchemaDocSchema.parse({
      version: "v1",
      fields: { r: { type: "rating", rating_type: "stars", max_rate: 5 } },
    });
    expect(doc.fields.r).toMatchObject({ rating_type: "stars", max_rate: 5 });
  });
});

describe("field types and names", () => {
  it("knows all 16 udc-py types and the 9 phase-1 ones", () => {
    expect(FIELD_TYPES).toHaveLength(16);
    expect(PHASE1_FIELD_TYPES).toHaveLength(9);
    expect(FIELD_TYPES.filter(isPhase1Type)).toEqual(
      expect.arrayContaining([
        "string",
        "text",
        "integer",
        "decimal",
        "year",
        "bool",
        "date",
        "datetime",
        "json",
      ]),
    );
    expect(isPhase1Type("enum")).toBe(false);
    expect(isPhase1Type("image")).toBe(false);
  });

  it.each([["a"], ["revenue_eur"], ["a1_b2"], ["a".repeat(63)]])(
    "accepts field name %s",
    (name) => {
      expect(isValidFieldName(name)).toBe(true);
    },
  );

  it.each([
    [""],
    ["1a"],
    ["_a"],
    ["Name"],
    ["a-b"],
    ["a b"],
    ["a".repeat(64)],
    ["data->>'x'"],
    [5],
  ])("rejects field name %j", (name) => {
    expect(isValidFieldName(name)).toBe(false);
  });
});
