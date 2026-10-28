import { z } from "zod";
import type { SchemaDoc } from "./schema.js";

const Field = z.string().min(1);

/** `[lat, lng]` in degrees. */
export const LatLngSchema = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);
export type LatLng = z.infer<typeof LatLngSchema>;

const Zoom = z.number().min(0).max(20);

/** A named view of the map: a button in the map toolbar flies there. */
export const MapRegionSchema = z.looseObject({
  id: Field,
  label: z.string().min(1),
  center: LatLngSchema,
  zoom: Zoom,
});
export type MapRegion = z.infer<typeof MapRegionSchema>;

// Loose, as every view block: a dclabs `map_options` carries keys jsudc does
// not read (icon, rotate_field, icon_size, trail) and must still parse.
// Every key declared here is one the map renderer reads.
export const MapOptionsSchema = z
  .looseObject({
    /** A number field: the marker's latitude. */
    lat_field: Field,
    /** A number field: the marker's longitude. */
    lng_field: Field,
    /** A number field: the marker grows with it (`radius_min + value * radius_scale`). */
    radius_field: Field.optional(),
    /** The radius in px of a marker without (or with a zero) `radius_field` value. */
    radius_min: z.number().min(0).default(4),
    radius_scale: z.number().min(0).default(1),
    /** The cap, in px: one huge value must not cover its neighbours. */
    radius_max: z.number().min(0).default(40),
    /** The popup's rows, in order, formatted as the table formats them. */
    popup_fields: z.array(Field).optional(),
    /** Where the map opens; without one it fits every marker. */
    center: LatLngSchema.optional(),
    zoom: Zoom.default(2),
    /** Fit to the markers on the first load; defaults to true when there is no `center`. */
    fit_bounds: z.boolean().optional(),
    /** The most rows the map reads (pages of the list, as the other all-rows renderers). */
    max_rows: z.number().int().min(1).max(50_000).default(2000),
    regions: z.array(MapRegionSchema).optional(),
    /** A region id: where the map opens instead of `center`. */
    default_region: Field.optional(),
  })
  .superRefine((o, ctx) => {
    if (o.radius_max < o.radius_min) {
      ctx.addIssue({
        code: "custom",
        path: ["radius_max"],
        message: "radius_max must not be below radius_min",
      });
    }
    const ids = (o.regions ?? []).map((r) => r.id);
    ids.forEach((id, i) => {
      if (ids.indexOf(id) !== i) {
        ctx.addIssue({ code: "custom", path: ["regions", i, "id"], message: `duplicate id ${id}` });
      }
    });
    if (o.default_region !== undefined && !ids.includes(o.default_region)) {
      ctx.addIssue({
        code: "custom",
        path: ["default_region"],
        message: `default_region ${o.default_region} is not the id of one of regions`,
      });
    }
  })
  .transform((o) => ({ ...o, fit_bounds: o.fit_bounds ?? o.center === undefined }));

export type MapOptionsInput = z.input<typeof MapOptionsSchema>;
export type MapOptions = z.output<typeof MapOptionsSchema>;

const NUMBER_TYPES = new Set(["integer", "decimal", "year", "rating"]);

/**
 * What a schema says against a map block: every field the map reads must be
 * a live field of the schema, and the coordinates and the radius numbers.
 * Empty when the block fits; the registry refuses a collection otherwise.
 */
export function mapOptionsProblems(opts: MapOptions, schema: SchemaDoc): string[] {
  const live = (f: string) => {
    const def = schema.fields[f];
    return def && !def.deleted ? def : undefined;
  };
  const problems: string[] = [];
  const numeric: [string, string | undefined][] = [
    ["lat_field", opts.lat_field],
    ["lng_field", opts.lng_field],
    ["radius_field", opts.radius_field],
  ];
  for (const [key, field] of numeric) {
    if (!field) continue;
    const def = live(field);
    if (!def) problems.push(`${key}: ${field} is not a field of the schema`);
    else if (!NUMBER_TYPES.has(def.type)) {
      problems.push(`${key}: ${field} is ${def.type}, a map needs a number`);
    }
  }
  (opts.popup_fields ?? []).forEach((field, i) => {
    if (!live(field)) problems.push(`popup_fields[${i}]: ${field} is not a field of the schema`);
  });
  return problems;
}
