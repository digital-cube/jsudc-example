import type { FilterChipConfig } from "@jsudc/core";
import { evaluateFilter } from "@jsudc/core";
import { describe, expect, it } from "vitest";
import {
  chipCondition,
  composeFilter,
  conditionsToTree,
  searchFilter,
  treeToConditions,
} from "../src/data-view/compose";

const search = { fields: ["name", "city"], case_insensitive: true };
const chipConfigs: FilterChipConfig[] = [
  { field: "city", kind: "select" },
  { field: "active", kind: "bool" },
  { field: "employees", kind: "range" },
];

describe("filter composition", () => {
  it("search is an or of contains over the search fields", () => {
    expect(searchFilter("  beo ", search)).toEqual({
      or: [
        { field: "name", op: "contains", value: "beo", case_insensitive: true },
        { field: "city", op: "contains", value: "beo", case_insensitive: true },
      ],
    });
    expect(searchFilter("   ", search)).toBeNull();
    expect(searchFilter("x", undefined)).toBeNull();
    expect(searchFilter("x", { fields: ["name"], case_insensitive: false })).toEqual({
      field: "name",
      op: "contains",
      value: "x",
    });
  });

  it("chips become in / eq / between (or one side)", () => {
    expect(chipCondition("city", { kind: "select", values: ["Niš"] })).toEqual({
      field: "city",
      op: "in",
      value: ["Niš"],
    });
    expect(chipCondition("active", { kind: "bool", value: false })).toEqual({
      field: "active",
      op: "eq",
      value: false,
    });
    expect(chipCondition("e", { kind: "range", min: 1, max: 9 })).toEqual({
      field: "e",
      op: "between",
      value: [1, 9],
    });
    expect(chipCondition("e", { kind: "range", min: 1, max: null })?.op).toBe("gte");
    expect(chipCondition("e", { kind: "range", min: null, max: 9 })?.op).toBe("lte");
    expect(chipCondition("e", { kind: "range", min: null, max: null })).toBeNull();
  });

  it("ands search, chips (in view order) and the tree", () => {
    const tree = { and: [{ field: "employees", op: "gte" as const, value: 100 }] };
    const f = composeFilter({
      search: "Beo",
      searchConfig: search,
      chips: {
        active: { kind: "bool", value: true },
        city: { kind: "select", values: ["Beograd"] },
        ghost: { kind: "bool", value: true },
      },
      chipConfigs,
      tree,
    });
    expect(f).toEqual({
      and: [
        searchFilter("Beo", search),
        { field: "city", op: "in", value: ["Beograd"] },
        { field: "active", op: "eq", value: true },
        tree,
      ],
    });
    const rows = [
      { city: "Beograd", name: "A", active: true, employees: 150 },
      { city: "Beograd", name: "B", active: false, employees: 150 },
      { city: "Niš", name: "Beo", active: true, employees: 150 },
      { city: "Beograd", name: "C", active: true, employees: 50 },
    ];
    expect(rows.filter((r) => f && evaluateFilter(f, r)).map((r) => r.name)).toEqual(["A"]);
  });

  it("is undefined when nothing is set and the bare part when one is", () => {
    const empty = { search: "", searchConfig: search, chips: {}, chipConfigs, tree: null };
    expect(composeFilter(empty)).toBeUndefined();
    expect(composeFilter({ ...empty, chips: { active: { kind: "bool", value: false } } })).toEqual({
      field: "active",
      op: "eq",
      value: false,
    });
  });

  it("chip state of the wrong kind for its config is ignored", () => {
    expect(
      composeFilter({
        search: "",
        searchConfig: search,
        chips: { city: { kind: "bool", value: true } },
        chipConfigs,
        tree: null,
      }),
    ).toBeUndefined();
  });

  it("the builder edits a flat and; anything else is opaque", () => {
    const c = { field: "a", op: "eq" as const, value: 1 };
    expect(treeToConditions(null)).toEqual([]);
    expect(treeToConditions(c)).toEqual([c]);
    expect(treeToConditions(conditionsToTree([c, c]))).toEqual([c, c]);
    expect(treeToConditions({ or: [c] })).toBeNull();
    expect(conditionsToTree([])).toBeNull();
  });
});
