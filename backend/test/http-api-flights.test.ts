import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Row } from "@jsudc/core";
import { HttpApiSource, MemorySource, makeSource, readCollectionAssets } from "@jsudc/server";
import { describe, expect, it } from "vitest";
import { COLLECTIONS_DIR } from "../src/config.js";
import { ids } from "./helpers.js";

const FIXTURES = join(import.meta.dirname, "fixtures", "http");
const fixture = (n: number) =>
  JSON.parse(readFileSync(join(FIXTURES, `flights.${n}.json`), "utf8")) as {
    time: number;
    states: unknown[][];
  };

const flights = readCollectionAssets(COLLECTIONS_DIR).find((a) => a.name === "flights");
if (flights?.source.kind !== "http_api") throw new Error("flights is not http_api");
const FLIGHTS_OPTS = flights.source.options;

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const byId = (rows: Row[], id: string) => rows.find((r) => r.__meta.id === id);

describe("the flights collection on its fixtures", () => {
  const fromFixtures = () => {
    const c = clock();
    const src = new HttpApiSource({
      name: "flights",
      schema: flights.schema,
      options: FLIGHTS_OPTS,
      fetch: async () => {
        throw new Error("must not fetch");
      },
      env: {},
      fixturesDir: FIXTURES,
      now: c.now,
    });
    return { src, c };
  };

  it("steps through flights.1.json, flights.2.json, then keeps the last", async () => {
    const one = fixture(1);
    const two = fixture(2);
    const { src, c } = fromFixtures();
    let res = await src.list({ page: { limit: 2000 } });
    expect(res.total).toBe(one.states.length);
    res = await src.list({ page: { limit: 2000 } });
    expect(res.total).toBe(one.states.length); // inside the TTL
    c.advance(FLIGHTS_OPTS.cache_ttl_ms);
    res = await src.list({ page: { limit: 2000 } });
    expect(res.total).toBe(two.states.length);
    // An aircraft in both recordings has a trail of two points, lng before lat in the array.
    const both = one.states.find((s) => two.states.some((t) => t[0] === s[0]));
    if (!both) throw new Error("no aircraft in both fixtures");
    const later = two.states.find((t) => t[0] === both[0]) as unknown[];
    const row = byId(res.rows, String(both[0]));
    expect(row).toMatchObject({
      lat: later[6],
      lng: later[5],
      lat_history: [both[6], later[6]],
      lng_history: [both[5], later[5]],
      time_pos: new Date((later[3] as number) * 1000).toISOString(),
    });
    expect(String(row?.callsign)).toBe(String(later[1]).trim());
    c.advance(FLIGHTS_OPTS.cache_ttl_ms);
    res = await src.list({ page: { limit: 2000 } });
    expect(res.total).toBe(two.states.length);
    expect(byId(res.rows, String(both[0]))?.lat_history).toEqual([both[6], later[6], later[6]]);
  });

  it("filters, sorts and pages as ArraySource does over the same rows", async () => {
    const { src } = fromFixtures();
    const all = (await src.list({ page: { limit: 2000 } })).rows;
    const memory = new MemorySource({ schema: await src.describe(), rows: all });
    const queries = [
      { filter: { field: "on_ground", op: "eq" as const, value: false } },
      { filter: { field: "baro_alt", op: "between" as const, value: [6000, 10000] } },
      { filter: { field: "country", op: "in" as const, value: ["Turkey", "Germany"] } },
      { filter: { field: "callsign", op: "contains" as const, value: "pgt" } },
    ];
    for (const q of queries) {
      for (const sort of [
        [{ field: "baro_alt", dir: "desc" as const }],
        [{ field: "callsign", dir: "asc" as const }],
      ]) {
        const page = { limit: 7, offset: 3 };
        const a = await src.list({ ...q, sort, page });
        const b = await memory.list({ ...q, sort, page });
        expect(ids(a.rows)).toEqual(ids(b.rows));
        expect(a.total).toBe(b.total);
      }
    }
    const grounded = await src.list({ filter: { field: "on_ground", op: "eq", value: true } });
    expect(grounded.total).toBeLessThan(all.length);
  });

  it("the factory honours UDC_FLIGHTS_CACHE_TTL_MS over both TTLs", async () => {
    const src = makeSource(flights, {
      env: { UDC_HTTP_FIXTURES: FIXTURES, UDC_FLIGHTS_CACHE_TTL_MS: "1000" },
    }) as HttpApiSource;
    expect(src.info()).toEqual({ auth: "anonymous", cache_ttl_ms: 1000 });
    const dflt = makeSource(flights, { env: { UDC_HTTP_FIXTURES: FIXTURES } }) as HttpApiSource;
    expect(dflt.info()).toEqual({ auth: "anonymous", cache_ttl_ms: 240_000 });
  });
});
