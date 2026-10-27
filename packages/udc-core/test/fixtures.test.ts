import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { SchemaDocSchema, ViewConfigSchema } from "../src/index.js";

const read = (path: string) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url), "utf8");

describe.each(["serbian_companies", "books"])("dclabs %s assets", (name) => {
  it("view.yaml parses verbatim through ViewConfigSchema", () => {
    const raw = parse(read(`${name}/view.yaml`));
    const view = ViewConfigSchema.parse(raw);
    expect(view.default_renderer).toBe("table");
    expect(view.available_renderers).toEqual(["table", "cards"]);
    expect(view.columns.length).toBe(raw.columns.length);
    expect(view.pagination).toBe("infinite");
    expect(view.default_column_width).toBe(160);
  });

  it("schema.json parses verbatim through SchemaDocSchema", () => {
    const raw = JSON.parse(read(`${name}/schema.json`));
    const schema = SchemaDocSchema.parse(raw);
    expect(schema.version).toBe("v1");
    expect(schema.field_order).toEqual(Object.keys(raw.fields));
  });
});

describe("dclabs view details survive parsing", () => {
  it("keeps serbian_companies column styling", () => {
    const view = ViewConfigSchema.parse(parse(read("serbian_companies/view.yaml")));
    const name = view.columns.find((c) => c.field === "name");
    expect(name).toMatchObject({ pin: "left", transform: "titlecase", color: "info", bg: "info" });
    const active = view.columns.find((c) => c.field === "active");
    expect(active?.render_options).toEqual({ style: "check_x" });
    expect(view.row_height).toBe(48);
    expect(view.card_options?.meta_fields).toContain("revenue_eur");
  });

  it("keeps books phase-2 keys", () => {
    const view = ViewConfigSchema.parse(parse(read("books/view.yaml")));
    expect(view.multiselect).toBe(true);
    expect(view.bulk_actions).toEqual([{ kind: "delete", label: "Delete selected" }]);
    expect(view.row_actions).toEqual(["edit"]);
    expect(view.row_color?.rules).toHaveLength(4);
  });

  it("accepts both spellings of the card size", () => {
    for (const size of ["sm", "small", "medium", "lg", "large"]) {
      expect(ViewConfigSchema.parse({ card_options: { size } }).card_options?.size).toBe(size);
    }
    expect(() => ViewConfigSchema.parse({ card_options: { size: "xl" } })).toThrow();
  });

  it("passes unknown keys through", () => {
    const view = ViewConfigSchema.parse({
      gantt_options: { group_field: "status" },
      columns: [{ field: "a", mono: true }],
    });
    expect(view.gantt_options).toEqual({ group_field: "status" });
    expect(view.columns[0]).toMatchObject({ field: "a", mono: true });
  });
});
