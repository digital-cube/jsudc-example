import {
  type AxisFormat,
  type AxisFrame,
  bucketByTime,
  type ChartOptions,
  type ChartSeries,
  pickBucket,
  toChartInstant,
  toChartNumber,
  yAxisFrame,
} from "@jsudc/core";
import { formatBytes } from "../table/cells";
import {
  addDays,
  DAY,
  dayOf,
  HOUR,
  MINUTE,
  startOfDay,
  zonedFormat,
  zonedToInstant,
} from "../time/zoned";

/** The x value of a point: an instant (ms) on a time axis, the category's text otherwise. */
export const X_KEY = "__x";
/** How many rows a point stands for (> 1 when bucketed or merged). */
export const COUNT_KEY = "__count";

export type ChartPoint = Record<string, number | string | null>;

export interface CartesianData {
  points: ChartPoint[];
  /** The time bucket in ms (`1`: one point per instant); `0` on a category axis. */
  bucket: number;
}

/** At most one point per two pixels of plot, and never more than 600. */
export function maxPointsFor(width: number): number {
  return Math.min(600, Math.max(60, Math.floor(width / 2)));
}

/**
 * The points of a line / area / bar chart. On a time axis the rows are
 * bucketed by `bucketByTime` (one point per instant while they fit
 * `maxPoints`, else a readable bucket, each series by its `agg`); on a
 * category axis the rows of one category merge the same way, in the order the
 * categories first appear.
 */
export function cartesianData(
  rows: readonly Record<string, unknown>[],
  opts: ChartOptions,
  xKind: "time" | "category",
  maxPoints: number,
): CartesianData {
  const x = opts.x_field ?? "";
  const series = opts.series;
  if (xKind === "time") {
    const instants = rows.map((r) => toChartInstant(r[x])).filter((t): t is number => t !== null);
    const distinct = new Set(instants).size;
    const span = instants.length
      ? instants.reduce((a, b) => Math.max(a, b)) - instants.reduce((a, b) => Math.min(a, b))
      : 0;
    const bucket = pickBucket(span, distinct, maxPoints);
    const points = bucketByTime(rows, x, bucket, series).map((p) => ({
      [X_KEY]: p.t,
      [COUNT_KEY]: p.count,
      ...p.values,
    }));
    return { points, bucket };
  }
  const byCategory = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const raw = row[x];
    const key = raw === null || raw === undefined ? "" : String(raw);
    const list = byCategory.get(key);
    if (list) list.push(row);
    else byCategory.set(key, [row]);
  }
  const points = [...byCategory.entries()].map(([key, group]) => {
    const point: ChartPoint = { [X_KEY]: key, [COUNT_KEY]: group.length };
    for (const s of series) {
      const values = group.map((r) => toChartNumber(r[s.field])).filter((v) => v !== null);
      point[s.field] = values.length === 0 ? null : aggregate(values, s.agg);
    }
    return point;
  });
  return { points, bucket: 0 };
}

function aggregate(values: number[], agg: ChartSeries["agg"]): number {
  if (agg === "max") return values.reduce((a, b) => Math.max(a, b));
  const sum = values.reduce((a, b) => a + b, 0);
  return agg === "sum" ? sum : sum / values.length;
}

/**
 * The values one y axis draws: every visible series on that side; series of
 * one `stack` (area, bar) count by their per-point sum, which is what the eye
 * sees, positive and negative parts apart.
 */
export function axisValues(
  points: readonly ChartPoint[],
  opts: ChartOptions,
  side: "left" | "right",
  hidden: ReadonlySet<string>,
): number[] {
  const mine = opts.series.filter((s) => s.axis === side && !hidden.has(s.field));
  const stacks = opts.type === "line" ? false : mine.some((s) => s.stack);
  const out: number[] = [];
  for (const p of points) {
    const sums = new Map<string, { up: number; down: number }>();
    for (const s of mine) {
      const v = p[s.field];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (!stacks || !s.stack) {
        out.push(v);
        continue;
      }
      const acc = sums.get(s.stack) ?? { up: 0, down: 0 };
      if (v >= 0) acc.up += v;
      else acc.down += v;
      sums.set(s.stack, acc);
    }
    for (const { up, down } of sums.values()) out.push(up, down);
  }
  return out;
}

