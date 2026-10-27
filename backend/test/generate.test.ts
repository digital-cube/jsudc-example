import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SchemaDocSchema, validateRow } from "@jsudc/udc-core";
import { describe, expect, it } from "vitest";
import { generateCompanies } from "../scripts/generate-companies.js";
import { generateKanban } from "../scripts/generate-kanban.js";
import { COLLECTIONS_DIR } from "../src/config.js";
import { companiesSeed } from "./helpers.js";

describe("generate-companies", () => {
  it("reproduces the committed seed.json from its default seed", () => {
    expect(generateCompanies(200, 20261018)).toEqual(companiesSeed);
  });
});

describe("generate-kanban", () => {
  const seed = generateKanban(20261027);

  it("reproduces the committed seed files from its default seed", () => {
    for (const name of ["boards", "buckets", "tickets"] as const) {
      const file = JSON.parse(readFileSync(join(COLLECTIONS_DIR, name, "seed.json"), "utf8"));
      expect(seed[name]).toEqual(file);
    }
  });

  it("yields 3 boards, 15 buckets and ~60 tickets", () => {
    expect(seed.boards).toHaveLength(3);
    expect(seed.buckets).toHaveLength(15);
    expect(seed.tickets.length).toBeGreaterThanOrEqual(55);
    expect(seed.tickets.length).toBeLessThanOrEqual(65);
  });

  it("has unique ids and keys and only valid relations", () => {
    const all = [...seed.boards, ...seed.buckets, ...seed.tickets].map((r) => r.__meta.id);
    expect(new Set(all).size).toBe(all.length);
    const keys = seed.tickets.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);

    const boards = new Set(seed.boards.map((b) => b.__meta.id));
    const bucketBoard = new Map(seed.buckets.map((b) => [b.__meta.id, b.board_id]));
    for (const bucket of seed.buckets) expect(boards.has(bucket.board_id as string)).toBe(true);
    for (const t of seed.tickets) {
      expect(bucketBoard.get(t.bucket_id as string), `${t.key}`).toBe(t.board_id);
    }
    for (const id of boards) {
      expect(seed.buckets.filter((b) => b.board_id === id)).toHaveLength(5);
    }
  });

  it("orders are sparse and unique within a bucket", () => {
    const byBucket = new Map<string, typeof seed.tickets>();
    for (const t of seed.tickets) {
      const bucket = t.bucket_id as string;
      byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), t]);
    }
    for (const tickets of byBucket.values()) {
      expect(tickets.map((t) => t.order)).toEqual(tickets.map((_, i) => (i + 1) * 100));
    }
  });

  it("every row is valid against its schema", () => {
    for (const name of ["boards", "buckets", "tickets"] as const) {
      const schema = SchemaDocSchema.parse(
        JSON.parse(readFileSync(join(COLLECTIONS_DIR, name, "schema.json"), "utf8")),
      );
      for (const row of seed[name])
        expect(validateRow(schema, row, { mode: "insert" })).toEqual([]);
    }
  });

  it("gives a calendar slot exactly to the tickets with a due date", () => {
    for (const t of seed.tickets) {
      expect(t.starts_at === undefined).toBe(t.due === undefined);
      if (t.starts_at)
        expect(Date.parse(t.ends_at as string)).toBeGreaterThan(Date.parse(t.starts_at as string));
    }
  });
});
