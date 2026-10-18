import { describe, expect, it } from "vitest";
import { FilterNodeSchema, filter as f, SUPPORTED_OPS } from "../src/index.js";

describe("filter DSL", () => {
  it("has the 14 ops", () => {
    expect(SUPPORTED_OPS).toHaveLength(14);
  });

  it("builders produce the udc-js wire shape", () => {
    expect(f.contains("name", "a")).toEqual({
      field: "name",
      op: "contains",
      value: "a",
      case_insensitive: true,
    });
    expect(f.between("n", 1, 2)).toEqual({ field: "n", op: "between", value: [1, 2] });
    expect(f.not(f.isNull("x"))).toEqual({ not: { field: "x", op: "is_null" } });
  });

  it("FilterNodeSchema accepts nested trees", () => {
    const tree = f.and(f.or(f.eq("a", 1), f.in("b", ["x"])), f.not(f.isNotNull("c")));
    expect(FilterNodeSchema.parse(tree)).toEqual(tree);
  });

  it.each([
    [{ field: "a", op: "like", value: 1 }],
    [{ field: "", op: "eq", value: 1 }],
    [{ And: [] }],
    [{ and: {} }],
    [{ and: [{ field: "a", op: "nope" }] }],
    [{ not: [{ field: "a", op: "eq" }] }],
    ["a = 1"],
  ])("FilterNodeSchema rejects %j", (raw) => {
    expect(FilterNodeSchema.safeParse(raw).success).toBe(false);
  });
});
