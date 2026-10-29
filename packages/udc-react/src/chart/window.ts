import { type ChartWindow, type FilterNode, parseWindowPreset } from "@jsudc/core";
import {
  addDays,
  dayOf,
  isoInZone,
  MINUTE,
  startOfDay,
  type WallTime,
  zonedToInstant,
} from "../time/zoned";

export const WIN_PARAM = "win";
export const FROM_PARAM = "from";
export const TO_PARAM = "to";

/** What the window control picked: a preset, or a custom pair of wall times in the header's zone. */
export type WindowSel =
  | { kind: "preset"; preset: string }
  | { kind: "custom"; from: string | null; to: string | null };

/** `2026-10-26T08:00`: a wall time as `<input type="datetime-local">` writes it. */
const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function parseWall(raw: string | null | undefined): WallTime | null {
  const m = raw ? WALL_RE.exec(raw) : null;
  if (!m) return null;
  const wall = {
    y: Number(m[1]),
    m: Number(m[2]),
    d: Number(m[3]),
    hh: Number(m[4]),
    mm: Number(m[5]),
  };
  return wall.m >= 1 && wall.m <= 12 && wall.d >= 1 && wall.d <= 31 && wall.hh < 24 && wall.mm < 60
    ? wall
    : null;
}

/**
 * The window in the URL: `?from=&to=` (either may be missing) when the view
 * allows a custom range, else `?win=` when it is one of the presets, else the
 * default preset. `explicit` says the URL chose it, so the other tabs of the
 * view apply it too.
 */
export function readWindow(
  params: URLSearchParams,
  cfg: ChartWindow,
): { sel: WindowSel; explicit: boolean } {
  const from = parseWall(params.get(FROM_PARAM)) ? params.get(FROM_PARAM) : null;
  const to = parseWall(params.get(TO_PARAM)) ? params.get(TO_PARAM) : null;
  if (cfg.allow_custom && (from || to))
    return { sel: { kind: "custom", from, to }, explicit: true };
  const win = params.get(WIN_PARAM);
  if (win && cfg.presets.includes(win)) {
    return { sel: { kind: "preset", preset: win }, explicit: true };
  }
  return { sel: { kind: "preset", preset: cfg.default }, explicit: false };
}

/** `params` with `sel` written in (and the other kind's keys removed); `null` clears the window. */
export function writeWindow(params: URLSearchParams, sel: WindowSel | null): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const k of [WIN_PARAM, FROM_PARAM, TO_PARAM]) next.delete(k);
  if (sel?.kind === "preset") next.set(WIN_PARAM, sel.preset);
  if (sel?.kind === "custom") {
    if (sel.from) next.set(FROM_PARAM, sel.from);
    if (sel.to) next.set(TO_PARAM, sel.to);
  }
  return next;
}

/**
 * The instants (ms) a window spans, both ends included, in `timeZone`; a side
 * a custom range leaves open is `null`.
 *
 * - `Nh` is the last N hours ending now (`now` to the minute): the same
 *   instants in every zone, only written with the zone's offset.
 * - `Nd` is the last N calendar days ending at the end of today *in that
 *   zone* (today and the N−1 days before it, midnight to midnight), so the
 *   zone moves its instants: Tokyo's 7d starts hours before Belgrade's.
 * - A custom range reads its wall times in `timeZone`; `to` takes the whole
 *   minute it names.
 */
export function windowRange(
  sel: WindowSel,
  now: number,
  timeZone: string,
): [number | null, number | null] {
  if (sel.kind === "custom") {
    const from = parseWall(sel.from);
    const to = parseWall(sel.to);
    return [
      from ? zonedToInstant(from, timeZone) : null,
      to ? zonedToInstant(to, timeZone) + MINUTE - 1 : null,
    ];
  }
  const p = parseWindowPreset(sel.preset) ?? { n: 24, unit: "h" as const };
  if (p.unit === "h") {
    const end = Math.floor(now / MINUTE) * MINUTE;
    return [end - p.n * 60 * MINUTE, end];
  }
  const today = dayOf(now, timeZone);
  return [
    startOfDay(addDays(today, -(p.n - 1)), timeZone),
    startOfDay(addDays(today, 1), timeZone) - 1,
  ];
}

/**
 * The window as one condition on `field`: `between` with both ends as ISO
 * instants in the zone's offset (`2026-10-27T12:00:00.000+01:00`), `gte` /
 * `lte` for a half-open custom range, nothing for an empty one.
 */
export function windowCondition(
  field: string,
  sel: WindowSel,
  now: number,
  timeZone: string,
): FilterNode | undefined {
  const [from, to] = windowRange(sel, now, timeZone);
  const iso = (t: number) => isoInZone(t, timeZone, true);
  if (from !== null && to !== null) return { field, op: "between", value: [iso(from), iso(to)] };
  if (from !== null) return { field, op: "gte", value: iso(from) };
  if (to !== null) return { field, op: "lte", value: iso(to) };
  return undefined;
}

/** `filter` AND the window (either may be missing). */
export function andWindow(
  filter: FilterNode | undefined,
  cond: FilterNode | undefined,
): FilterNode | undefined {
  if (!cond) return filter;
  return filter ? { and: [filter, cond] } : cond;
}

/** A wall time for `<input type="datetime-local">`: the instant as `timeZone` reads it. */
export function wallOf(instant: number, timeZone: string): string {
  return isoInZone(instant, timeZone).slice(0, 16);
}
