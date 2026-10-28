import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  MapOptionsSchema,
  mapOptionsProblems,
  SchemaDocSchema,
  ViewConfigSchema,
} from "../src/index.js";

describe("MapOptions", () => {
  it("needs lat_field and lng_field, and fills every other default", () => {
    expect(MapOptionsSchema.safeParse({}).success).toBe(false);
    expect(MapOptionsSchema.parse({ lat_field: "lat", lng_field: "lng" })).toEqual({
      lat_field: "lat",
      lng_field: "lng",
      radius_min: 4,
      radius_scale: 1,
      radius_max: 40,
      zoom: 2,
      fit_bounds: true,
      max_rows: 2000,
      icon: "circle",
      icon_size: 22,
    });
  });

  it("fits the bounds by default only when there is no center", () => {
    const at = (block: Record<string, unknown>) =>
      MapOptionsSchema.parse({ lat_field: "lat", lng_field: "lng", ...block }).fit_bounds;
    expect(at({ center: [44.8, 20.4] })).toBe(false);
    expect(at({ center: [44.8, 20.4], fit_bounds: true })).toBe(true);
    expect(at({ fit_bounds: false })).toBe(false);
  });

  it("parses a quakes-shaped view: regions, radius by magnitude, dclabs keys kept", () => {
    const view = ViewConfigSchema.parse({
      default_renderer: "map",
      available_renderers: ["map", "table", "cards"],
      map_options: {
        lat_field: "lat",
        lng_field: "lng",
        radius_field: "mag",
        radius_scale: 2.2,
        radius_min: 5,
        popup_fields: ["title", "mag", "depth_km", "place", "quake_type"],
        center: [20, 0],
        zoom: 2,
        regions: [
          { id: "world", label: "World", center: [20, 0], zoom: 2 },
          { id: "pacific", label: "Ring of Fire", center: [10, 160], zoom: 3 },
        ],
        default_region: "world",
        icon: "circle",
      },
    });
    const opts = view.map_options;
    expect(opts).toMatchObject({ radius_field: "mag", radius_min: 5, fit_bounds: false });
    expect(opts?.regions?.map((r) => r.id)).toEqual(["world", "pacific"]);
    expect(opts).toHaveProperty("icon", "circle");
  });

  it.each([
    [{ center: [91, 0] }, "center"],
    [{ zoom: 30 }, "zoom"],
    [{ radius_scale: -1 }, "radius_scale"],
    [{ max_rows: 0 }, "max_rows"],
    [{ radius_min: 10, radius_max: 5 }, "radius_max"],
    [{ regions: [{ id: "a", label: "A", center: [0, 0] }] }, "regions"],
    [
      {
        regions: [
          { id: "a", label: "A", center: [0, 0], zoom: 3 },
          { id: "a", label: "B", center: [1, 1], zoom: 3 },
        ],
      },
      "regions",
    ],
    [{ default_region: "nowhere" }, "default_region"],
  ])("refuses %j", (block, path) => {
    const res = MapOptionsSchema.safeParse({ lat_field: "lat", lng_field: "lng", ...block });
    expect(res.success).toBe(false);
    expect(res.error?.issues.map((i) => i.path[0])).toContain(path);
  });

  it("refuses a view that lists map without map_options, saying so", () => {
    const res = ViewConfigSchema.safeParse({ available_renderers: ["table", "map"] });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(["map_options"]);
    expect(res.error?.issues[0]?.message).toMatch(/lists map, so map_options .* is required/);
    expect(ViewConfigSchema.safeParse({ available_renderers: ["table"] }).success).toBe(true);
  });
});

describe("the backend's companies view", () => {
  const view = ViewConfigSchema.parse(
    parse(
      readFileSync(
        new URL("../../../backend/collections/companies/view.yaml", import.meta.url),
        "utf8",
      ),
    ),
  );

  it("has a map tab over lat / lng, sized by employees, over Serbia", () => {
    expect(view.available_renderers).toEqual(["table", "cards", "map"]);
    expect(view.map_options).toMatchObject({
      lat_field: "lat",
      lng_field: "lng",
      radius_field: "employees",
      radius_scale: 0.02,
      popup_fields: ["name", "city", "industry", "employees"],
      center: [44.2, 20.9],
      zoom: 7,
      fit_bounds: false,
    });
    expect(view.map_options?.regions?.map((r) => r.id)).toEqual(["serbia", "vojvodina", "south"]);
  });
});

describe("mapOptionsProblems", () => {
  const schema = SchemaDocSchema.parse({
    version: "v1",
    fields: {
      name: { type: "string" },
      lat: { type: "decimal" },
      lng: { type: "decimal" },
      mag: { type: "decimal" },
      employees: { type: "integer" },
      gone: { type: "decimal", deleted: true },
    },
  });
  const problems = (block: Record<string, unknown>) =>
    mapOptionsProblems(
      MapOptionsSchema.parse({ lat_field: "lat", lng_field: "lng", ...block }),
      schema,
    );

  it("is empty when every field fits", () => {
    expect(problems({ radius_field: "employees", popup_fields: ["name", "mag"] })).toEqual([]);
  });

  it("names a missing, deleted or non-number coordinate or radius, and a missing popup field", () => {
    expect(problems({ lat_field: "latitude" })).toEqual([
      "lat_field: latitude is not a field of the schema",
    ]);
    expect(problems({ lng_field: "gone" })).toEqual([
      "lng_field: gone is not a field of the schema",
    ]);
    expect(problems({ radius_field: "name" })).toEqual([
      "radius_field: name is string, a map needs a number",
    ]);
    expect(problems({ popup_fields: ["name", "website"] })).toEqual([
      "popup_fields[1]: website is not a field of the schema",
    ]);
  });
});
