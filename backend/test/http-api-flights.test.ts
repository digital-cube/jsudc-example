import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type HttpApiOptions, HttpApiOptionsSchema, type Row, SchemaDocSchema } from "@jsudc/core";
import { describe, expect, it } from "vitest";
import { COLLECTIONS_DIR } from "../src/config.js";
import { buildDescribe } from "../src/describe.js";
import { readCollectionAssets } from "../src/registry.js";
import { makeSource } from "../src/sources/factory.js";
import { type FetchLike, HttpApiSource, mapItems } from "../src/sources/http-api.js";
import { MemorySource } from "../src/sources/memory.js";
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

const schema = SchemaDocSchema.parse({
  version: "v1",
  fields: {
    icao24: { type: "string" },
    callsign: { type: "string" },
    lng: { type: "decimal" },
    lat: { type: "decimal" },
    alt: { type: "decimal" },
    seen: { type: "datetime" },
  },
});

const options = (o: Record<string, unknown> = {}): HttpApiOptions =>
  HttpApiOptionsSchema.parse({
    base_url: "https://sky.test",
    list_endpoint: "/states",
    list_unwrap: "states",
    id_field: "[0]",
    field_map: { icao24: "[0]", callsign: "[1]", lng: "[2]", lat: "[3]", alt: "[4]", seen: "[5]" },
    epoch_seconds: ["seen"],
    cache_ttl_ms: 240_000,
    ...o,
  });

const state = (id: string, lng: number, lat: number, alt: number | null) => [
  id,
  `${id.toUpperCase()}  `,
  lng,
  lat,
  alt,
  1_793_172_114,
];
const body = (...states: unknown[][]) => ({ time: 1, states });

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/**
 * A fetch with two endpoints: the token URL answers from `tokens`, every
 * other URL from `answers` (the last answer repeats). `{status}` answers that
 * status, an Error is thrown.
 */
function upstream(opts: { answers: unknown[]; tokens?: unknown[] }) {
  const calls: Call[] = [];
  const answers = [...opts.answers];
  const tokens = [...(opts.tokens ?? [])];
  const next = (list: unknown[]) => (list.length > 1 ? list.shift() : list[0]);
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
    });
    const answer = url.endsWith("/token") ? next(tokens) : next(answers);
    if (answer instanceof Error) throw answer;
    if (answer && typeof answer === "object" && "status" in answer) {
      const { status } = answer as { status: number };
      return { ok: false, status, statusText: "Nope", json: async () => ({}) };
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => answer };
  };
  const api = () => calls.filter((c) => !c.url.endsWith("/token"));
  const token = () => calls.filter((c) => c.url.endsWith("/token"));
  return { fetch, calls, api, token };
}

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const AUTH = {
  kind: "oauth2_client_credentials",
  token_url: "https://auth.sky.test/token",
  client_id_env: "SKY_ID",
  client_secret_env: "SKY_SECRET",
};
const CREDS = { SKY_ID: "me", SKY_SECRET: "s3cret" };

function source(args: {
  fetch: FetchLike;
  opts?: Record<string, unknown>;
  env?: Record<string, string>;
  logs?: string[];
}) {
  const c = clock();
  const src = new HttpApiSource({
    name: "sky",
    schema,
    options: options(args.opts),
    fetch: args.fetch,
    env: args.env ?? {},
    now: c.now,
    log: { info: () => {}, warn: (m: string) => args.logs?.push(m) },
  });
  return { src, c };
}

/** One upstream call: past the TTL, then a list. */
async function poll(src: HttpApiSource, c: ReturnType<typeof clock>, ms = 240_000) {
  c.advance(ms);
  return (await src.list({ page: { limit: 500 } })).rows;
}

const byId = (rows: Row[], id: string) => rows.find((r) => r.__meta.id === id);

describe("a positional-array upstream", () => {
  it("maps items by index, keys rows by [0], trims the padded callsign", () => {
    const rows = mapItems(body(state("4bc8e1", 23.47, 43.55, 10972.8)), schema, options());
    expect(ids(rows)).toEqual(["4bc8e1"]);
    expect(rows[0]).toMatchObject({
      icao24: "4bc8e1",
      callsign: "4BC8E1",
      lng: 23.47,
      lat: 43.55,
      alt: 10972.8,
    });
  });

  it("reads epoch seconds as a datetime where epoch_seconds says so, milliseconds elsewhere", () => {
    const [row] = mapItems(body(state("a", 1, 2, 3)), schema, options());
    expect(row?.seen).toBe(new Date(1_793_172_114_000).toISOString());
    const [ms] = mapItems(body(state("a", 1, 2, 3)), schema, options({ epoch_seconds: [] }));
    expect(ms?.seen).toBe(new Date(1_793_172_114).toISOString());
  });

  it("answers no rows for OpenSky's `states: null` (an empty box)", () => {
    expect(mapItems({ time: 1, states: null }, schema, options())).toEqual([]);
  });
});

