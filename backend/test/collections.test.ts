/**
 * The demo collections under backend/collections: that they parse, are wired
 * the way the UI expects, and serve their recorded or seeded rows. The
 * machinery itself is tested in @jsudc/server against its own fixtures.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type DescribeResponse, type SchemaDocInput, SchemaDocSchema } from "@jsudc/core";
import {
  createDispatcher,
  type FilesystemSource,
  HttpApiSource,
  loadRegistry,
  MemorySource,
  makeSource,
  PostgresJsonbSource,
  readCollectionAssets,
  seedCollection,
} from "@jsudc/server";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { COLLECTIONS_DIR } from "../src/config.js";
import { useTestDb } from "./helpers.js";

const FIXTURES = join(import.meta.dirname, "fixtures", "http");
const fixtures = (name: string) => join(import.meta.dirname, "fixtures", name);
// `describe` of a Postgres collection reads its schema revisions.
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

describe("the demo collections in the registry", () => {
  it("ships the companies, the kanban and the calendar collections", () => {
    const assets = readCollectionAssets(COLLECTIONS_DIR);
    expect(assets.map((a) => a.name)).toEqual([
      "appointments",
      "boards",
      "buckets",
      "comments",
      "companies",
      "files",
      "flights",
      "menu",
      "metrics",
      "org",
      "quakes",
      "repos",
      "tickets",
    ]);
    // The appointments and the metrics are generated at seed time, around the day it runs;
    // files, the menu and the net need no seed.
    expect(assets.filter((a) => a.seedFile === null).map((a) => a.name)).toEqual([
      "appointments",
      "files",
      "flights",
      "menu",
      "metrics",
      "quakes",
      "repos",
    ]);
    expect(Object.fromEntries(assets.map((a) => [a.name, a.source.kind]))).toMatchObject({
      companies: "postgres_jsonb",
      tickets: "postgres_jsonb",
      files: "filesystem",
      quakes: "http_api",
      repos: "http_api",
      flights: "http_api",
      menu: "yaml_menu",
    });
    const tickets = assets.find((a) => a.name === "tickets");
    expect(tickets?.view.default_renderer).toBe("kanban");
    expect(tickets?.view.kanban_options?.bucket_collection).toBe("buckets");
    // Every field the board reads exists in the schemas it reads it from.
    const opts = tickets?.view.kanban_options;
    const buckets = assets.find((a) => a.name === "buckets");
    const card = opts ? Object.values(opts.card).flat() : [];
    for (const f of [
      opts?.ticket_board_field,
      opts?.ticket_bucket_field,
      opts?.ticket_order_field,
      ...card,
    ]) {
      expect(tickets?.schema.fields, String(f)).toHaveProperty(String(f));
    }
    for (const f of [
      opts?.bucket_filter_field,
      opts?.bucket_order_field,
      opts?.bucket_label_field,
      opts?.bucket_color_field,
    ]) {
      expect(buckets?.schema.fields, String(f)).toHaveProperty(String(f));
    }
  });

  it("parses both calendar views, their fields datetime fields of the schema", () => {
    const assets = readCollectionAssets(COLLECTIONS_DIR);
    const appointments = assets.find((a) => a.name === "appointments");
    expect(appointments?.view).toMatchObject({
      default_renderer: "calendar",
      available_renderers: ["calendar", "table"],
      calendar_options: {
        start_field: "start",
        end_field: "end",
        title_field: "title",
        color_field: "doctor",
        default_preset: "workweek",
        business_hours: [8, 20],
        hour_height_px: 64,
        scroll_to_hour: 7.5,
        detail: { delete: true },
      },
    });
    expect(Object.keys(appointments?.view.calendar_options?.color_map ?? {})).toEqual(
      appointments?.schema.fields.doctor?.values,
    );
    expect(appointments?.view.calendar_options?.detail?.fields.map((f) => f.field)).toEqual([
      "title",
      "doctor",
      "patient",
      "room",
      "status",
      "notes",
    ]);
    const tickets = assets.find((a) => a.name === "tickets");
    expect(tickets?.view.available_renderers).toContain("calendar");
    expect(tickets?.view.calendar_options).toMatchObject({
      start_field: "starts_at",
      end_field: "ends_at",
      color_field: "priority",
      default_preset: "week",
    });
    for (const a of [appointments, tickets]) {
      const o = a?.view.calendar_options;
      expect(a?.schema.fields[o?.start_field ?? ""]?.type).toBe("datetime");
      expect(a?.schema.fields[o?.end_field ?? ""]?.type).toBe("datetime");
    }
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

describe("the recorded GitHub answer", () => {
  it("maps the recorded GitHub answer: nested avatar, topics, ISO pushes", async () => {
    const repos = readCollectionAssets(COLLECTIONS_DIR).find((a) => a.name === "repos");
    if (repos?.source.kind !== "http_api") throw new Error("repos is not http_api");
    const src = new HttpApiSource({
      name: "repos",
      schema: repos.schema,
      options: repos.source.options,
      fixturesDir: FIXTURES,
    });
    const res = await src.list({
      filter: { field: "topics", op: "contains", value: "udc" },
      page: { limit: 100 },
    });
    expect(res.total).toBeGreaterThan(0);
    for (const r of res.rows) {
      expect(r.owner_avatar).toMatch(/^https:\/\/avatars\.githubusercontent\.com\//);
      expect(r.topics).toContain("udc");
      expect(Number.isNaN(Date.parse(String(r.pushed_at)))).toBe(false);
      expect(typeof r.stargazers_count).toBe("number");
    }
    expect((await src.list({ page: { limit: 1 } })).total).toBe(45);
  });
});
describe("the shipped menu collection", () => {
  it("mirrors the application: six roots, three dynamic groups, every collection listed once", async () => {
    const registry = loadRegistry(COLLECTIONS_DIR, (a, reg) =>
      a.source.kind === "yaml_menu" || a.source.kind === "memory"
        ? makeSource(a, { registry: reg })
        : new MemorySource({ schema: a.schema }),
    );
    const menu = registry.get("menu").source;
    const { rows } = await menu.list({ page: { limit: 1000 } });
    const roots = rows.filter((r) => r.parent_id === null).map((r) => r.code);
    expect(roots).toEqual(["HOME", "COLLECTIONS", "VIEWS", "DOCS", "EXAMPLES", "MENU", "ABOUT"]);
    const dynamic = rows.filter((r) => r.is_dynamic);
    expect(dynamic.map((r) => r.url).sort()).toEqual(
      registry
        .list()
        .map((c) => `/udc/${c.name}`)
        .sort(),
    );
    expect(dynamic.find((r) => r.code === "COLLECTION_MENU")?.icon).toBe("lucide:list-tree");
    // Every Doc leaf points at a collection that has a README.
    for (const doc of rows.filter((r) => String(r.url).endsWith("?tab=doc"))) {
      const name = String(doc.url).replace(/^\/udc\/(\w+)\?tab=doc$/, "$1");
      expect(registry.get(name).docs?.en, name).toBeTruthy();
    }
  });
});

describe("seeding the demo tickets", () => {
  const ticketsSchemaJson = JSON.parse(
    readFileSync(join(COLLECTIONS_DIR, "tickets", "schema.json"), "utf8"),
  ) as SchemaDocInput;
  const ticketsSeed = JSON.parse(
    readFileSync(join(COLLECTIONS_DIR, "tickets", "seed.json"), "utf8"),
  ) as Record<string, unknown>[];

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
