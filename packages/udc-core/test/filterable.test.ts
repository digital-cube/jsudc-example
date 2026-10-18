import { describe, expect, it } from "vitest";
import { FIELD_TYPES, type FieldType, filterableForType, SUPPORTED_OPS } from "../src/index.js";

const STRING = [
  "eq",
  "neq",
  "contains",
  "starts_with",
  "ends_with",
  "in",
  "not_in",
  "is_null",
  "is_not_null",
];
const ORDERED = ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_null", "is_not_null"];
const CHOICE = ["eq", "neq", "in", "not_in", "is_null", "is_not_null"];
const NULLS = ["is_null", "is_not_null"];

const EXPECTED: Record<FieldType, [string[], string, string]> = {
  string: [STRING, "contains", "text"],
  text: [STRING, "contains", "text"],
  integer: [ORDERED, "eq", "number"],
  year: [ORDERED, "eq", "number"],
  decimal: [ORDERED, "eq", "number"],
  rating: [ORDERED, "gte", "number"],
  date: [ORDERED, "eq", "date"],
  datetime: [ORDERED, "eq", "date"],
  bool: [["eq", "is_null", "is_not_null"], "eq", "bool"],
  json: [NULLS, "is_null", "none"],
  image: [NULLS, "is_not_null", "none"],
  enum: [CHOICE, "in", "select"],
  lookup: [CHOICE, "in", "lookup"],
  relation: [CHOICE, "eq", "text"],
  string_array: [["contains", ...NULLS], "contains", "text"],
  lookup_array: [["contains", ...NULLS], "contains", "lookup"],
};

describe("filterableForType", () => {
  it.each(FIELD_TYPES.map((t) => [t]))("%s", (type) => {
    const [ops, defaultOp, widget] = EXPECTED[type];
    const got = filterableForType(type);
    expect([...got.ops].sort()).toEqual([...ops].sort());
    expect(got.default_op).toBe(defaultOp);
    expect(got.widget).toBe(widget);
    expect(got.ops).toContain(got.default_op);
    for (const op of got.ops) expect(SUPPORTED_OPS).toContain(op);
  });
});