describe("history", () => {
  const hist = (o: Record<string, unknown> = {}) => ({
    history: { fields: ["alt", "lat", "lng"], size: 3, ...o },
  });

  it("grows one value per upstream call, oldest first, capped at size", async () => {
    const up = upstream({
      answers: [1, 2, 3, 4].map((i) => body(state("a", 20 + i, 44 + i, 1000 * i))),
    });
    const { src, c } = source({ fetch: up.fetch, opts: hist() });
    let rows = await poll(src, c, 0);
    expect(byId(rows, "a")?.alt_history).toEqual([1000]);
    // Inside the TTL: the same snapshot, the window does not move.
    rows = (await src.list({})).rows;
    expect(byId(rows, "a")?.alt_history).toEqual([1000]);
    rows = await poll(src, c);
    expect(byId(rows, "a")).toMatchObject({ alt_history: [1000, 2000], lat_history: [45, 46] });
    await poll(src, c);
    rows = await poll(src, c);
    expect(byId(rows, "a")).toMatchObject({
      alt_history: [2000, 3000, 4000],
      lng_history: [22, 23, 24],
    });
    expect(up.api()).toHaveLength(4);
  });

  it("skips a null value instead of storing it", async () => {
    const up = upstream({
      answers: [body(state("a", 1, 2, 100)), body(state("a", 1, 2, null))],
    });
    const { src, c } = source({ fetch: up.fetch, opts: hist() });
    await poll(src, c, 0);
    expect(byId(await poll(src, c), "a")?.alt_history).toEqual([100]);
  });

  it("drops an id's window after ttl_polls polls without it", async () => {
    const withA = body(state("a", 1, 2, 100), state("b", 1, 2, 5));
    const withoutA = body(state("b", 1, 2, 5));
    const up = upstream({ answers: [withA, withoutA, withA, withoutA, withoutA, withA] });
    const { src, c } = source({ fetch: up.fetch, opts: hist({ ttl_polls: 2 }) });
    await poll(src, c, 0);
    await poll(src, c); // a missed once
    // Back before ttl_polls: the window kept its old value.
    expect(byId(await poll(src, c), "a")?.alt_history).toEqual([100, 100]);
    await poll(src, c);
    await poll(src, c); // a missed twice in a row: dropped
    expect(byId(await poll(src, c), "a")?.alt_history).toEqual([100]);
  });

  it("is added to the schema describe serves, as json fields after the schema's own", async () => {
    const { src } = source({ fetch: upstream({ answers: [body()] }).fetch, opts: hist() });
    const described = await src.describe();
    expect(described.field_order.slice(-3)).toEqual(["alt_history", "lat_history", "lng_history"]);
    expect(described.fields.lat_history?.type).toBe("json");
    // A view may name them: describe builds columns over them.
    const view = { ...flights.view, columns: [{ field: "alt_history" }] };
    const d = buildDescribe("sky", src.capabilities, described, view, {
      source_kind: "http_api",
      source: src.info(),
    });
    expect(d.view.columns.map((col) => col.field)).toContain("alt_history");
    expect(d.source).toEqual({ auth: "anonymous", cache_ttl_ms: 240_000 });
  });
});

