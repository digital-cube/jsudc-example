/*
 * Wall-clock maths in an IANA zone without a date library: `Intl` knows
 * every zone's rules, so an instant's wall time is one `formatToParts`, and
 * the instant of a wall time is a guess corrected by the offset at that guess.
 * A civil day ({y, m, d}) has no zone; adding days to it is plain UTC maths.
 */

export interface CivilDay {
  y: number;
  /** 1–12 */
  m: number;
  d: number;
}

export interface WallTime extends CivilDay {
  hh: number;
  mm: number;
  ss?: number;
}

export interface ZonedParts extends Required<WallTime> {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall time `instant` (ms) reads in `timeZone`. */
export function zonedParts(instant: number, timeZone: string): ZonedParts {
  const out: Record<string, string> = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(instant))) out[p.type] = p.value;
  return {
    y: Number(out.year),
    m: Number(out.month),
    d: Number(out.day),
    hh: Number(out.hour) % 24,
    mm: Number(out.minute),
    ss: Number(out.second),
    weekday: WEEKDAYS[out.weekday ?? ""] ?? 0,
  };
}

/** `timeZone`'s offset from UTC at `instant`, in minutes (Belgrade: +60 in winter, +120 in summer). */
export function offsetMinutes(instant: number, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / MINUTE);
}

/**
 * The instant a wall time names in `timeZone`. A wall time the clocks skip
 * (02:30 on a spring-forward night) lands on the same distance past the gap
 * (03:30); one they repeat (02:30 on a fall-back night) is the first of the two.
 */
export function zonedToInstant(wall: WallTime, timeZone: string): number {
  const asUtc = Date.UTC(wall.y, wall.m - 1, wall.d, wall.hh, wall.mm, wall.ss ?? 0);
  // The offset before and after the wall time: equal except next to a change.
  const before = offsetMinutes(asUtc - DAY / 2, timeZone);
  const after = offsetMinutes(asUtc + DAY / 2, timeZone);
  if (before === after) return asUtc - before * MINUTE;
  const early = asUtc - before * MINUTE;
  const late = asUtc - after * MINUTE;
  const reads = (t: number) => {
    const p = zonedParts(t, timeZone);
    return p.hh === wall.hh && p.mm === wall.mm && p.d === wall.d;
  };
  if (reads(early)) return early;
  if (reads(late)) return late;
  // In the gap: neither reads back; the pre-change offset carries it past the gap.
  return early;
}

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");

/** `+01:00`, `-04:00`, `+05:30`; `Z` never (the patch says which zone it was written in). */
export function offsetText(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  return `${sign}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}

/**
 * `2026-10-27T08:00:00+01:00`: the instant as `timeZone` reads it, with that
 * zone's offset. `ms` adds `.SSS` (the window's closing `…59.999`).
 */
export function isoInZone(instant: number, timeZone: string, ms = false): string {
  const p = zonedParts(instant, timeZone);
  const frac = ms ? `.${pad(((instant % 1000) + 1000) % 1000, 3)}` : "";
  return (
    `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}${frac}` +
    offsetText(offsetMinutes(instant, timeZone))
  );
}

/** `UTC+1`, `UTC−4`, `UTC+5:30`, `UTC`: the short label the zone picker shows. */
export function offsetLabel(minutes: number): string {
  if (minutes === 0) return "UTC";
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return `UTC${minutes < 0 ? "−" : "+"}${h}${m ? `:${pad(m)}` : ""}`;
}

// --- civil days ----------------------------------------------------------------------

export function addDays(day: CivilDay, n: number): CivilDay {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function addMonths(day: CivilDay, n: number): CivilDay {
  const t = new Date(Date.UTC(day.y, day.m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: Math.min(day.d, last) };
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: CivilDay): number {
  return new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
}

/** Whole days from `a` to `b`. */
export function daysBetween(a: CivilDay, b: CivilDay): number {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY);
}

export function dayKey(day: CivilDay): string {
  return `${pad(day.y, 4)}-${pad(day.m)}-${pad(day.d)}`;
}

/** `YYYY-MM-DD` → the civil day, or `null` for anything else. */
export function parseDayKey(raw: string | null | undefined): CivilDay | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw ?? "");
  if (!m) return null;
  const day = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  return dayKey(addDays(day, 0)) === raw ? day : null;
}

export const sameDay = (a: CivilDay, b: CivilDay) => a.y === b.y && a.m === b.m && a.d === b.d;

/** The civil day `instant` falls on in `timeZone`. */
export function dayOf(instant: number, timeZone: string): CivilDay {
  const { y, m, d } = zonedParts(instant, timeZone);
  return { y, m, d };
}

/** 00:00 of `day` in `timeZone`. */
export function startOfDay(day: CivilDay, timeZone: string): number {
  return zonedToInstant({ ...day, hh: 0, mm: 0 }, timeZone);
}

/** Minutes since 00:00 of its own day, as `timeZone`'s clock reads `instant`. */
export function minuteOfDay(instant: number, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  return p.hh * 60 + p.mm + p.ss / 60;
}

// --- formatting ------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

/** `Intl.DateTimeFormat(locale, {...opts, timeZone})`, cached: a grid formats hundreds of labels. */
export function zonedFormat(
  intlLocale: string,
  timeZone: string,
  opts: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${intlLocale}|${timeZone}|${JSON.stringify(opts)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(intlLocale, { ...opts, timeZone });
    formatters.set(key, f);
  }
  return f;
}

/** A civil day formatted as a date (no zone shift: it is formatted at UTC noon in UTC). */
export function formatDay(day: CivilDay, intlLocale: string, opts: Intl.DateTimeFormatOptions) {
  return zonedFormat(intlLocale, "UTC", opts).format(
    new Date(Date.UTC(day.y, day.m - 1, day.d, 12)),
  );
}

/** `08:00` on a 24-hour clock in `sr`, `8:00 AM` in `en`. */
export function formatTime(instant: number, intlLocale: string, timeZone: string): string {
  return zonedFormat(intlLocale, timeZone, { hour: "numeric", minute: "2-digit" }).format(instant);
}

// --- zones ---------------------------------------------------------------------------------

export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isValidZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Every zone the runtime knows (`Intl.supportedValuesOf`), UTC included. */
export function allZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const zones = intl.supportedValuesOf?.("timeZone") ?? [];
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

/** `America/New_York` → `New York`. */
export function zoneCity(zone: string): string {
  return (zone.split("/").at(-1) ?? zone).replace(/_/g, " ");
}
