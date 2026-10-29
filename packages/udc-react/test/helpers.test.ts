import { describe, expect, it } from "vitest";
import { draftToCondition } from "../src/data-view/FilterBuilder";
import { resolvePagingMode } from "../src/data-view/useDataViewState";
import { makeT, mergeMessages } from "../src/i18n/i18n";
import { TRANSLATIONS } from "../src/i18n/translations";
import { fromEditorValue, sameValue } from "../src/table/CellEditor";
import { displayText, renderKind } from "../src/table/cells";
import { pageWindow } from "../src/table/Pager";
import { resolveRowColor } from "../src/table/style";

const fields = [
  {
    field: "employees",
    type: "integer" as const,
    ops: ["eq", "between", "in", "is_null"] as never,
    default_op: "eq" as const,
    widget: "number",
  },
  {
    field: "name",
    type: "string" as const,
    ops: ["contains", "eq"] as never,
    default_op: "contains" as const,
    widget: "text",
  },
  {
    field: "active",
    type: "bool" as const,
    ops: ["eq"] as never,
    default_op: "eq" as const,
    widget: "bool",
  },
];

describe("filter builder rows", () => {
  it("between, list, null and typed values", () => {
    expect(
      draftToCondition({ field: "employees", op: "between", value: "100", value2: "200" }, fields),
    ).toEqual({ field: "employees", op: "between", value: [100, 200] });
    expect(
      draftToCondition({ field: "employees", op: "between", value: "100", value2: "" }, fields),
    ).toBeNull();
    expect(
      draftToCondition({ field: "employees", op: "in", value: "1, 2,x", value2: "" }, fields),
    ).toEqual({
      field: "employees",
      op: "in",
      value: [1, 2],
    });
    expect(
      draftToCondition({ field: "employees", op: "is_null", value: "", value2: "" }, fields),
    ).toEqual({
      field: "employees",
      op: "is_null",
    });
    expect(
      draftToCondition({ field: "name", op: "contains", value: "beo", value2: "" }, fields),
    ).toEqual({
      field: "name",
      op: "contains",
      value: "beo",
      case_insensitive: true,
    });
    expect(
      draftToCondition({ field: "active", op: "eq", value: "false", value2: "" }, fields),
    ).toEqual({
      field: "active",
      op: "eq",
      value: false,
    });
    expect(
      draftToCondition({ field: "name", op: "gt", value: "1", value2: "" }, fields),
    ).toBeNull();
  });
});

describe("paging mode", () => {
  it("URL beats stored choice beats the view", () => {
    expect(resolvePagingMode("pages", "infinite", "infinite")).toBe("pages");
    expect(resolvePagingMode(null, "pages", "infinite")).toBe("pages");
    expect(resolvePagingMode(null, "garbage", "infinite")).toBe("infinite");
  });
});

describe("i18n", () => {
  it("translates per locale, falls back to en, then to the humanised term", () => {
    const host = mergeMessages(TRANSLATIONS, {
      TBL_COMPANIES: {
        NAME: { en: "Name", sr: "Naziv" },
        REVENUE_EUR: { en: "Revenue (EUR)", sr: "Prihod (EUR)" },
      },
    });
    expect(makeT("sr", host)("TBL_COMPANIES", "name")).toBe("Naziv");
    expect(makeT("en", host)("TBL_COMPANIES", "revenue_eur")).toBe("Revenue (EUR)");
    expect(makeT("sr", host)("TBL_COMPANIES", "website_url")).toBe("Website url");
    expect(makeT("en")("APP", "SHOWING", { shown: 5, total: 9 })).toBe("Showing 5 of 9");
    const t = makeT("sr", { S: { ONLY_EN: { en: "x" } as never } });
    expect(t("S", "ONLY_EN")).toBe("x");
  });
});

describe("cells", () => {
  it("render kind falls back to the field type", () => {
    expect(renderKind({ field: "x" }, { type: "integer" })).toBe("number_format");
    expect(renderKind({ field: "x" }, { type: "date" })).toBe("date");
    expect(renderKind({ field: "x", render: "bool" }, { type: "string" })).toBe("bool");
    expect(renderKind({ field: "x", render: "radar" }, { type: "string" })).toBe("text");
    expect(renderKind({ field: "x", render: "sparkline" }, { type: "json" })).toBe("sparkline");
    expect(renderKind({ field: "x", render: "heading_glyph" }, { type: "decimal" })).toBe(
      "heading_glyph",
    );
  });

  it("formats numbers with locale grouping and lets transforms win", () => {
    expect(displayText(1520875, { field: "r" }, "number_format", "en", "en-US")).toBe("1,520,875");
    expect(displayText(1520875, { field: "r" }, "number_format", "sr", "sr-Latn-RS")).toBe(
      "1.520.875",
    );
    expect(
      displayText(
        "2007-01-05",
        { field: "f", transform: "date_format:DD.MM.YYYY" },
        "date",
        "en",
        "en-US",
      ),
    ).toBe("05.01.2007");
    expect(displayText("2007-01-05", { field: "f" }, "date", "en", "en-US")).toBe("Jan 5, 2007");
  });

  it("editor values coerce by type", () => {
    expect(fromEditorValue("42", "number", { type: "integer" })).toEqual({ value: 42 });
    expect(fromEditorValue("4.2", "number", { type: "integer" })).toHaveProperty("error");
    expect(fromEditorValue("", "text", { type: "string" })).toEqual({ value: null });
    expect(fromEditorValue(true, "checkbox", { type: "bool" })).toEqual({ value: true });
    expect(sameValue("", null)).toBe(true);
    expect(sameValue(1, 2)).toBe(false);
  });
});

describe("row_color", () => {
  const cfg = {
    field: "employees",
    rules: [
      { value: 0, bg: "muted" as const },
      { min: 1000, color: "success" as const },
      { else: true, color: "default" as const },
    ],
  };
  it("value, min/max and else", () => {
    expect(resolveRowColor({ employees: 0 }, cfg)).toEqual({ bg: "muted" });
    expect(resolveRowColor({ employees: 1500 }, cfg)).toEqual({ color: "success" });
    expect(resolveRowColor({ employees: 10 }, cfg)).toEqual({ color: "default" });
    expect(resolveRowColor({ employees: 1500 }, { ...cfg, apply: false })).toBeNull();
    expect(resolveRowColor({}, undefined)).toBeNull();
  });
});

describe("pager", () => {
  it("shows first, last and a window with gaps", () => {
    expect(pageWindow(1, 4)).toEqual([1, 2, 3, 4]);
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageWindow(4, 10)).toEqual([1, 2, 3, 4, 5, null, 10]);
  });
});
