import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type SchemaDocInput, SchemaDocSchema } from "@jsudc/core";
import { beforeAll, describe, expect, it } from "vitest";
import { generateAppointments } from "../scripts/generate-appointments.js";
import { COLLECTIONS_DIR } from "../src/config.js";
import { seedCollection } from "../src/seed.js";
import { PostgresJsonbSource } from "../src/sources/postgres-jsonb.js";
import { useTestDb } from "./helpers.js";

const schemaJson = JSON.parse(
  readFileSync(join(COLLECTIONS_DIR, "appointments", "schema.json"), "utf8"),
) as SchemaDocInput;
const rows = generateAppointments({ today: "2026-10-27" });

const { db } = useTestDb();
const source = new PostgresJsonbSource({
  db,
  table: "appointments",
  initialSchema: SchemaDocSchema.parse(schemaJson),
  pageSizeDefault: 50,
});

beforeAll(async () => {
  await seedCollection(db, { table: "appointments", schema: schemaJson, rows, reset: true });
});

/** What the calendar sends: `[first instant, last instant]` of the window. */
async function inWindow(from: string, to: string) {
  const res = await source.list({
    filter: { field: "start", op: "between", value: [from, to] },
    sort: [{ field: "start" }],
    page: { limit: 1000 },
  });
  return res.rows;
}

const expected = (from: string, to: string) =>
  rows.filter(
    (r) => Date.parse(r.start) >= Date.parse(from) && Date.parse(r.start) <= Date.parse(to),
  );

describe("appointments in Postgres", () => {
  it("seeds every generated row", async () => {
    expect((await source.list({ page: { limit: 1 } })).total).toBe(rows.length);
  });

  it("between on start returns exactly the work week of 2026-10-27 in Belgrade", async () => {
    const from = "2026-10-26T00:00:00.000+01:00";
    const to = "2026-10-30T23:59:59.999+01:00";
    const got = await inWindow(from, to);
    expect(got.length).toBeGreaterThan(20);
    expect(got.map((r) => r.__meta.id).sort()).toEqual(
      expected(from, to)
        .map((r) => r.__meta.id)
        .sort(),
    );
    // Sorted by the instant, not by the text.
    const starts = got.map((r) => Date.parse(r.start as string));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("compares instants, whatever offset the window is written in", async () => {
    // The same Belgrade day, written in New York's and in UTC's offset.
    const ny = await inWindow("2026-10-26T19:00:00.000-04:00", "2026-10-27T18:59:59.999-04:00");
    const utc = await inWindow("2026-10-26T23:00:00.000Z", "2026-10-27T22:59:59.999Z");
    const bg = await inWindow("2026-10-27T00:00:00.000+01:00", "2026-10-27T23:59:59.999+01:00");
    expect(ny.map((r) => r.__meta.id)).toEqual(bg.map((r) => r.__meta.id));
    expect(utc.map((r) => r.__meta.id)).toEqual(bg.map((r) => r.__meta.id));
    expect(bg.some((r) => r.start === "2026-10-27T08:00:00+01:00")).toBe(true);
  });

  it("a window across the DST change holds both offsets", async () => {
    const got = await inWindow("2026-10-19T00:00:00.000+02:00", "2026-11-01T23:59:59.999+01:00");
    const offsets = new Set(got.map((r) => (r.start as string).slice(-6)));
    expect([...offsets].sort()).toEqual(["+01:00", "+02:00"]);
    expect(got).toHaveLength(
      expected("2026-10-19T00:00:00.000+02:00", "2026-11-01T23:59:59.999+01:00").length,
    );
  });
});
