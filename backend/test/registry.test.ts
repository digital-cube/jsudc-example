import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLLECTIONS_DIR } from "../src/config.js";
import { CollectionRegistry, loadRegistry, readCollectionAssets } from "../src/registry.js";
import { MemorySource } from "../src/sources/memory.js";

const fixtures = (name: string) => join(import.meta.dirname, "fixtures", name);

describe("collection registry", () => {
  it("scans every directory, parses view.yaml and schema.json, skips plain files", () => {
    const assets = readCollectionAssets(fixtures("ok"));
    expect(assets.map((a) => a.name)).toEqual(["books", "notes"]);
    const [books, notes] = assets;
    expect(books?.view.default_renderer).toBe("cards");
    expect(books?.schema.field_order).toEqual(["title", "pages"]);
    expect(books?.seedFile).toMatch(/books\/seed\.json$/);
    // Zod defaults applied.
    expect(notes?.view).toMatchObject({
      page_size_default: 10,
      pagination: "infinite",
      columns: [],
    });
    expect(notes?.seedFile).toBeNull();
  });

  it("registers name → {source, view} through the source factory", async () => {
    const registry = loadRegistry(fixtures("ok"), (a) => new MemorySource({ schema: a.schema }));
    expect(registry.list().map((c) => c.name)).toEqual(["books", "notes"]);
    const books = registry.get("books");
    expect(books.view.available_renderers).toEqual(["table", "cards"]);
    expect((await books.source.describe()).fields.title?.type).toBe("string");
  });

  it("ships the companies, the kanban and the calendar collections", () => {
    const assets = readCollectionAssets(COLLECTIONS_DIR);
    expect(assets.map((a) => a.name)).toEqual([
      "appointments",
      "boards",
      "buckets",
      "comments",
      "companies",
      "files",
      "metrics",
      "org",
      "quakes",
      "repos",
      "tickets",
    ]);
    // The appointments and the metrics are generated at seed time, around the day it runs;
    // files and the net need no seed.
    expect(assets.filter((a) => a.seedFile === null).map((a) => a.name)).toEqual([
      "appointments",
      "files",
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

  it("loads the shipped companies collection", () => {
    const companies = readCollectionAssets(COLLECTIONS_DIR).find((a) => a.name === "companies");
    expect(companies?.name).toBe("companies");
    expect(companies?.view).toMatchObject({
      available_renderers: ["table", "cards", "map"],
      pagination: "infinite",
      page_size_default: 50,
      row_height: 48,
      search: { fields: ["name", "pib", "mb", "city"] },
      card_options: { title_field: "name", subtitle_field: "pib", size: "medium" },
    });
    const editable = companies?.view.columns.filter((c) => c.editable).map((c) => c.field);
    expect(editable).toEqual([
      "name",
      "city",
      "industry",
      "employees",
      "revenue_eur",
      "founded",
      "active",
    ]);
    expect(companies?.view.filters?.map((f) => `${f.field}:${f.kind}`)).toEqual([
      "city:select",
      "industry:select",
      "active:bool",
      "employees:range",
    ]);
    expect(companies?.view.filterable?.fields).toHaveLength(10);
  });

  it.each([
    ["bad-view", /broken\/view\.yaml.*\n.*pagination/s],
    ["bad-yaml", /broken\/view\.yaml/],
    ["bad-schema", /broken\/schema\.json/],
    ["no-schema", /lonely\/schema\.json/],
    ["core-fields", /withcore\/schema\.json.*core_fields must be empty/],
    ["bad-name", /Bad-Name.*collection name/],
    ["bad-calendar", /agenda\/view\.yaml.*calendar_options.*\n.*start_field: day is date/s],
    ["bad-tree", /thread\/view\.yaml.*tree_options.*\n.*label_field: title is not a field/s],
    ["lazy-tree", /chart\/view\.yaml.*invalid.*children_count_field/s],
    ["bad-map", /places\/view\.yaml.*map_options.*\n.*popup_fields\[1\]: website is not a field/s],
    ["map-without-options", /plain\/view\.yaml.*invalid.*lists map, so map_options/s],
    ["bad-chart", /series\/view\.yaml.*chart_options.*\n.*series\[1\]\.field: mem is not a field/s],
    ["bad-pie", /stars\/view\.yaml.*invalid.*a pie needs value_field/s],
  ])("fails startup on %s, naming the file", (dir, message) => {
    expect(() => readCollectionAssets(fixtures(dir))).toThrow(message);
  });

  it("refuses a duplicate name and answers not_found for an unknown one", () => {
    const registry = new CollectionRegistry();
    const [asset] = readCollectionAssets(fixtures("ok"));
    if (!asset) throw new Error("fixture missing");
    const c = { name: "x", source: new MemorySource({ schema: asset.schema }), view: asset.view };
    registry.register(c);
    expect(() => registry.register(c)).toThrow(/twice/);
    expect(() => registry.get("y")).toThrow(/unknown collection/);
  });
});
