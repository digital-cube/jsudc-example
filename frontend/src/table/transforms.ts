/*
 * Column `transform`s, applied to the raw value before it is shown. A
 * transform is a name (`titlecase`) or a call (`truncate:30`); a list runs
 * left to right. Every step is total: input of the wrong shape passes through
 * untouched, and an unknown name is skipped.
 */
import { zonedParts } from "../time/zoned";

export type TransformSpec = string | readonly string[] | undefined;

/** An instant: a time part and an explicit zone (`Z` or `±HH:MM`). */
const ZONED_INSTANT =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;

/** The calendar parts of an ISO date or datetime, read literally (no time-zone shift). */
export function parseIsoParts(
  v: unknown,
): { y: number; m: number; d: number; hh: number; mm: number; ss: number } | null {
  if (typeof v !== "string") return null;
  const m = ISO_DATE.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d, hh: Number(m[4] ?? 0), mm: Number(m[5] ?? 0), ss: Number(m[6] ?? 0) };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Short month names per locale, from Intl so `sr` gets its own. */
function monthShort(month: number, locale: string): string {
  const fmt = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  return fmt.format(new Date(Date.UTC(2000, month - 1, 1))).replace(/\.$/, "");
}

/**
 * The parts a pattern prints: an instant (a `datetime` with an offset) as
 * `timeZone`'s clock reads it when one is given; anything else (a `date`,
 * a wall time without a zone) literally.
 */
function patternParts(v: unknown, timeZone: string | undefined) {
  if (timeZone && typeof v === "string" && ZONED_INSTANT.test(v)) {
    const ms = Date.parse(v);
    if (!Number.isNaN(ms)) return zonedParts(ms, timeZone);
  }
  return parseIsoParts(v);
}

/** `DD.MM.YYYY`, `YYYY-MM-DD`, `MMM YYYY`, also `HH:mm:ss`. Tokens longest first. */
export function formatDatePattern(
  v: unknown,
  pattern: string,
  locale = "en",
  timeZone?: string,
): unknown {
  const p = patternParts(v, timeZone);
  if (!p) return v;
  return pattern.replace(/YYYY|MMM|MM|DD|HH|mm|ss/g, (tok) => {
    switch (tok) {
      case "YYYY":
        return pad(p.y, 4);
      case "MMM":
        return monthShort(p.m, locale);
      case "MM":
        return pad(p.m);
      case "DD":
        return pad(p.d);
      case "HH":
        return pad(p.hh);
      case "mm":
        return pad(p.mm);
      default:
        return pad(p.ss);
    }
  });
}

export function titlecase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-_/(])(\p{L})/gu, (_, sep: string, ch: string) => {
    return sep + ch.toUpperCase();
  });
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}

function applyOne(
  value: unknown,
  spec: string,
  locale: string,
  timeZone: string | undefined,
): unknown {
  const colon = spec.indexOf(":");
  const name = (colon < 0 ? spec : spec.slice(0, colon)).trim();
  const arg = colon < 0 ? "" : spec.slice(colon + 1);
  switch (name) {
    case "titlecase":
      return typeof value === "string" ? titlecase(value) : value;
    case "truncate": {
      const n = Number(arg);
      if (typeof value !== "string" || !Number.isInteger(n) || n < 1) return value;
      return truncate(value, n);
    }
    case "date_format":
      return arg ? formatDatePattern(value, arg, locale, timeZone) : value;
    default:
      return value;
  }
}

/** `timeZone`: the zone a `datetime` value is shown in; a `date` value passes none. */
export function applyTransforms(
  value: unknown,
  spec: TransformSpec,
  locale = "en",
  timeZone?: string,
): unknown {
  if (spec === undefined) return value;
  const steps = typeof spec === "string" ? [spec] : spec;
  return steps.reduce((v, s) => applyOne(v, s, locale, timeZone), value);
}

export function hasTransforms(spec: TransformSpec): boolean {
  return spec !== undefined && spec.length > 0;
}
