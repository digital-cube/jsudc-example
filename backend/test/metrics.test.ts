import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bucketByTime, type SchemaDocInput, SchemaDocSchema, validateRow } from "@jsudc/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  floorToStep,
  generateMetrics,
  HOSTS,
  incidentsFor,
  metricsEnd,
  noonOf,
  RANGES,
  SAMPLES,
  STEP_MS,
} from "../scripts/generate-metrics.js";
import { COLLECTIONS_DIR } from "../src/config.js";
import { readCollectionAssets } from "../src/registry.js";
import { seedCollection } from "../src/seed.js";
import { seedRowsFor } from "../src/seed-rows.js";
import { PostgresJsonbSource } from "../src/sources/postgres-jsonb.js";
import { useTestDb } from "./helpers.js";

const schemaJson = JSON.parse(
  readFileSync(join(COLLECTIONS_DIR, "metrics", "schema.json"), "utf8"),
) as SchemaDocInput;
const schema = SchemaDocSchema.parse(schemaJson);
/** The e2e end: noon of 2026-10-27 in Belgrade (11:00 UTC, winter time). */
const END = Date.parse("2026-10-27T11:00:00Z");
const rows = generateMetrics({ end: END });
const ms = (iso: string) => Date.parse(iso);

describe("generate-metrics", () => {
  it("yields one valid row per host every 15 minutes for 30 days, with unique ids", () => {
    expect(SAMPLES).toBe(2880);
    expect(rows).toHaveLength(SAMPLES * HOSTS.length);
    for (const row of rows) expect(validateRow(schema, row, { mode: "insert" })).toEqual([]);
    expect(new Set(rows.map((r) => r.__meta.id)).size).toBe(rows.length);
    expect(schema.fields.host?.values).toEqual([...HOSTS]);
  });

  it("has no gaps: every host has every quarter hour from the first sample to the end", () => {
    for (const host of HOSTS) {
      const times = rows.filter((r) => r.host === host).map((r) => ms(r.ts));
      expect(times).toHaveLength(SAMPLES);
      expect(times[0]).toBe(END - 30 * 86_400_000 + STEP_MS);
      expect(times.at(-1)).toBe(END);
      times.slice(1).forEach((t, i) => {
        expect(t - (times[i] as number)).toBe(STEP_MS);
      });
    }
  });

  it("keeps every value inside its range", () => {
    for (const r of rows) {
      for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
        const [lo, hi] = RANGES[key];
        expect(r[key], `${key} ${r.ts} ${r.host}`).toBeGreaterThanOrEqual(lo);
        expect(r[key], `${key} ${r.ts} ${r.host}`).toBeLessThanOrEqual(hi);
      }
      expect(Number.isInteger(r.req_per_s) && Number.isInteger(r.errors)).toBe(true);
    }
  });

  it("is deterministic for one end, and the end is floored to its quarter hour", () => {
    expect(generateMetrics({ end: END })).toEqual(rows);
    expect(generateMetrics({ end: END + 7 * 60_000 })).toEqual(rows);
    expect(generateMetrics({ end: END + STEP_MS })).not.toEqual(rows);
    expect(floorToStep(ms("2026-10-27T10:59:59Z"))).toBe(ms("2026-10-27T10:45:00Z"));
  });

  it("puts the incidents at fixed instants before the end", () => {
    expect(
      incidentsFor(END).map((i) => [
        i.kind,
        i.host,
        new Date(i.from).toISOString(),
        new Date(i.to).toISOString(),
      ]),
    ).toEqual([
      ["cpu_spike", "web-1", "2026-10-27T08:00:00.000Z", "2026-10-27T08:30:00.000Z"],
      ["error_burst", "web-2", "2026-10-26T05:00:00.000Z", "2026-10-26T05:45:00.000Z"],
      ["slow_db", "db-1", "2026-10-22T09:00:00.000Z", "2026-10-22T10:45:00.000Z"],
    ]);
    const at = (host: string, iso: string) => {
      const row = rows.find((r) => r.host === host && r.ts === iso);
      if (!row) throw new Error(`${host} ${iso}`);
      return row;
    };
    expect(at("web-1", "2026-10-27T08:15:00.000Z").cpu).toBeGreaterThanOrEqual(94);
    expect(at("web-1", "2026-10-27T08:45:00.000Z").cpu).toBeLessThan(80);
    expect(at("web-2", "2026-10-26T05:30:00.000Z").errors).toBeGreaterThanOrEqual(60);
    expect(at("db-1", "2026-10-22T10:00:00.000Z").cpu).toBeGreaterThanOrEqual(88);
    // Outside the incidents errors stay a trickle.
    const quiet = rows.filter((r) => !(r.host === "web-2" && r.ts.startsWith("2026-10-26T05")));
    expect(Math.max(...quiet.map((r) => r.errors))).toBeLessThanOrEqual(2);
  });

  it("follows the Belgrade day and the week: busy afternoons, quiet nights and weekends", () => {
    const meanCpu = (pred: (local: Date) => boolean) => {
      const sel = rows.filter((r) => {
        if (r.host !== "web-2") return false;
        // Winter time: Belgrade is UTC+1 after 2026-10-25, UTC+2 before.
        const t = ms(r.ts);
        const off = t >= ms("2026-10-25T01:00:00Z") ? 1 : 2;
        return pred(new Date(t + off * 3_600_000));
      });
      return sel.reduce((s, r) => s + r.cpu, 0) / sel.length;
    };
    const weekday = (d: Date) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5;
    const afternoon = meanCpu((d) => weekday(d) && d.getUTCHours() === 16);
    const night = meanCpu((d) => weekday(d) && d.getUTCHours() === 4);
    const weekendAfternoon = meanCpu((d) => !weekday(d) && d.getUTCHours() === 16);
    expect(afternoon).toBeGreaterThan(night + 30);
    expect(weekendAfternoon).toBeLessThan(afternoon - 10);
    expect(weekendAfternoon).toBeGreaterThan(night);
  });

  it("ends at noon of SEED_TODAY in Belgrade, else at the quarter hour it runs in", () => {
    expect(metricsEnd({ SEED_TODAY: "2026-10-27" })).toBe(END);
    expect(noonOf("2026-07-01")).toBe(ms("2026-07-01T10:00:00Z"));
    expect(metricsEnd({}, ms("2026-10-28T09:41:12Z"))).toBe(ms("2026-10-28T09:30:00Z"));
  });

  it("is what the seed writes for metrics", () => {
    const asset = readCollectionAssets(COLLECTIONS_DIR).find((a) => a.name === "metrics");
    if (!asset) throw new Error("metrics missing");
    expect(asset.seedFile).toBeNull();
    expect(seedRowsFor(asset, "2026-10-27")).toEqual(rows);
    expect(seedRowsFor(asset, "2026-10-27", { metricsEnd: END - STEP_MS })).toHaveLength(
      rows.length,
    );
  });
});

