import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  type HttpApiOptions,
  historyFieldName,
  historyProblems,
  httpApiProblems,
  MapOptionsSchema,
  mapOptionsProblems,
  parseFieldPath,
  parseSourceConfig,
  SchemaDocSchema,
  SourceConfigSchema,
  ViewConfigSchema,
  withHistoryFields,
} from "../src/index.js";

const file = (name: string) =>
  readFileSync(new URL(`../../../backend/collections/flights/${name}`, import.meta.url), "utf8");

const source = parseSourceConfig(parse(file("source.yaml")));
const opts = source.options as HttpApiOptions;
const schema = SchemaDocSchema.parse(JSON.parse(file("schema.json")));
const view = ViewConfigSchema.parse(parse(file("view.yaml")));

describe("the flights collection", () => {
  it("source.yaml: OpenSky's box, the row by index, OAuth2, the history", () => {
    expect(source.kind).toBe("http_api");
    expect(opts.list_endpoint).toBe("/api/states/all?lamin=41.5&lomin=18.5&lamax=46.5&lomax=23.5");
    expect(opts.id_field).toBe("[0]");
    expect(opts.field_map).toMatchObject({ lng: "[5]", lat: "[6]", geo_alt: "[13]" });
    expect(opts.auth).toEqual({
      kind: "oauth2_client_credentials",
      token_url:
        "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
      client_id_env: "UDC_OPENSKY_CLIENT_ID",
      client_secret_env: "UDC_OPENSKY_CLIENT_SECRET",
    });
    expect(opts.cache_ttl_ms).toBe(240_000);
    expect(opts.cache_ttl_ms_authenticated).toBe(15_000);
    expect(opts.history).toEqual({ fields: ["baro_alt", "lat", "lng"], size: 60, ttl_polls: 10 });
    expect(httpApiProblems(opts, schema)).toEqual([]);
  });

  it("view.yaml: aeroplanes turned by heading with trails, fitting the schema the server describes", () => {
    expect(view.default_renderer).toBe("map");
    expect(view.map_options).toMatchObject({
      icon: "airplane",
      rotate_field: "heading",
      icon_size: 22,
      trail: { lat_history_field: "lat_history", lng_history_field: "lng_history", max_points: 60 },
      default_region: "balkans",
    });
    const map = view.map_options;
    if (!map) throw new Error("no map_options");
    // The histories are not in schema.json: the server adds them.
    expect(mapOptionsProblems(map, schema)).toEqual([
      "trail.lat_history_field: lat_history is not a field of the schema",
      "trail.lng_history_field: lng_history is not a field of the schema",
    ]);
    expect(mapOptionsProblems(map, withHistoryFields(schema, opts.history))).toEqual([]);
    expect(view.card_options).toMatchObject({
      metric: { field: "baro_alt", unit: " m", precision: 0 },
      sparkline: { field: "baro_alt_history" },
    });
    const byField = Object.fromEntries(view.columns.map((c) => [c.field, c]));
    expect(byField.baro_alt_history?.render).toBe("sparkline");
    expect(byField.heading?.render).toBe("heading_glyph");
    expect(byField.baro_alt?.render_options).toEqual({ precision: 0, suffix: " m" });
  });
});

describe("index paths on the item root", () => {
  it("accepts [0] and [13] as id_field and field_map entries, refuses [x]", () => {
    expect(parseFieldPath("[0]")).toEqual([{ index: 0 }]);
    expect(parseFieldPath("[13]")).toEqual([{ index: 13 }]);
    const config = (id_field: string, field_map: Record<string, string>) =>
      SourceConfigSchema.safeParse({
        kind: "http_api",
        options: { base_url: "https://x.test", list_endpoint: "/a", id_field, field_map },
      }).success;
    expect(config("[0]", { geo_alt: "[13]" })).toBe(true);
    expect(config("[x]", {})).toBe(false);
    expect(config("[0]", { lat: "[x]" })).toBe(false);
  });
});