/** The sides that have a series; the axis of each, framed on what it draws now. */
export function axisFrames(
  points: readonly ChartPoint[],
  opts: ChartOptions,
  hidden: ReadonlySet<string>,
): Partial<Record<"left" | "right", AxisFrame | null>> {
  const out: Partial<Record<"left" | "right", AxisFrame | null>> = {};
  for (const side of ["left", "right"] as const) {
    if (!opts.series.some((s) => s.axis === side)) continue;
    out[side] = yAxisFrame(axisValues(points, opts, side, hidden), opts.y_axis[side].baseline);
  }
  return out;
}

/** The palette slot of the series at `index` (the configured order, so a colour follows its series). */
export function seriesColor(s: Pick<ChartSeries, "color">, index: number): string {
  return s.color ?? `var(--chart-${(index % CHART_SLOTS) + 1})`;
}

/** `--chart-1` … `--chart-8` in index.css, light and dark. */
export const CHART_SLOTS = 8;

/** A y tick label: `67 %`, `1.2 MB`, or the number in the UI's locale. */
export function formatAxisValue(v: number, format: AxisFormat | undefined, intlLocale: string) {
  if (format === "percent") {
    return new Intl.NumberFormat(intlLocale, { style: "percent", maximumFractionDigits: 1 }).format(
      v / 100,
    );
  }
  if (format === "bytes") return formatBytes(v, intlLocale);
  return new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 2 }).format(v);
}

// --- the time axis ----------------------------------------------------------------------

/** Tick spacings, smallest first: sub-day ones fall on round wall-clock times of the zone. */
const TICK_STEPS = [
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
] as const;

/**
 * Tick instants for `[from, to]` in `timeZone`, at most about `max` of them:
 * the smallest step that fits, on the zone's round wall times (every 3 hours
 * is 00:00, 03:00, … *there*, not in UTC), local midnights for whole days.
 */
export function timeTicks(from: number, to: number, timeZone: string, max = 8): number[] {
  if (!(to > from)) return [from];
  const step = TICK_STEPS.find((s) => (to - from) / s <= max) ?? 7 * DAY;
  const out: number[] = [];
  let day = dayOf(from, timeZone);
  const last = dayOf(to, timeZone);
  for (let n = 0; n < 400; n++, day = addDays(day, 1)) {
    if (step >= DAY) {
      const k = Math.round(step / DAY);
      const t = startOfDay(day, timeZone);
      if (n % k === 0 && t >= from && t <= to) out.push(t);
    } else {
      const minutes = step / MINUTE;
      for (let m = 0; m < 24 * 60; m += minutes) {
        const t = zonedToInstant({ ...day, hh: Math.floor(m / 60), mm: m % 60 }, timeZone);
        if (t >= from && t <= to && out.at(-1) !== t) out.push(t);
      }
    }
    if (day.y === last.y && day.m === last.m && day.d === last.d) break;
  }
  return out;
}

/** A tick label: the wall time (`09:00`), or the day (`27 Oct`) at midnight and for day steps. */
export function formatTimeTick(
  t: number,
  ticks: readonly number[],
  intlLocale: string,
  timeZone: string,
): string {
  const step = ticks.length > 1 ? (ticks[1] as number) - (ticks[0] as number) : DAY;
  const midnight = startOfDay(dayOf(t, timeZone), timeZone) === t;
  if (step >= DAY - HOUR || midnight) {
    return zonedFormat(intlLocale, timeZone, { day: "numeric", month: "short" }).format(t);
  }
  return zonedFormat(intlLocale, timeZone, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(t);
}

/** Bars on a time axis have no band: as wide as the plot allows, 2–8 px. */
export function barSize(plotWidth: number, points: number): number {
  if (points === 0) return 8;
  return Math.max(2, Math.min(8, Math.floor((plotWidth / points) * 0.6)));
}
