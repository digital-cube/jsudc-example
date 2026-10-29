import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type SchemaDocInput, SchemaDocSchema } from "@jsudc/core";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { COLLECTIONS_DIR } from "../src/config.js";
import { seedCollection } from "../src/seed.js";
import { PostgresJsonbSource } from "../src/sources/postgres-jsonb.js";
import {
  companiesSchema,
  companiesSchemaJson,
  companiesSeed,
  companiesSource,
  resetTables,
  useTestDb,
} from "./helpers.js";

const ticketsSchemaJson = JSON.parse(
  readFileSync(join(COLLECTIONS_DIR, "tickets", "schema.json"), "utf8"),
) as SchemaDocInput;
const ticketsSeed = JSON.parse(
  readFileSync(join(COLLECTIONS_DIR, "tickets", "seed.json"), "utf8"),
) as Record<string, unknown>[];

const { db } = useTestDb();
const source = companiesSource(db);
const seed = (opts: { reset?: boolean; limit?: number } = {}) =>
  seedCollection(db, {
    table: "companies",
    schema: companiesSchemaJson,
    rows: companiesSeed,
    ...opts,
  });

const revisions = async () =>
  (
    await db.execute<{ version: number; active: boolean }>(
      sql`select version, active from udc_schema_revisions where collection = 'companies'`,
    )
  ).rows;

const indexNames = async () =>
  (
    await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where tablename = 'companies' order by indexname`,
    )
  ).rows.map((r) => r.indexname);

beforeEach(() => resetTables(db));

describe("seedCollection", () => {
  it("writes schema.json as active revision 1 and every seed row", async () => {
    expect(await seed()).toEqual({
      table: "companies",
      inserted: 200,
      revision: "created",
      skipped: false,
    });
    expect(await revisions()).toEqual([{ version: 1, active: true }]);
    expect((await source.list({})).total).toBe(200);
    // field_order survives jsonb, which does not keep key order.
    const schema = await source.describe();
    expect(schema.field_order).toEqual(companiesSchema.field_order);
    expect(schema.field_order[0]).toBe("pib");
  });

  it("leaves a seeded collection alone without --reset", async () => {
    await seed({ limit: 5 });
    expect(await seed()).toMatchObject({ inserted: 0, revision: "kept", skipped: true });
    expect((await source.list({})).total).toBe(5);
  });

  it("--reset truncates first, --limit caps the rows", async () => {
    await seed();
    expect(await seed({ reset: true, limit: 20 })).toMatchObject({
      inserted: 20,
      revision: "created",
    });
    expect((await source.list({})).total).toBe(20);
    expect(await revisions()).toHaveLength(1);
  });

  it("--reset drops later revisions and their indexes, back to schema.json as v1", async () => {
    await seed({ limit: 5 });
    await source.addField({
      name: "website",
      fielddef: { type: "string", index: true },
      position: { where: "end" },
    });
    await source.softDeleteField("city");
    expect(await revisions()).toHaveLength(3);
    expect(await indexNames()).toContain("companies_data_website_idx");

    await seed({ reset: true, limit: 5 });
    expect(await revisions()).toEqual([{ version: 1, active: true }]);
    const schema = await source.describe();
    expect(schema.version).toBe("v1");
    expect(schema.fields.website).toBeUndefined();
    expect(schema.fields.city?.deleted).toBeUndefined();
    const names = await indexNames();
    expect(names).not.toContain("companies_data_website_idx");
    expect(names).toContain("companies_data_city_idx");
  });

  it("refuses an invalid seed row and writes nothing", async () => {
    await expect(
      seedCollection(db, {
        table: "companies",
        schema: companiesSchemaJson,
        rows: [{ employees: 1 }],
      }),
    ).rejects.toThrow(/seed row 0/);
    expect(await revisions()).toEqual([]);
  });

  it("ships a seed that matches the ticket's shape", () => {
    expect(companiesSeed).toHaveLength(200);
    const inactive = companiesSeed.filter((r) => r.active === false).length;
    expect(inactive).toBeGreaterThanOrEqual(10);
    expect(inactive).toBeLessThanOrEqual(30);
    for (const r of companiesSeed) {
      expect(r.pib).toMatch(/^\d{9}$/);
      expect(r.mb).toMatch(/^\d{8}$/);
      expect((r.founded as string) >= "1990-01-01" && (r.founded as string) <= "2024-12-31").toBe(
        true,
      );
    }
    expect(new Set(companiesSeed.map((r) => r.pib)).size).toBe(200);
  });

  it("keeps a fixed __meta.id and indexes relation and order fields", async () => {
    const res = await seedCollection(db, {
      table: "tickets",
      schema: ticketsSchemaJson,
      rows: ticketsSeed,
      reset: true,
    });
    expect(res.inserted).toBe(ticketsSeed.length);
    const first = ticketsSeed[0] as { __meta: { id: string }; title: string };
    const tickets = new PostgresJsonbSource({
      db,
      table: "tickets",
      initialSchema: SchemaDocSchema.parse(ticketsSchemaJson),
    });
    const row = await tickets.read(first.__meta.id);
    expect(row).toMatchObject({ __meta: { id: first.__meta.id, version: 1 }, title: first.title });
    const stored = await db.execute<{ data: Record<string, unknown> }>(
      sql`select data from tickets where id = ${first.__meta.id}::uuid`,
    );
    expect(stored.rows[0]?.data).not.toHaveProperty("__meta");
    const idx = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where tablename = 'tickets' order by indexname`,
    );
    expect(idx.rows.map((r) => r.indexname)).toEqual(
      expect.arrayContaining([
        "tickets_data_board_id_idx",
        "tickets_data_bucket_id_idx",
        "tickets_data_order_idx",
        "tickets_data_priority_idx",
      ]),
    );
  });
});