describe("http_api auth and history options", () => {
  const base = { base_url: "https://x.test", list_endpoint: "/a", id_field: "id" };
  const parses = (extra: Record<string, unknown>) =>
    SourceConfigSchema.safeParse({ kind: "http_api", options: { ...base, ...extra } }).success;

  it("refuses an unknown auth kind, a lowercase env name and a history size out of 1..600", () => {
    expect(parses({ auth: { kind: "basic", token_url: "https://t.test" } })).toBe(false);
    const auth = {
      kind: "oauth2_client_credentials",
      token_url: "https://t.test/token",
      client_id_env: "ID",
      client_secret_env: "SECRET",
    };
    expect(parses({ auth })).toBe(true);
    expect(parses({ auth: { ...auth, client_id_env: "id" } })).toBe(false);
    expect(parses({ history: { fields: ["a"], size: 0 } })).toBe(false);
    expect(parses({ history: { fields: ["a"], size: 601 } })).toBe(false);
    expect(parses({ history: { fields: [] } })).toBe(false);
    expect(parses({ history: { fields: ["a"], ttl_polls: 101 } })).toBe(false);
  });

  it("derives f_history, adds it to the schema as json, refuses a non-number", () => {
    expect(historyFieldName("baro_alt")).toBe("baro_alt_history");
    const s = SchemaDocSchema.parse({
      version: "v1",
      fields: {
        alt: { type: "decimal" },
        name: { type: "string" },
        name_history: { type: "string" },
      },
    });
    const h = { fields: ["alt"], size: 60, ttl_polls: 10 };
    const out = withHistoryFields(s, h);
    expect(out.fields.alt_history?.type).toBe("json");
    expect(out.field_order).toEqual(["alt", "name", "name_history", "alt_history"]);
    expect(withHistoryFields(s, undefined)).toBe(s);
    expect(historyProblems({ ...h, fields: ["name", "nope"] }, s)).toEqual([
      "history.fields[0]: name is string, a history needs a number",
      "history.fields[0]: name_history is a string field of the schema, the history needs it as json",
      "history.fields[1]: nope is not a field of the schema",
    ]);
  });

  it("refuses epoch_seconds on a field that is not a datetime", () => {
    const s = SchemaDocSchema.parse({ version: "v1", fields: { n: { type: "integer" } } });
    expect(httpApiProblems({ ...opts, history: undefined, epoch_seconds: ["n", "x"] }, s)).toEqual([
      "epoch_seconds[0]: n is integer, not a datetime or a date",
      "epoch_seconds[1]: x is not a field of the schema",
    ]);
  });
});

describe("MapOptions icon, rotation and trail", () => {
  const s = SchemaDocSchema.parse({
    version: "v1",
    fields: {
      lat: { type: "decimal" },
      lng: { type: "decimal" },
      heading: { type: "decimal" },
      callsign: { type: "string" },
      lat_history: { type: "json" },
      lng_history: { type: "json" },
    },
  });
  const map = (block: Record<string, unknown>) =>
    MapOptionsSchema.parse({ lat_field: "lat", lng_field: "lng", ...block });

  it("refuses rotate_field on a string field", () => {
    expect(mapOptionsProblems(map({ icon: "airplane", rotate_field: "heading" }), s)).toEqual([]);
    expect(mapOptionsProblems(map({ icon: "airplane", rotate_field: "callsign" }), s)).toEqual([
      "rotate_field: callsign is string, a map needs a number",
    ]);
  });

  it("reads the dclabs `trail: true` as the histories of lat_field and lng_field", () => {
    expect(map({ trail: true }).trail).toEqual({
      lat_history_field: "lat_history",
      lng_history_field: "lng_history",
      max_points: 60,
    });
    expect(map({ trail: false })).not.toHaveProperty("trail");
    expect(
      mapOptionsProblems(map({ trail: { lat_history_field: "lat", lng_history_field: "x" } }), s),
    ).toEqual([
      "trail.lat_history_field: lat is decimal, a trail needs a json array",
      "trail.lng_history_field: x is not a field of the schema",
    ]);
  });

  it("refuses an unknown icon and an icon_size out of 8..64", () => {
    expect(
      MapOptionsSchema.safeParse({ lat_field: "a", lng_field: "b", icon: "star" }).success,
    ).toBe(false);
    expect(
      MapOptionsSchema.safeParse({ lat_field: "a", lng_field: "b", icon_size: 4 }).success,
    ).toBe(false);
  });
});
