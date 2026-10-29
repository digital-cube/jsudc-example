import type { ColumnColor, LatLng, MapOptions, MapRegion, Row, RowColorConfig } from "@jsudc/core";
import { resolveRowColor } from "../table/style";

/** One row on the map. */
export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  radius: number;
  tone: ColumnColor;
  /** Degrees clockwise from north for an `airplane` icon; `null` draws the circle. */
  rotation: number | null;
  /** The positions it has flown, oldest first (`trail`); empty without one. */
  trail: LatLng[];
  row: Row;
}

/** More rows than this and a trail is drawn only for the hovered and the selected marker. */
export const TRAILS_FOR_ALL_MAX = 300;

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
 * The turn of a row's aeroplane, `[0, 360)`: `rotate_field` of an
 * `icon: airplane` map. `null` (a circle) for the circle icon or a row
 * without a usable value — a missing track is not north.
 */
export function rotationOf(row: Record<string, unknown>, opts: MapOptions): number | null {
  if (opts.icon !== "airplane") return null;
  if (!opts.rotate_field) return 0;
  const v = toNumber(row[opts.rotate_field]);
  return v === null ? null : ((v % 360) + 360) % 360;
}

const numbers = (v: unknown): (number | null)[] => (Array.isArray(v) ? v.map(toNumber) : []);

/**
 * The trail of a row: its lat and lng histories paired from the newest end
 * (both are appended together), pairs out of range dropped, the last
 * `max_points`, oldest first. Empty without a `trail` block.
 */
export function trailOf(row: Record<string, unknown>, opts: MapOptions): LatLng[] {
  const trail = opts.trail;
  if (!trail) return [];
  const lats = numbers(row[trail.lat_history_field]);
  const lngs = numbers(row[trail.lng_history_field]);
  const n = Math.min(lats.length, lngs.length);
  const out: LatLng[] = [];
  for (let i = 0; i < n; i++) {
    const lat = lats[lats.length - n + i];
    const lng = lngs[lngs.length - n + i];
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    out.push([lat, lng]);
  }
  return out.slice(-trail.max_points);
}

/**
 * The markers whose trail is drawn: all of them up to `TRAILS_FOR_ALL_MAX`,
 * above it only the hovered and the selected one. A trail needs two points.
 */
export function trailMarkers(
  markers: readonly MapMarker[],
  hovered: string | null,
  selected: string | null,
): MapMarker[] {
  const drawn = markers.filter((m) => m.trail.length >= 2);
  if (markers.length <= TRAILS_FOR_ALL_MAX) return drawn;
  return drawn.filter((m) => m.id === hovered || m.id === selected);
}

/**
 * An aeroplane seen from above, nose up (north), in a 24×24 box: filled
 * with `currentColor`, so the tone's CSS colour paints it.
 */
export const AIRPLANE_PATH =
  "M12 1.5 L13.5 9 L22.5 13 L22.5 14.5 L13.5 13.5 L13 18.5 L16 20.5 L16 21.5 L12 20.5 L8 21.5 L8 20.5 L11 18.5 L10.5 13.5 L1.5 14.5 L1.5 13 L10.5 9 Z";

/** The inner HTML of an aeroplane marker: turned by CSS, sized by `icon_size`. */
export function airplaneHtml(rotation: number, size: number): string {
  return (
    `<div class="udc-map-plane-glyph" style="width:${size}px;height:${size}px;transform:rotate(${rotation}deg)">` +
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">` +
    `<path d="${AIRPLANE_PATH}"/></svg></div>`
  );
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
      rotation: rotationOf(row, opts),
      trail: trailOf(row, opts),
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
