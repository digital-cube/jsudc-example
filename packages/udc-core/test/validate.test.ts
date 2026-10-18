import { describe, expect, it } from "vitest";
import { type SchemaDoc, SchemaDocSchema, validateRow } from "../src/index.js";

const schema: SchemaDoc = SchemaDocSchema.parse({
  version: "v1",
  core_fields: [],
  fields: {
    name: { type: "string", length: 10, required: true },
    notes: { type: "text" },
    employees: { type: "integer", min: 0, max: 1000 },
    revenue: { type: "decimal", min: 0 },
    founded_year: { type: "year" },
    active: { type: "bool" },
    founded: { type: "date" },
    updated: { type: "datetime" },
    extra: { type: "json" },
    size: { type: "enum", values: ["s", "m", "l"] },
    legacy: { type: "string", deleted: true },
  },
});

const insert = (row: Record<string, unknown>) => validateRow(schema, row, { mode: "insert" });
const patch = (row: Record<string, unknown>) => validateRow(schema, row, { mode: "patch" });
const fieldsOf = (problems: { field: string }[]) => problems.map((p) => p.field);

const VALID: Record<string, unknown> = {
  name: "Alfa",
  notes: "a long text with no length limit at all",
  employees: 12,
  revenue: 1234.56,
  founded_year: 1999,
  active: true,
  founded: "1999-04-01",
  updated: "2026-10-18T09:30:00Z",
  extra: { nested: [1, 2, { a: null }] },
  size: "m",
};

// [field, good values, bad values]
const TYPES: [string, unknown[], unknown[]][] = [
  ["name", ["x", "0123456789"], [1, true, "01234567890", ["a"]]],
  ["notes", ["anything", "x".repeat(5000)], [5, false, {}]],
  ["employees", [0, 1000, -0], [1.5, "12", true, -1, 1001, Number.NaN]],
  ["revenue", [0, 1.25, 1e9], ["1.25", -0.01, Number.POSITIVE_INFINITY, Number.NaN]],
  ["founded_year", [1000, 2026, 9999], [999, 10000, 2026.5, "2026"]],
  ["active", [true, false], [0, 1, "true", "yes"]],
  [
    "founded",
    ["2024-02-29", "1999-12-31"],
    ["2023-02-29", "1999-13-01", "1999-1-1", "1999-04-01T00:00:00Z", 19990401],
  ],
  [
    "updated",
    [
      "2026-10-18T09:30:00Z",
      "2026-10-18T09:30",
      "2026-10-18T09:30:00.123+02:00",
      "2026-10-18T09:30:00-0500",
    ],
    [
      "2026-10-18",
      "2026-10-18 09:30:00",
      "2026-13-18T09:30:00Z",
      "2026-10-18T25:00:00Z",
      1760779800000,
    ],
  ],
  ["extra", [{}, [], 1, "s", false], [() => 1]],
  ["size", ["s", "l"], ["xl", "S", 1]],
];

describe("validateRow", () => {
  it("accepts a complete valid row on insert", () => {
    expect(insert(VALID)).toEqual([]);
  });

  describe.each(TYPES)("%s", (field, good, bad) => {
    it.each(good.map((v) => [v]))("accepts %j on insert and patch", (value) => {
      expect(insert({ ...VALID, [field]: value })).toEqual([]);
      expect(patch({ [field]: value })).toEqual([]);
    });

    it.each(bad.map((v) => [v]))("rejects %j on insert and patch", (value) => {
      expect(fieldsOf(insert({ ...VALID, [field]: value }))).toEqual([field]);
      expect(fieldsOf(patch({ [field]: value }))).toEqual([field]);
    });
  });

  it("reports the range, length and enum in the message", () => {
    expect(patch({ employees: 1001 })[0]?.message).toMatch("<= 1000");
    expect(patch({ name: "far too long" })[0]?.message).toMatch("10 characters");
    expect(patch({ size: "xl" })[0]?.message).toMatch("s, m, l");
  });

  it("rejects unknown and deleted fields", () => {
    expect(patch({ nope: 1, legacy: "x" })).toEqual([
      { field: "nope", message: "unknown field" },
      { field: "legacy", message: "unknown field" },
    ]);
  });

  it("ignores __meta", () => {
    expect(patch({ __meta: { id: "1", version: 1 }, active: false })).toEqual([]);
  });

  it("insert requires every required field", () => {
    expect(insert({ active: true })).toEqual([{ field: "name", message: "is required" }]);
    expect(fieldsOf(insert({ name: null }))).toEqual(["name"]);
    expect(fieldsOf(insert({ name: "" }))).toEqual(["name"]);
  });

  it("patch only enforces required on fields it touches", () => {
    expect(patch({ active: false })).toEqual([]);
    expect(patch({ name: null })).toEqual([{ field: "name", message: "is required" }]);
    expect(fieldsOf(patch({ name: "" }))).toEqual(["name"]);
  });

  it("allows clearing an optional field", () => {
    expect(patch({ employees: null, founded: null, extra: null })).toEqual([]);
    expect(insert({ ...VALID, employees: null })).toEqual([]);
  });

  it("collects several problems at once", () => {
    expect(fieldsOf(insert({ employees: "x", active: "y" }))).toEqual([
      "employees",
      "active",
      "name",
    ]);
  });
});
