import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  getPath,
  parseFieldPath,
  parseSourceConfig,
  SourceConfigSchema,
  sourceGroup,
} from "../src/index.js";

const shipped = (name: string) =>
  parse(
    readFileSync(new URL(`./fixtures/collections/${name}/source.yaml`, import.meta.url), "utf8"),
  );

describe("SourceConfig", () => {
  it("accepts the files source.yaml, with the filesystem defaults", () => {
    const cfg = parseSourceConfig(shipped("files"));
    expect(cfg).toEqual({
      kind: "filesystem",
      options: { root: "sample", follow_symlinks: false, max_entries: 5000 },
    });
  });

  it("accepts the quakes source.yaml, field_map paths with [N]", () => {
    const cfg = parseSourceConfig(shipped("quakes"));
    expect(cfg.kind).toBe("http_api");
    if (cfg.kind !== "http_api") return;
    expect(cfg.options).toMatchObject({
      base_url: "https://earthquake.usgs.gov",
      list_unwrap: "features",
      id_field: "id",
      cache_ttl_ms: 60_000,
      timeout_ms: 20_000,
      max_rows: 2000,
    });
    expect(cfg.options.field_map.lat).toBe("geometry.coordinates[1]");
  });

  it("accepts the repos source.yaml, the token header as written", () => {
    const cfg = parseSourceConfig(shipped("repos"));
    if (cfg.kind !== "http_api") throw new Error("not http_api");
    expect(cfg.options.headers?.Authorization).toBe("Bearer ${UDC_GITHUB_TOKEN}");
    expect(cfg.options.cache_ttl_ms).toBe(300_000);
    expect(cfg.options.timeout_ms).toBe(10_000);
  });

  it("defaults to postgres_jsonb without a file and reads a flat file as {kind, options}", () => {
    expect(parseSourceConfig(undefined)).toEqual({ kind: "postgres_jsonb", options: {} });
    expect(parseSourceConfig(null)).toEqual({ kind: "postgres_jsonb", options: {} });
    expect(parseSourceConfig({ kind: "memory" })).toEqual({ kind: "memory", options: {} });
    expect(parseSourceConfig({ kind: "filesystem", root: "/srv/data" })).toMatchObject({
      kind: "filesystem",
      options: { root: "/srv/data", follow_symlinks: false },
    });
  });

  it("rejects an unknown kind", () => {
    expect(SourceConfigSchema.safeParse({ kind: "opensearch", options: {} }).success).toBe(false);
    expect(SourceConfigSchema.safeParse({ options: {} }).success).toBe(false);
  });

  it("rejects a root that climbs out with ..", () => {
    for (const root of ["..", "../etc", "sample/../../x", "a\\..\\b"]) {
      expect(
        SourceConfigSchema.safeParse({ kind: "filesystem", options: { root } }).success,
        root,
      ).toBe(false);
    }
    expect(
      SourceConfigSchema.safeParse({ kind: "filesystem", options: { root: "a..b" } }).success,
    ).toBe(true);
  });

  it("rejects a malformed field path, a relative endpoint and a bad env name", () => {
    const base = { base_url: "https://x.test", list_endpoint: "/l", id_field: "id" };
    const ok = (options: object) =>
      SourceConfigSchema.safeParse({ kind: "http_api", options: { ...base, ...options } }).success;
    expect(ok({})).toBe(true);
    expect(ok({ field_map: { a: "x[" } })).toBe(false);
    expect(ok({ field_map: { a: "x..y" } })).toBe(false);
    expect(ok({ list_endpoint: "l" })).toBe(false);
    expect(ok({ env_required: ["lower"] })).toBe(false);
    expect(ok({ base_url: "not a url" })).toBe(false);
  });

  it("groups kinds for the sidebar", () => {
    expect(sourceGroup("postgres_jsonb")).toBe("database");
    expect(sourceGroup("memory")).toBe("database");
    expect(sourceGroup("filesystem")).toBe("files");
    expect(sourceGroup("http_api")).toBe("internet");
    expect(sourceGroup("yaml_menu")).toBe("files");
  });

  it("accepts the menu source.yaml, dynamic by default", () => {
    const cfg = parseSourceConfig(shipped("menu"));
    if (cfg.kind !== "yaml_menu") throw new Error("not yaml_menu");
    expect(cfg.options.file).toBe("data/menu.yaml");
    expect(cfg.options.dynamic).toBe(true);
    expect(cfg.options.collection_icons.tickets).toBe("lucide:kanban");
    const flat = parseSourceConfig({ kind: "yaml_menu", file: "m.yaml" });
    expect(flat).toEqual({
      kind: "yaml_menu",
      options: { file: "m.yaml", dynamic: true, collection_icons: {} },
    });
  });

  it("refuses a yaml_menu file that climbs out or is absolute", () => {
    const ok = (file: string) =>
      SourceConfigSchema.safeParse({ kind: "yaml_menu", options: { file } }).success;
    expect(ok("data/menu.yaml")).toBe(true);
    expect(ok("../other/menu.yaml")).toBe(false);
    expect(ok("data/../../menu.yaml")).toBe(false);
    expect(ok("/etc/menu.yaml")).toBe(false);
    expect(ok("")).toBe(false);
  });
});

describe("field paths", () => {
  const item = {
    id: "q1",
    properties: { mag: 5.1, place: "Off the coast" },
    geometry: { coordinates: [139.7, 35.6, 10] },
    authors: [{ name: "a" }, { name: "b" }, {}],
    "x-y": 1,
  };

  it("parses dotted keys, [N] and [*]", () => {
    expect(parseFieldPath("geometry.coordinates[1]")).toEqual([
      { key: "geometry" },
      { key: "coordinates" },
      { index: 1 },
    ]);
    expect(parseFieldPath("authors[*].name")).toEqual([
      { key: "authors" },
      { all: true },
      { key: "name" },
    ]);
    expect(parseFieldPath("[0]")).toEqual([{ index: 0 }]);
    for (const bad of ["", "a.", ".a", "a[x]", "a[", "a[-1]"])
      expect(parseFieldPath(bad)).toBeNull();
  });

  it("walks an item; missing steps answer null", () => {
    expect(getPath(item, "properties.mag")).toBe(5.1);
    expect(getPath(item, "geometry.coordinates[0]")).toBe(139.7);
    expect(getPath(item, "geometry.coordinates[2]")).toBe(10);
    expect(getPath(item, "geometry.coordinates[3]")).toBeNull();
    expect(getPath(item, "authors[*].name")).toEqual(["a", "b", null]);
    expect(getPath(item, "properties.missing.deeper")).toBeNull();
    expect(getPath(item, "properties[0]")).toBeNull();
    expect(getPath(item, "id[*]")).toBeNull();
    expect(getPath(item, "x-y")).toBe(1);
    expect(getPath([{ a: 1 }], "[0].a")).toBe(1);
  });
});
