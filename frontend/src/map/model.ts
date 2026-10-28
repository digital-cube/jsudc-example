import type {
  ColumnColor,
  LatLng,
  MapOptions,
  MapRegion,
  Row,
  RowColorConfig,
} from "@jsudc/udc-core";
import { resolveRowColor } from "../table/style";

/** One row on the map. */
export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  radius: number;
  tone: ColumnColor;
  row: Row;
}

/** A finite number from a number or a numeric string (a decimal may arrive as either). */
export function toNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** `[lat, lng]` of a row, or `null` when either is missing or out of range. */
export function coordsOf(row: Record<string, unknown>, opts: MapOptions): LatLng | null {
  const lat = toNumber(row[opts.lat_field]);
  const lng = toNumber(row[opts.lng_field]);
  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

/** `radius_min + value * radius_scale`, at most `radius_max`; `radius_min` without a usable value. */
export function markerRadius(row: Record<string, unknown>, opts: MapOptions): number {
  const v = opts.radius_field ? toNumber(row[opts.radius_field]) : null;
  if (v === null || v <= 0) return opts.radius_min;
  return Math.min(opts.radius_max, opts.radius_min + v * opts.radius_scale);
}

/** The colour of the first `row_color` rule the row matches, else the accent. */
export function markerTone(
  row: Record<string, unknown>,
  cfg: RowColorConfig | undefined,
): ColumnColor {
  const color = resolveRowColor(row, cfg)?.color;
  return color && color !== "default" ? color : "accent";
}

/**
 * The rows that can be placed, biggest first: drawn in that order, a small
 * marker sits on top of a large one around it and stays clickable.
 */
export function toMarkers(
  rows: readonly Row[],
  opts: MapOptions,
  rowColor: RowColorConfig | undefined,
): MapMarker[] {
  const out: MapMarker[] = [];
  for (const row of rows) {
    const at = coordsOf(row, opts);
    if (!at) continue;
    out.push({
      id: row.__meta.id,
      lat: at[0],
      lng: at[1],
      radius: markerRadius(row, opts),
      tone: markerTone(row, rowColor),
      row,
    });
  }
  return out.sort((a, b) => b.radius - a.radius);
}

/** `[[south, west], [north, east]]` around every marker; `null` for none. */
export function boundsOf(
  markers: readonly Pick<MapMarker, "lat" | "lng">[],
): [LatLng, LatLng] | null {
  if (markers.length === 0) return null;
  let s = 90;
  let w = 180;
  let n = -90;
  let e = -180;
  for (const m of markers) {
    s = Math.min(s, m.lat);
    n = Math.max(n, m.lat);
    w = Math.min(w, m.lng);
    e = Math.max(e, m.lng);
  }
  return [
    [s, w],
    [n, e],
  ];
}

export function regionById(opts: MapOptions, id: string | null): MapRegion | undefined {
  return id === null ? undefined : opts.regions?.find((r) => r.id === id);
}

/** Where the map opens: the default region, else `center` / `zoom` (the world when there is no center). */
export function initialView(opts: MapOptions): {
  center: LatLng;
  zoom: number;
  region: string | null;
} {
  const region = regionById(opts, opts.default_region ?? null);
  if (region) return { center: region.center, zoom: region.zoom, region: region.id };
  return { center: opts.center ?? [20, 0], zoom: opts.zoom, region: null };
}

/**
 * The region a view is in: the one whose centre and zoom it shows (after a
 * fly-to, or on open), else none — a pan or a zoom by hand leaves every
 * region button unpressed.
 */
export function regionAt(
  opts: MapOptions,
  center: LatLng,
  zoom: number,
  tolerance = 0.01,
): string | null {
  const found = opts.regions?.find(
    (r) =>
      r.zoom === zoom &&
      Math.abs(r.center[0] - center[0]) <= tolerance &&
      Math.abs(r.center[1] - center[1]) <= tolerance,
  );
  return found?.id ?? null;
}
