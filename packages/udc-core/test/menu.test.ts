import { describe, expect, it } from "vitest";
import {
  CapabilitiesSchema,
  MENU_SCHEMA,
  MenuFileSchema,
  MenuRefSchema,
  menuSchemaProblems,
  parseMenuRef,
  SchemaDocSchema,
  SUPPORTED_OPS,
} from "../src/index.js";

describe("MENU_SCHEMA", () => {
  it("is the fixed menu row", () => {
    expect(MENU_SCHEMA.field_order).toEqual([
      "code",
      "translation_key",
      "icon",
      "url",
      "parent_id",
      "order",
      "depth",
      "ancestor_ids",
      "children_count",
      "is_dynamic",
    ]);
    const types = Object.fromEntries(
      Object.entries(MENU_SCHEMA.fields).map(([name, def]) => [name, def.type]),
    );
    expect(types).toEqual({
      code: "string",
      translation_key: "string",
      icon: "string",
      url: "string",
      parent_id: "string",
      order: "integer",
      depth: "integer",
      ancestor_ids: "json",
      children_count: "integer",
      is_dynamic: "bool",
    });
    expect(menuSchemaProblems(MENU_SCHEMA)).toEqual([]);
  });

  it("names where a schema.json disagrees", () => {
    const { is_dynamic: _, ...fields } = MENU_SCHEMA.fields;
    const other = SchemaDocSchema.parse({
      version: "v1",
      fields: { ...fields, order: { type: "string" }, label: { type: "string" } },
    });
    expect(menuSchemaProblems(other)).toEqual([
      "order: is string, a menu row has integer",
      "is_dynamic: missing (a menu row has it)",
      "label: not a field of a menu row",
    ]);
  });
});

describe("menu reference grammar", () => {
  it("parses udc:collections with and without a group", () => {
    expect(parseMenuRef("udc:collections")).toEqual({ scheme: "udc", target: "collections" });
    expect(parseMenuRef("udc:collections?group=database")).toEqual({
      scheme: "udc",
      target: "collections",
      group: "database",
    });
    expect(parseMenuRef("udc:collections?group=internet").group).toBe("internet");
  });

  it("parses api: as a reference and refuses it as out of scope", () => {
    expect(MenuRefSchema.parse("api:/api/menu/x")).toEqual({ scheme: "api", path: "/api/menu/x" });
    expect(() => parseMenuRef("api:/api/menu/x")).toThrow(/api: references .* not supported/);
  });

  it("refuses garbage", () => {
    for (const bad of [
      "",
      "collections",
      "udc:",
      "udc:tables",
      "udc:collections?group=cloud",
      "udc:collections?kind=memory",
      "udc:collections?group=files&x=1",
      "api:no-slash",
      "http://example.com",
    ]) {
      expect(() => parseMenuRef(bad), bad).toThrow();
    }
  });
});

describe("MenuFileSchema", () => {
  it("reads nested nodes, string children and an empty file", () => {
    const menu = MenuFileSchema.parse([
      { code: "HOME", url: "/" },
      { code: "COLL", children: [{ code: "DB", children: "udc:collections?group=database" }] },
    ]);
    expect(menu).toHaveLength(2);
    expect(MenuFileSchema.parse(null)).toEqual([]);
  });

  it("refuses duplicate sibling codes, a code with a slash and a node without code", () => {
    expect(MenuFileSchema.safeParse([{ code: "A" }, { code: "A" }]).success).toBe(false);
    expect(MenuFileSchema.safeParse([{ code: "A/B" }]).success).toBe(false);
    expect(MenuFileSchema.safeParse([{ url: "/" }]).success).toBe(false);
    expect(MenuFileSchema.safeParse([{ code: "A", children: [{ code: "A" }] }]).success).toBe(true);
  });
});

describe("Capabilities.source_yaml", () => {
  it("defaults to false", () => {
    const caps = {
      mutate: false,
      subscribe: false,
      total_count: true,
      schema_edit: false,
      config_edit: false,
      reindex: false,
      tree_reparent: false,
      supported_filter_ops: [...SUPPORTED_OPS],
    };
    expect(CapabilitiesSchema.parse(caps).source_yaml).toBe(false);
    expect(CapabilitiesSchema.parse({ ...caps, source_yaml: true }).source_yaml).toBe(true);
  });
});
