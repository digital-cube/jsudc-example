import { SchemaDocSchema, ViewConfigSchema } from "@jsudc/core";
import { describe, expect, it } from "vitest";
import { liveSort, liveView, pruneTree } from "../src/data-view/liveView";
import { lookup, makeT, mergeMessages, schemaLabelTerms } from "../src/i18n/i18n";
import { TRANSLATIONS } from "../src/i18n/translations";

const schema = SchemaDocSchema.parse({
  version: "v2",
  fields: {
    name: { type: "string", label: { en: "Company", sr: "Firma" } },
    city: { type: "string", deleted: true },
    website: { type: "string", label: { en: "Website" } },
    note: { type: "text", label: "Napomena" },
  },
});

describe("liveView", () => {
  it("drops chips, search fields, card slots and row_color on deleted fields", () => {
    const view = ViewConfigSchema.parse({
      columns: [{ field: "name" }, { field: "city" }],
      search: { fields: ["name", "city"] },
      filters: [
        { field: "city", kind: "select" },
        { field: "name", kind: "select" },
      ],
      card_options: {
        title_field: "city",
        subtitle_field: "name",
        meta_fields: ["city", "website"],
      },
      row_color: { field: "city", rules: [] },
    });
    const live = liveView(view, schema);
    expect(live.columns.map((c) => c.field)).toEqual(["name"]);
    expect(live.search?.fields).toEqual(["name"]);
    expect(live.filters?.map((f) => f.field)).toEqual(["name"]);
    expect(live.card_options).toEqual({ subtitle_field: "name", meta_fields: ["website"] });
    expect(live.row_color).toBeUndefined();
  });

  it("prunes sort keys and filter conditions on gone fields", () => {
    expect(
      liveSort(
        [
          { field: "city", dir: "asc" },
          { field: "name", dir: "desc" },
        ],
        schema,
      ),
    ).toEqual([{ field: "name", dir: "desc" }]);
    expect(
      pruneTree(
        {
          and: [
            { field: "city", op: "eq", value: "Niš" },
            { or: [{ field: "city", op: "is_null" }] },
            { not: { field: "name", op: "eq", value: "x" } },
          ],
        },
        schema,
      ),
    ).toEqual({ and: [{ not: { field: "name", op: "eq", value: "x" } }] });
    expect(pruneTree({ field: "city", op: "is_null" }, schema)).toBeNull();
    expect(pruneTree(null, schema)).toBeNull();
  });
});

describe("schema labels in i18n", () => {
  it("turns fielddef.label into overlay terms", () => {
    expect(schemaLabelTerms(schema)).toEqual({
      NAME: { en: "Company", sr: "Firma" },
      CITY: undefined,
      WEBSITE: { en: "Website" },
      NOTE: { en: "Napomena", sr: "Napomena" },
    } as never);
  });

  it("lets an overlay label win over the static map, falling back to en per term", () => {
    // The host's static labels, as the example passes them through `messages`.
    const dict = mergeMessages(TRANSLATIONS, {
      TBL_COMPANIES: {
        NAME: { en: "Name", sr: "Naziv" },
        MB: { en: "Reg. no.", sr: "Matični broj" },
      },
    });
    const overlay = { TBL_COMPANIES: schemaLabelTerms(schema) };
    expect(lookup(dict, "sr", "TBL_COMPANIES", "name", overlay)).toBe("Firma");
    expect(lookup(dict, "sr", "TBL_COMPANIES", "website", overlay)).toBe("Website");
    // Static terms the overlay does not touch stay.
    expect(lookup(dict, "sr", "TBL_COMPANIES", "mb", overlay)).toBe("Matični broj");
    expect(makeT("en", dict, overlay)("TBL_COMPANIES", "name")).toBe("Company");
    expect(makeT("en", dict)("TBL_COMPANIES", "name")).toBe("Name");
  });
});
