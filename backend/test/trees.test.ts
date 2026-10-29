import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SchemaDocSchema, validateRow } from "@jsudc/core";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  COMMENT_COUNT,
  COMMENT_MAX_DEPTH,
  COMMENT_ROOTS,
  generateTrees,
  ORG_DEPARTMENTS,
  type SeedRow,
} from "../scripts/generate-trees.js";
import { COLLECTIONS_DIR } from "../src/config.js";
import { readCollectionAssets } from "../src/registry.js";
import { seedCollection } from "../src/seed.js";
import { PostgresJsonbSource } from "../src/sources/postgres-jsonb.js";
import { useTestDb } from "./helpers.js";

const seed = generateTrees();
const asset = (name: string) => {
  const found = readCollectionAssets(COLLECTIONS_DIR).find((a) => a.name === name);
  if (!found) throw new Error(name);
  return found;
};

/** Walk the tree from its roots and check every denormalised structure field against the links. */
function walk(rows: SeedRow[], opts: { ancestors: boolean; children: boolean }) {
  const byId = new Map(rows.map((r) => [r.__meta.id, r]));
  const kids = new Map<string | null, SeedRow[]>();
  for (const r of rows) {
    const p = (r.parent_id as string | null) ?? null;
    if (p !== null) expect(byId.has(p), `${r.__meta.id} has a parent that exists`).toBe(true);
    kids.set(p, [...(kids.get(p) ?? []), r]);
  }
  let seen = 0;
  const visit = (row: SeedRow, ancestors: string[]) => {
    seen++;
    expect(row.depth).toBe(ancestors.length);
    if (opts.ancestors) expect(row.ancestor_ids).toEqual(ancestors);
    const children = kids.get(row.__meta.id) ?? [];
    if (opts.children) expect(row.children_count).toBe(children.length);
    for (const c of children) visit(c, [...ancestors, row.__meta.id]);
  };
  for (const root of kids.get(null) ?? []) visit(root, []);
  // Every row is reachable from a root: no cycles, no orphans.
  expect(seen).toBe(rows.length);
  // Orders are sparse and unique among siblings.
  for (const siblings of kids.values()) {
    const orders = siblings.map((s) => s.order as number);
    expect(new Set(orders).size).toBe(orders.length);
    for (const o of orders) expect(o % 100).toBe(0);
  }
  return kids;
}

describe("generate-trees", () => {
  it("reproduces the committed seed files from its default seed", () => {
    for (const name of ["comments", "org"] as const) {
      const file = JSON.parse(readFileSync(join(COLLECTIONS_DIR, name, "seed.json"), "utf8"));
      expect(seed[name]).toEqual(file);
    }
  });

  it.each(["comments", "org"] as const)("every %s row fits schema.json", (name) => {
    const schema = SchemaDocSchema.parse(asset(name).schemaJson);
    for (const row of seed[name]) {
      const { __meta: _, ...data } = row;
      expect(validateRow(schema, data, { mode: "insert" })).toEqual([]);
    }
  });

  it("comments: one thread of ~80, depth up to 6, consistent depth", () => {
    expect(seed.comments).toHaveLength(COMMENT_COUNT);
    const kids = walk(seed.comments, { ancestors: false, children: false });
    expect(kids.get(null)).toHaveLength(COMMENT_ROOTS);
    expect(Math.max(...seed.comments.map((r) => r.depth as number))).toBe(COMMENT_MAX_DEPTH);
    // A reply comes after what it answers.
    const byId = new Map(seed.comments.map((r) => [r.__meta.id, r]));
    for (const r of seed.comments) {
      const p = byId.get(r.parent_id as string);
      if (p) expect(String(r.created_at) > String(p.created_at)).toBe(true);
    }
    expect(seed.comments.some((r) => String(r.body).includes("Beograd"))).toBe(true);
  });

  it("org: company → 6 departments → teams → people, every structure field consistent", () => {
    expect(seed.org.length).toBeGreaterThanOrEqual(120);
    expect(seed.org.length).toBeLessThanOrEqual(160);
    const kids = walk(seed.org, { ancestors: true, children: true });
    const [company] = kids.get(null) ?? [];
    expect(company?.kind).toBe("company");
    const departments = kids.get(company?.__meta.id as string) ?? [];
    expect(departments.map((d) => d.name)).toEqual(ORG_DEPARTMENTS.map((d) => d.name));
    for (const d of departments) {
      const teams = kids.get(d.__meta.id) ?? [];
      expect(teams.length).toBeGreaterThanOrEqual(2);
      expect(teams.length).toBeLessThanOrEqual(4);
      for (const t of teams) {
        expect(t.kind).toBe("team");
        const people = kids.get(t.__meta.id) ?? [];
        expect(people.length).toBeGreaterThanOrEqual(4);
        expect(people.length).toBeLessThanOrEqual(8);
        expect(people.every((p) => p.kind === "person" && p.icon === "user")).toBe(true);
        expect(t.headcount).toBe(people.length);
      }
    }
    expect(company?.headcount).toBe(seed.org.filter((r) => r.kind === "person").length);
  });
});

describe("the tree collections in Postgres", () => {
  const { db } = useTestDb();

  it("seed, index parent_id and depth, and list one level by parent", async () => {
    for (const name of ["comments", "org"] as const) {
      await seedCollection(db, {
        table: name,
        schema: asset(name).schemaJson,
        rows: seed[name],
        reset: true,
      });
    }
    const indexes = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where tablename in ('comments', 'org') order by indexname`,
    );
    expect(indexes.rows.map((r) => r.indexname)).toEqual(
      expect.arrayContaining([
        "comments_data_parent_id_idx",
        "org_data_parent_id_idx",
        "org_data_depth_idx",
      ]),
    );
    const org = new PostgresJsonbSource({ db, table: "org", initialSchema: asset("org").schema });
    const roots = await org.list({ filter: { field: "parent_id", op: "is_null" } });
    expect(roots.rows.map((r) => r.kind)).toEqual(["company"]);
    const departments = await org.list({
      filter: { field: "parent_id", op: "eq", value: roots.rows[0]?.__meta.id as string },
    });
    expect(departments.total).toBe(6);
  });
});
