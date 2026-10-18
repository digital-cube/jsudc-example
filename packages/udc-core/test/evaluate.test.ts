import { describe, expect, it } from "vitest";
import { evaluateFilter, type FilterNode, filter as f, UdcError } from "../src/index.js";

// Ten rows; ids are the row index. Gaps are deliberate: row 6 has no city, row 7
// a null city, row 8 lacks employees, row 9 is nearly empty.
const ROWS: Record<string, unknown>[] = [
  {
    id: 0,
    name: "Alfa Group",
    city: "Beograd",
    employees: 120,
    founded: "1999-04-01",
    active: true,
    tags: ["it", "b2b"],
  },
  {
    id: 1,
    name: "beta doo",
    city: "Novi Sad",
    employees: 9,
    founded: "2010-01-15",
    active: false,
    tags: ["retail"],
  },
  {
    id: 2,
    name: "Gama",
    city: "Niš",
    employees: 10,
    founded: "2005-06-30",
    active: true,
    tags: [],
  },
  { id: 3, name: "Delta 100%", city: "Beograd", employees: 0, founded: "2020-12-31", active: true },
  {
    id: 4,
    name: "Epsilon_x",
    city: "Kragujevac",
    employees: 55.5,
    founded: "1999-04-01",
    active: false,
  },
  { id: 5, name: "ZETA", city: "beograd", employees: 1000, founded: "2001-01-01", active: true },
  { id: 6, name: "Eta", employees: 3, founded: "2015-03-03", active: true },
  { id: 7, name: "Theta", city: null, employees: 77, active: false },
  { id: 8, name: "Iota", city: "Subotica", founded: "1990-09-09", active: true },
  { id: 9, name: "Kapa" },
];

const ids = (node: FilterNode) => ROWS.filter((r) => evaluateFilter(node, r)).map((r) => r.id);

const CASES: [string, FilterNode, number[]][] = [
  ["eq string, case-sensitive", f.eq("city", "Beograd"), [0, 3]],
  [
    "eq string, case-insensitive",
    { field: "city", op: "eq", value: "BEOGRAD", case_insensitive: true },
    [0, 3, 5],
  ],
  ["eq number", f.eq("employees", 10), [2]],
  ["eq bool", f.eq("active", false), [1, 4, 7]],
  ["neq skips missing and null", f.neq("city", "Beograd"), [1, 2, 4, 5, 8]],
  ["in", f.in("city", ["Niš", "Subotica"]), [2, 8]],
  [
    "in, case-insensitive",
    { field: "city", op: "in", value: ["beograd"], case_insensitive: true },
    [0, 3, 5],
  ],
  ["in empty list", f.in("city", []), []],
  ["not_in skips missing", f.notIn("city", ["Beograd", "beograd"]), [1, 2, 4, 8]],
  ["contains case-sensitive", f.contains("name", "eta", false), [1, 7]],
  ["contains case-insensitive", f.contains("name", "ETA"), [1, 5, 6, 7]],
  ["contains with % is literal", f.contains("name", "%", false), [3]],
  ["contains with _ is literal", f.contains("name", "_", false), [4]],
  ["contains over an array field", f.contains("tags", "it", false), [0]],
  ["starts_with", f.startsWith("name", "Ep"), [4]],
  ["starts_with case-sensitive misses", f.startsWith("name", "ep"), []],
  ["starts_with case-insensitive", f.startsWith("name", "ZE", true), [5]],
  ["ends_with", f.endsWith("name", "ta"), [6, 7, 8]],
  ["ends_with case-insensitive", f.endsWith("name", "TA", true), [5, 6, 7, 8]],
  ["gt numeric (10 > 9)", f.gt("employees", 9), [0, 2, 4, 5, 7]],
  ["gte numeric", f.gte("employees", 77), [0, 5, 7]],
  ["lt numeric", f.lt("employees", 10), [1, 3, 6]],
  ["lte numeric", f.lte("employees", 10), [1, 2, 3, 6]],
  ["gt on ISO dates compares as text", f.gt("founded", "2010-01-15"), [3, 6]],
  ["between inclusive numeric", f.between("employees", 9, 77), [1, 2, 4, 7]],
  ["between inclusive dates", f.between("founded", "1999-04-01", "2005-06-30"), [0, 2, 4, 5]],
  ["number vs string compares as text", f.gt("employees", "5"), [1, 4, 7]],
  ["is_null: missing key and null", f.isNull("city"), [6, 7, 9]],
  ["is_not_null", f.isNotNull("employees"), [0, 1, 2, 3, 4, 5, 6, 7]],
  [
    "comparison never matches a missing field",
    f.lt("employees", 1_000_000),
    [0, 1, 2, 3, 4, 5, 6, 7],
  ],
  ["not", f.not(f.eq("active", true)), [1, 4, 7]],
  ["not over a missing field stays unmatched", f.not(f.eq("city", "Beograd")), [1, 2, 4, 5, 8]],
  ["not is_null", f.not(f.isNull("city")), [0, 1, 2, 3, 4, 5, 8]],
  ["and", f.and(f.eq("active", true), f.gte("employees", 100)), [0, 5]],
  ["or", f.or(f.eq("city", "Niš"), f.isNull("founded")), [2, 7, 9]],
  ["empty and matches all", f.and(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
  ["empty or matches none", f.or(), []],
  [
    "nested groups",
    f.and(
      f.or(f.contains("city", "beograd"), f.eq("city", "Niš")),
      f.not(f.and(f.eq("active", true), f.lt("employees", 50))),
    ),
    [0, 5],
  ],
  ["or rescues an unknown branch", f.or(f.eq("city", "x"), f.eq("name", "Kapa")), [9]],
];

describe("evaluateFilter", () => {
  it.each(CASES)("%s", (_label, node, expected) => {
    expect(ids(node)).toEqual(expected);
  });

  it("matches every row without a filter", () => {
    expect(ROWS.every((r) => evaluateFilter(undefined, r) && evaluateFilter(null, r))).toBe(true);
  });

  it("does not match a comparison against a null value", () => {
    expect(ids(f.eq("city", null))).toEqual([]);
  });

  it("rejects an unknown op", () => {
    const bad = { field: "city", op: "like", value: "x" } as unknown as FilterNode;
    expect(() => evaluateFilter(bad, ROWS[0] as Record<string, unknown>)).toThrow(UdcError);
  });

  it("rejects a malformed between and in", () => {
    const row = ROWS[0] as Record<string, unknown>;
    expect(() => evaluateFilter({ field: "employees", op: "between", value: [1] }, row)).toThrow(
      /between/,
    );
    expect(() => evaluateFilter({ field: "city", op: "in", value: "Beograd" }, row)).toThrow(/in/);
  });
});
