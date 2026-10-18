import { describe, expect, it } from "vitest";
import { PageRequestSchema, SortKeySchema } from "../src/index.js";

describe("PageRequestSchema", () => {
  it.each([
    [{}],
    [{ limit: 1 }],
    [{ limit: 1000, cursor: "abc" }],
    [{ offset: 0, limit: 50 }],
    [{ cursor: null, offset: 100 }],
  ])("accepts %j", (raw) => {
    expect(PageRequestSchema.safeParse(raw).success).toBe(true);
  });

  it("rejects cursor and offset together", () => {
    const res = PageRequestSchema.safeParse({ cursor: "abc", offset: 0 });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toMatch("mutually exclusive");
  });

  it.each([[{ limit: 0 }], [{ limit: 1001 }], [{ limit: 1.5 }], [{ offset: -1 }], [{ cursor: 5 }]])(
    "rejects %j",
    (raw) => {
      expect(PageRequestSchema.safeParse(raw).success).toBe(false);
    },
  );
});

describe("SortKeySchema", () => {
  it("accepts a field with or without dir", () => {
    expect(SortKeySchema.parse({ field: "name" })).toEqual({ field: "name" });
    expect(SortKeySchema.parse({ field: "name", dir: "desc" })).toEqual({
      field: "name",
      dir: "desc",
    });
  });

  it("rejects an unknown dir", () => {
    expect(SortKeySchema.safeParse({ field: "name", dir: "up" }).success).toBe(false);
  });
});