describe("metrics in Postgres", () => {
  const { db } = useTestDb();
  const source = new PostgresJsonbSource({
    db,
    table: "metrics",
    initialSchema: schema,
    pageSizeDefault: 50,
  });

  beforeAll(async () => {
    await seedCollection(db, { table: "metrics", schema: schemaJson, rows, reset: true });
  });

  it("seeds every generated row", async () => {
    expect((await source.list({ page: { limit: 1 } })).total).toBe(rows.length);
  });

  it("answers a window as the chart sends it: between on ts, the host chip ANDed", async () => {
    // The 24h window ending at the seed's noon, written in Tokyo's offset.
    const res = await source.list({
      filter: {
        and: [
          { field: "host", op: "in", value: ["db-1"] },
          {
            field: "ts",
            op: "between",
            value: ["2026-10-26T20:00:00.000+09:00", "2026-10-27T20:00:00.000+09:00"],
          },
        ],
      },
      sort: [{ field: "ts" }],
      page: { limit: 1000 },
    });
    expect(res.total).toBe(97);
    expect(new Set(res.rows.map((r) => r.host))).toEqual(new Set(["db-1"]));
    expect(res.rows[0]?.ts).toBe("2026-10-26T11:00:00.000Z");
    expect(res.rows.at(-1)?.ts).toBe("2026-10-27T11:00:00.000Z");
    // Three hosts at one instant merge into one point of the line, as the browser draws it.
    const all = rows.filter((r) => r.ts === "2026-10-27T11:00:00.000Z");
    const [point] = bucketByTime(all, "ts", 1, [{ field: "cpu" }]);
    expect(point?.count).toBe(3);
    expect(point?.values.cpu).toBeCloseTo(all.reduce((s, r) => s + r.cpu, 0) / 3, 10);
  });
});
