import type { FilterNode } from "@jsudc/core";
import { describe, expect, it } from "vitest";
import {
  base64UrlToUtf8,
  type ChipState,
  cycleSort,
  decodeChipParam,
  decodeFilterParam,
  decodeModeParam,
  decodePageParam,
  decodeSortParam,
  encodeChipParam,
  encodeFilterParam,
  encodeSortParam,
  utf8ToBase64Url,
} from "../src/data-view/urlState";

describe("base64url", () => {
  it("round-trips UTF-8 without padding or URL-unsafe characters", () => {
    const s = 'Čačak — "Šabac" ?&/+=';
    const enc = utf8ToBase64Url(s);
    expect(enc).not.toMatch(/[+/=]/);
    expect(base64UrlToUtf8(enc)).toBe(s);
  });

  it("decodes garbage to null", () => {
    expect(base64UrlToUtf8("%%%")).toBeNull();
  });
});

describe("?f= filter tree", () => {
  const tree: FilterNode = {
    and: [
      { field: "employees", op: "between", value: [100, 200] },
      {
        or: [
          { field: "city", op: "eq", value: "Niš" },
          { not: { field: "active", op: "is_null" } },
        ],
      },
    ],
  };

  it("round-trips a nested tree", () => {
    const raw = encodeFilterParam(tree);
    expect(raw).toBeTypeOf("string");
    expect(decodeFilterParam(raw)).toEqual(tree);
  });

  it("is the udc-js encoding: base64url of the JSON", () => {
    const c: FilterNode = { field: "name", op: "contains", value: "a" };
    expect(encodeFilterParam(c)).toBe(Buffer.from(JSON.stringify(c)).toString("base64url"));
  });

  it("encodes nothing for an empty tree", () => {
    expect(encodeFilterParam(null)).toBeNull();
  });

  it("rejects what is not a filter node", () => {
    expect(decodeFilterParam(utf8ToBase64Url('{"And":[]}'))).toBeNull();
    expect(decodeFilterParam(utf8ToBase64Url('{"field":"x","op":"nope"}'))).toBeNull();
    expect(decodeFilterParam("not-base64!")).toBeNull();
    expect(decodeFilterParam(null)).toBeNull();
  });
});

describe("?cf= chips", () => {
  const chips: ChipState = {
    city: { kind: "select", values: ["Beograd", "Niš"] },
    employees: { kind: "range", min: 100, max: null },
    active: { kind: "bool", value: false },
  };

  it("round-trips every chip kind", () => {
    expect(decodeChipParam(encodeChipParam(chips))).toEqual(chips);
  });

  it("drops empty chips and encodes nothing when none is set", () => {
    expect(
      encodeChipParam({
        city: { kind: "select", values: [] },
        x: { kind: "range", min: null, max: null },
      }),
    ).toBeNull();
  });

  it("skips malformed entries instead of failing", () => {
    const raw = utf8ToBase64Url(
      JSON.stringify({
        city: { kind: "select", values: ["A", 3] },
        bad: { kind: "range", min: "x", max: 1 },
        alsoBad: { kind: "bool", value: "yes" },
        active: { kind: "bool", value: true },
      }),
    );
    expect(decodeChipParam(raw)).toEqual({
      city: { kind: "select", values: ["A"] },
      active: { kind: "bool", value: true },
    });
    expect(decodeChipParam("@@")).toEqual({});
    expect(decodeChipParam(utf8ToBase64Url("[1,2]"))).toEqual({});
  });
});

describe("?sort=", () => {
  it("round-trips keys in order", () => {
    const sort = [
      { field: "employees", dir: "desc" as const },
      { field: "name", dir: "asc" as const },
    ];
    expect(encodeSortParam(sort)).toBe("employees:desc,name:asc");
    expect(decodeSortParam(encodeSortParam(sort))).toEqual(sort);
  });

  it("defaults dir to asc and skips bad or repeated keys", () => {
    expect(decodeSortParam("name,city:sideways,name:desc,:asc")).toEqual([
      { field: "name", dir: "asc" },
    ]);
    expect(encodeSortParam([])).toBeNull();
  });

  it("cycles a header asc → desc → none", () => {
    let s = cycleSort([], "employees");
    expect(s).toEqual([{ field: "employees", dir: "asc" }]);
    s = cycleSort(s, "employees");
    expect(s).toEqual([{ field: "employees", dir: "desc" }]);
    expect(cycleSort(s, "employees")).toEqual([]);
  });

  it("replaces other keys unless multi", () => {
    const s = [{ field: "name", dir: "asc" as const }];
    expect(cycleSort(s, "city")).toEqual([{ field: "city", dir: "asc" }]);
    expect(cycleSort(s, "city", true)).toEqual([
      { field: "name", dir: "asc" },
      { field: "city", dir: "asc" },
    ]);
    expect(cycleSort([...s, { field: "city", dir: "desc" as const }], "city", true)).toEqual(s);
  });
});

describe("?mode= and ?p=", () => {
  it("accepts only the two modes", () => {
    expect(decodeModeParam("pages")).toBe("pages");
    expect(decodeModeParam("infinite")).toBe("infinite");
    expect(decodeModeParam("scroll")).toBeNull();
  });

  it("reads a page as a positive integer, else 1", () => {
    expect(decodePageParam("3")).toBe(3);
    expect(decodePageParam("0")).toBe(1);
    expect(decodePageParam("2.5")).toBe(1);
    expect(decodePageParam(null)).toBe(1);
  });
});
