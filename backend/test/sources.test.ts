import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACTIONS, type CollectionsResponse, type DescribeResponse } from "@jsudc/udc-core";
import { afterAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { BLOB_MAX_BYTES } from "../src/blob.js";
import { COLLECTIONS_DIR } from "../src/config.js";
import { createDispatcher } from "../src/dispatcher.js";
import { type CollectionAsset, loadRegistry, readCollectionAssets } from "../src/registry.js";
import {
  filesystemRoot,
  httpSourcesEnabled,
  makeSource,
  rootEnvVar,
} from "../src/sources/factory.js";
import { FilesystemSource } from "../src/sources/filesystem.js";
import { HttpApiSource } from "../src/sources/http-api.js";
import { PostgresJsonbSource } from "../src/sources/postgres-jsonb.js";
import { useTestDb } from "./helpers.js";

const fixtures = (name: string) => join(import.meta.dirname, "fixtures", name);
const HTTP_SMALL = fixtures("http-small");
// `describe` of a Postgres collection reads its schema revisions (none: schema.json).
const { db } = useTestDb();

function serve(dir: string, env: Record<string, string | undefined> = {}) {
  const registry = loadRegistry(dir, (a) => makeSource(a, { db, env }));
  const dispatcher = createDispatcher(registry, { log: { error: vi.fn() } });
  const call = async <T>(action: string, payload: unknown) => {
    const res = await dispatcher.dispatch({ kind: `udc.${action}`, id: "t", payload });
    if (!res.kind.endsWith(".ok")) throw new Error(JSON.stringify(res.payload));
    return res.payload as T;
  };
  return { registry, dispatcher, call };
}

describe("source.yaml in the registry", () => {
  it("reads source.yaml when present and defaults to postgres_jsonb", () => {
    const assets = readCollectionAssets(fixtures("sources"));
    expect(assets.map((a) => [a.name, a.source.kind])).toEqual([
      ["local", "filesystem"],
      ["net", "http_api"],
      ["plain", "postgres_jsonb"],
    ]);
    const net = assets.find((a) => a.name === "net");
    // A flat file (options beside kind) parses with the defaults filled in.
    expect(net?.source).toMatchObject({
      options: { base_url: "https://net.example.test", cache_ttl_ms: 60_000, timeout_ms: 15_000 },
    });
  });

  it.each([
    ["bad-source", /broken\/source\.yaml: invalid/],
    ["bad-root", /escape\/source\.yaml: invalid.*\n.*\.\. segment/s],
  ])("fails startup on %s, naming the file", (dir, message) => {
    expect(() => readCollectionAssets(fixtures(dir))).toThrow(message);
  });

  it("builds each source by kind", () => {
    const { registry } = serve(fixtures("sources"));
    expect(registry.get("plain").source).toBeInstanceOf(PostgresJsonbSource);
    expect(registry.get("local").source).toBeInstanceOf(FilesystemSource);
    expect(registry.get("net").source).toBeInstanceOf(HttpApiSource);
    expect(() =>
      makeSource(readCollectionAssets(fixtures("sources"))[2] as CollectionAsset, {}),
    ).toThrow(/needs a database/);
  });

  it("lists source_kind and the sidebar group of every collection", async () => {
    const { call } = serve(fixtures("sources"));
    const res = await call<CollectionsResponse>("collections", {});
    expect(ACTIONS.collections.response.safeParse(res).success).toBe(true);
    expect(res.collections.map((c) => [c.name, c.source_kind, c.group])).toEqual([
      ["local", "filesystem", "files"],
      ["net", "http_api", "internet"],
      ["plain", "postgres_jsonb", "database"],
    ]);
    expect(res.collections[0]?.capabilities).toMatchObject({ mutate: false, paging: ["offset"] });
  });

  it("UDC_HTTP_SOURCES=off leaves the internet group out", async () => {
    for (const off of ["off", "0", "false", "NO"])
      expect(httpSourcesEnabled({ UDC_HTTP_SOURCES: off })).toBe(false);
    expect(httpSourcesEnabled({})).toBe(true);
    expect(httpSourcesEnabled({ UDC_HTTP_SOURCES: "on" })).toBe(true);
    const { call, registry } = serve(fixtures("sources"), { UDC_HTTP_SOURCES: "off" });
    const res = await call<CollectionsResponse>("collections", {});
    expect(res.collections.map((c) => c.group)).toEqual(["files", "database"]);
    expect(() => registry.get("net")).toThrow(/unknown collection/);
  });

  it("serves README.md / README.<locale>.md in describe.docs", async () => {
    const { call } = serve(fixtures("sources"));
    const plain = await call<DescribeResponse>("describe", { collection: "plain" });
    expect(ACTIONS.describe.response.safeParse(plain).success).toBe(true);
    expect(plain.docs).toEqual({ en: "# Plain\n\nEnglish.\n", sr: "# Obično\n\nSrpski.\n" });
    expect(plain.source_kind).toBe("postgres_jsonb");
    const net = await call<DescribeResponse>("describe", { collection: "net" });
    expect(net.docs).toEqual({ en: "# Net only in English\n" });
    expect(net.source_kind).toBe("http_api");
    const local = await call<DescribeResponse>("describe", { collection: "local" });
    expect(local.docs).toBeUndefined();
  });

  it("UDC_HTTP_FIXTURES feeds an http_api collection from <dir>/<name>.json", async () => {
    const { call } = serve(fixtures("sources"), { UDC_HTTP_FIXTURES: HTTP_SMALL });
    const res = await call<{ rows: { title: unknown }[]; total: number; fetched_at: string }>(
      "list",
      { collection: "net", sort: [{ field: "title", dir: "desc" }] },
    );
    expect(res.rows.map((r) => r.title)).toEqual(["Two", "One"]);
    expect(res.total).toBe(2);
    expect(typeof res.fetched_at).toBe("string");
  });

  it("moves a filesystem root with UDC_<NAME>_ROOT", () => {
    const [local] = readCollectionAssets(fixtures("sources"));
    if (!local) throw new Error("fixture");
    expect(rootEnvVar("files")).toBe("UDC_FILES_ROOT");
    expect(filesystemRoot(local, "tree", {})).toBe(join(fixtures("sources"), "local", "tree"));
    expect(filesystemRoot(local, "tree", { UDC_LOCAL_ROOT: "/srv/x" })).toBe("/srv/x");
    expect(filesystemRoot(local, "/abs", { UDC_LOCAL_ROOT: " " })).toBe("/abs");
  });
});

describe("the shipped files, quakes and repos collections", () => {
  const assets = readCollectionAssets(COLLECTIONS_DIR);
  const asset = (name: string) => {
    const a = assets.find((x) => x.name === name);
    if (!a) throw new Error(name);
    return a;
  };

  it("files: a read-only folder listing of sample/, with a README in both languages", async () => {
    const files = asset("files");
    expect(files.view).toMatchObject({
      available_renderers: ["table", "cards"],
      folder_options: { path_field: "path", kind_field: "kind", dir_value: "dir", preview: true },
      search: { fields: ["name"] },
    });
    expect(files.view.columns.find((c) => c.field === "size")?.render).toBe("bytes");
    expect(Object.keys(files.docs ?? {})).toEqual(["en", "sr"]);
    const src = makeSource(files, { env: {} }) as FilesystemSource;
    const root = await src.list({});
    expect(root.rows.slice(0, 3).map((r) => [r.name, r.kind])).toEqual([
      ["data", "dir"],
      ["docs", "dir"],
      ["images", "dir"],
    ]);
    expect(root.total).toBeGreaterThanOrEqual(8);
    const docs = await src.list({ filter: { field: "path", op: "eq", value: "docs" } });
    expect(docs.rows.map((r) => r.name)).toEqual([
      "..",
      "archive",
      "api.json",
      "filters.md",
      "getting-started.md",
    ]);
  });

  it("quakes: opens on the map, polls every minute, coordinates are schema numbers", () => {
    const quakes = asset("quakes");
    expect(quakes.view).toMatchObject({
      default_renderer: "map",
      available_renderers: ["map", "table", "cards", "chart"],
      refresh_interval_ms: 60_000,
      map_options: {
        lat_field: "lat",
        lng_field: "lng",
        radius_field: "mag",
        radius_scale: 2.5,
        radius_min: 4,
        zoom: 2,
      },
    });
    expect(quakes.view.map_options?.regions?.map((r) => r.id)).toEqual([
      "world",
      "europe",
      "pacific",
    ]);
    expect(quakes.view.filters?.map((f) => `${f.field}:${f.kind}`)).toEqual([
      "alert:select",
      "mag:range",
    ]);
  });

  it("repos: cards with the avatar, the token header dropped without UDC_GITHUB_TOKEN", () => {
    const repos = asset("repos");
    expect(repos.view.card_options).toMatchObject({
      image_field: "owner_avatar",
      image_style: "avatar",
    });
    expect(repos.schema.fields.topics?.type).toBe("string_array");
    if (repos.source.kind !== "http_api") throw new Error("kind");
    expect(repos.source.options.cache_ttl_ms).toBe(300_000);
  });
});

describe("flights through the dispatcher", () => {
  it("describes the history fields, anonymous auth and the cache TTL; lists the fixture", async () => {
    const { call } = serve(COLLECTIONS_DIR, {
      UDC_HTTP_FIXTURES: fixtures("http"),
    });
    const d = await call<DescribeResponse>("describe", { collection: "flights" });
    expect(d.source_kind).toBe("http_api");
    expect(d.source).toEqual({ auth: "anonymous", cache_ttl_ms: 240_000 });
    for (const f of ["baro_alt_history", "lat_history", "lng_history"]) {
      expect(d.schema.fields[f]?.type).toBe("json");
    }
    expect(d.view.columns.find((c) => c.field === "baro_alt_history")?.render).toBe("sparkline");
    expect(Object.keys(d.docs ?? {})).toEqual(["en", "sr"]);
    const list = await call<{ rows: Record<string, unknown>[]; total: number }>("list", {
      collection: "flights",
      page: { limit: 500 },
    });
    expect(list.total).toBeGreaterThan(50);
    expect(list.rows[0]?.baro_alt_history).toHaveLength(1);
    // A Postgres collection says nothing about its source.
    const companies = await call<DescribeResponse>("describe", { collection: "companies" });
    expect(companies).not.toHaveProperty("source");
  });
});

describe("GET /udc/files/blob", () => {
  const tmp = mkdtempSync(join(tmpdir(), "jsudc-blob-"));
  writeFileSync(join(tmp, "small.md"), "# Small\n");
  writeFileSync(join(tmp, "big.txt"), "x".repeat(BLOB_MAX_BYTES + 1));
  writeFileSync(join(tmp, "pic.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  async function app(env: Record<string, string> = {}) {
    const { registry, dispatcher } = serve(fixtures("sources"), env);
    return buildApp({ dispatcher, registry });
  }
  const get = async (a: Awaited<ReturnType<typeof app>>, query: string) =>
    a.inject({ method: "GET", url: `/udc/files/blob?${query}` });

  it("serves a text file with its content type", async () => {
    const a = await app();
    const res = await get(a, "collection=local&path=sub/x.md");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(res.body).toBe("# Sub\n");
    await a.close();
  });

  it("refuses traversal, folders, unknown types, missing files and other collections", async () => {
    const a = await app();
    expect((await get(a, "collection=local&path=../../../package.json")).statusCode).toBe(400);
    expect((await get(a, "collection=local&path=sub")).statusCode).toBe(400);
    expect((await get(a, "collection=local&path=blob.bin")).statusCode).toBe(415);
    expect((await get(a, "collection=local&path=nope.txt")).statusCode).toBe(404);
    expect((await get(a, "collection=plain&path=x.txt")).statusCode).toBe(404);
    expect((await get(a, "collection=local")).statusCode).toBe(400);
    await a.close();
  });

  it("refuses a file over 256 KB and sandboxes an SVG", async () => {
    const a = await app({ UDC_LOCAL_ROOT: tmp });
    expect((await get(a, "collection=local&path=big.txt")).statusCode).toBe(413);
    const svg = await get(a, "collection=local&path=pic.svg");
    expect(svg.statusCode).toBe(200);
    expect(svg.headers["content-security-policy"]).toBe("sandbox");
    await a.close();
  });
});