describe("OAuth2 client credentials", () => {
  const opts = { auth: AUTH, cache_ttl_ms_authenticated: 15_000 };
  const tok = (access_token: string, expires_in = 1800) => ({ access_token, expires_in });

  it("fetches a token once with the client credentials and reuses it", async () => {
    const up = upstream({ answers: [body(state("a", 1, 2, 3))], tokens: [tok("T1")] });
    const { src, c } = source({ fetch: up.fetch, opts, env: CREDS });
    await poll(src, c, 0);
    await poll(src, c, 15_000);
    expect(up.token()).toHaveLength(1);
    const [t] = up.token();
    expect(t?.method).toBe("POST");
    expect(t?.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(t?.body)).toEqual(
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: "me",
        client_secret: "s3cret",
      }),
    );
    expect(up.api().map((a) => a.headers.Authorization)).toEqual(["Bearer T1", "Bearer T1"]);
    expect(src.info()).toEqual({ auth: "oauth2", cache_ttl_ms: 15_000 });
  });

  it("sends the scope when there is one", async () => {
    const up = upstream({ answers: [body()], tokens: [tok("T1")] });
    const { src, c } = source({
      fetch: up.fetch,
      opts: { auth: { ...AUTH, scope: "read" } },
      env: CREDS,
    });
    await poll(src, c, 0);
    expect(new URLSearchParams(up.token()[0]?.body).get("scope")).toBe("read");
  });

  it("refreshes the token at 90 % of expires_in", async () => {
    const up = upstream({ answers: [body()], tokens: [tok("T1", 100), tok("T2", 100)] });
    const { src, c } = source({ fetch: up.fetch, opts, env: CREDS });
    await poll(src, c, 0);
    await poll(src, c, 80_000); // 80 s: still T1
    await poll(src, c, 16_000); // 96 s: past 90 s, T2
    expect(up.api().map((a) => a.headers.Authorization)).toEqual([
      "Bearer T1",
      "Bearer T1",
      "Bearer T2",
    ]);
  });

  it("retries a 401 once with a fresh token", async () => {
    const up = upstream({
      answers: [{ status: 401 }, body(state("a", 1, 2, 3))],
      tokens: [tok("OLD"), tok("NEW")],
    });
    const { src, c } = source({ fetch: up.fetch, opts, env: CREDS });
    const rows = await poll(src, c, 0);
    expect(ids(rows)).toEqual(["a"]);
    expect(up.api().map((a) => a.headers.Authorization)).toEqual(["Bearer OLD", "Bearer NEW"]);
  });

  it("does not retry a second 401: the poll fails as any upstream error", async () => {
    const up = upstream({ answers: [{ status: 401 }], tokens: [tok("A"), tok("B")] });
    const { src, c } = source({ fetch: up.fetch, opts, env: CREDS });
    await expect(poll(src, c, 0)).rejects.toThrow(/401/);
    expect(up.api()).toHaveLength(2);
  });

  it("without either variable calls anonymously, without an error, at the anonymous TTL", async () => {
    const envs: Record<string, string>[] = [{}, { SKY_ID: "me" }, { SKY_SECRET: "s" }];
    for (const env of envs) {
      const up = upstream({ answers: [body(state("a", 1, 2, 3))], tokens: [new Error("no")] });
      const logs: string[] = [];
      const { src, c } = source({ fetch: up.fetch, opts, env, logs });
      await poll(src, c, 0);
      await poll(src, c, 15_000); // inside the anonymous 240 s: no call
      expect(up.token()).toHaveLength(0);
      expect(up.api()).toHaveLength(1);
      expect(up.api()[0]?.headers).not.toHaveProperty("Authorization");
      expect(src.info()).toEqual({ auth: "anonymous", cache_ttl_ms: 240_000 });
      expect(logs).toEqual([]);
    }
  });

  it("falls back to anonymous for a poll whose token request fails, logging it once", async () => {
    const up = upstream({
      answers: [body(state("a", 1, 2, 3))],
      tokens: [{ status: 500 }, new Error("down"), tok("T1")],
    });
    const logs: string[] = [];
    const { src, c } = source({ fetch: up.fetch, opts, env: CREDS, logs });
    expect(ids(await poll(src, c, 0))).toEqual(["a"]);
    expect(up.api()[0]?.headers).not.toHaveProperty("Authorization");
    // That poll was anonymous: the anonymous TTL holds until the next call.
    expect(src.info()).toEqual({ auth: "anonymous", cache_ttl_ms: 240_000 });
    await poll(src, c, 15_000);
    expect(up.api()).toHaveLength(1);
    await poll(src, c, 240_000); // the token endpoint fails again: still one log line
    await poll(src, c, 240_000); // it answers: authenticated again
    expect(up.api().map((a) => a.headers.Authorization ?? null)).toEqual([null, null, "Bearer T1"]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/token.*500.*anonymous/i);
    expect(src.info()).toEqual({ auth: "oauth2", cache_ttl_ms: 15_000 });
  });

  it("uses cache_ttl_ms_authenticated only while authenticated", async () => {
    const up = upstream({ answers: [body()], tokens: [tok("T1")] });
    const { src, c } = source({ fetch: up.fetch, opts, env: CREDS });
    await poll(src, c, 0);
    await poll(src, c, 14_000);
    expect(up.api()).toHaveLength(1);
    await poll(src, c, 2_000);
    expect(up.api()).toHaveLength(2);
    // Without the option the authenticated source keeps cache_ttl_ms.
    const plain = upstream({ answers: [body()], tokens: [tok("T1")] });
    const s2 = source({ fetch: plain.fetch, opts: { auth: AUTH }, env: CREDS });
    await poll(s2.src, s2.c, 0);
    await poll(s2.src, s2.c, 15_000);
    expect(plain.api()).toHaveLength(1);
    expect(s2.src.info()).toEqual({ auth: "oauth2", cache_ttl_ms: 240_000 });
  });
});

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
