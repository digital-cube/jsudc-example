import { z } from "zod";
import type { SchemaDoc } from "./schema.js";

const Field = z.string().min(1);

export const CHART_TYPES = ["line", "area", "bar", "pie"] as const;
export const ChartTypeSchema = z.enum(CHART_TYPES);
export type ChartType = z.infer<typeof ChartTypeSchema>;

/** `line`, `area` and `bar` draw series over an x axis; `pie` draws slices. */
export function isCartesian(type: ChartType): boolean {
  return type !== "pie";
}

/**
 * A window preset: `Nh` is the last N hours ending now, `Nd` the last N days
 * of the calendar, today included, ending at the end of today (both in the
 * viewer's zone, which the browser resolves into absolute instants).
 */
export const WINDOW_PRESET_RE = /^([1-9]\d{0,3})([hd])$/;
export const WindowPresetSchema = z
  .string()
  .regex(WINDOW_PRESET_RE, "a window preset is a count of hours or days: 1h, 24h, 7d, 30d");

/** `{n, unit}` of a preset name, or `null` for anything else. */
export function parseWindowPreset(name: unknown): { n: number; unit: "h" | "d" } | null {
  if (typeof name !== "string") return null;
  const m = WINDOW_PRESET_RE.exec(name);
  return m ? { n: Number(m[1]), unit: m[2] as "h" | "d" } : null;
}

/** How a series reads a bucket of rows when the chart draws fewer points than there are rows. */
export const SeriesAggSchema = z.enum(["mean", "max", "sum"]);
export type SeriesAgg = z.infer<typeof SeriesAggSchema>;

export const ChartSeriesSchema = z.looseObject({
  /** A number field of the schema. */
  field: Field,
  label: z.string().optional(),
  /** Any CSS colour; without one the series takes the next colour of the palette. */
  color: z.string().min(1).optional(),
  axis: z.enum(["left", "right"]).default("left"),
  /** Series with the same `stack` name are stacked (area and bar). */
  stack: z.string().min(1).optional(),
  agg: SeriesAggSchema.default("mean"),
});
export type ChartSeries = z.output<typeof ChartSeriesSchema>;

export const ChartWindowSchema = z
  .looseObject({
    /** A `datetime` field: the window is a `between` on it. */
    field: Field,
    presets: z.array(WindowPresetSchema).min(1).default(["1h", "6h", "24h", "7d", "30d"]),
    default: WindowPresetSchema.default("24h"),
    /** A from / to pair next to the presets. */
    allow_custom: z.boolean().default(true),
  })
  .superRefine((w, ctx) => {
    if (!w.presets.includes(w.default)) {
      ctx.addIssue({
        code: "custom",
        path: ["default"],
        message: `default ${w.default} must be one of presets`,
      });
    }
  });
export type ChartWindow = z.output<typeof ChartWindowSchema>;

export const AXIS_FORMATS = ["number_format", "percent", "bytes"] as const;
export const AxisFormatSchema = z.enum(AXIS_FORMATS);
export type AxisFormat = z.infer<typeof AxisFormatSchema>;

export const YAxisSideSchema = z.looseObject({
  /** `zero` keeps 0 on the axis; `data` frames the drawn values' min → max. */
  baseline: z.enum(["zero", "data"]).default("zero"),
  /** How the tick labels read; `percent` takes the value as a percentage (67 → 67 %). */
  format: AxisFormatSchema.optional(),
});
export type YAxisSide = z.output<typeof YAxisSideSchema>;

// Loose, as every view block: a dclabs `chart_options` carries keys jsudc does
// not read (chart_type, stacked, height, y_baseline) and must still parse.
// Every key declared here is one the chart renderer reads.
export const ChartOptionsSchema = z
  .looseObject({
    type: ChartTypeSchema.default("line"),
    /** The x axis: a time axis over a `datetime` / `date` field, a category axis otherwise. */
    x_field: Field.optional(),
    series: z.array(ChartSeriesSchema).default([]),
    /** Pie: what names a slice. */
    category_field: Field.optional(),
    /** Pie: the number a slice is as big as. */
    value_field: Field.optional(),
    /** Pie: the biggest slices drawn; the rest is folded into one "Other". */
    max_slices: z.number().int().min(1).max(50).default(12),
    window: ChartWindowSchema.optional(),
    y_axis: z
      .looseObject({
        left: YAxisSideSchema.default({ baseline: "zero" }),
        right: YAxisSideSchema.default({ baseline: "zero" }),
      })
      .default({ left: { baseline: "zero" }, right: { baseline: "zero" } }),
    legend: z.boolean().default(true),
    height_px: z.number().int().min(120).max(2000).default(360),
    /** The most rows the chart reads (pages of the list, as the other all-rows renderers). */
    max_rows: z.number().int().min(1).max(50_000).default(5000),
    /** The empty state's text when the window holds no rows. */
    empty_label: z.string().optional(),
  })
  .superRefine((o, ctx) => {
    if (o.type === "pie") {
      for (const key of ["category_field", "value_field"] as const) {
        if (!o[key]) {
          ctx.addIssue({ code: "custom", path: [key], message: `a pie needs ${key}` });
        }
      }
      return;
    }
    if (!o.x_field) {
      ctx.addIssue({
        code: "custom",
        path: ["x_field"],
        message: `a ${o.type} chart needs x_field`,
      });
    }
    if (o.series.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["series"],
        message: `a ${o.type} chart needs at least one series`,
      });
    }
    const fields = o.series.map((s) => s.field);
    fields.forEach((f, i) => {
      if (fields.indexOf(f) !== i) {
        ctx.addIssue({ code: "custom", path: ["series", i, "field"], message: `duplicate ${f}` });
      }
    });
  });

export type ChartOptionsInput = z.input<typeof ChartOptionsSchema>;
export type ChartOptions = z.output<typeof ChartOptionsSchema>;

const NUMBER_TYPES = new Set(["integer", "decimal", "year", "rating"]);
const TIME_TYPES = new Set(["datetime", "date"]);

/** `time` when the chart's x field is a `datetime` / `date` field, `category` otherwise. */
export function chartXKind(opts: ChartOptions, schema: SchemaDoc): "time" | "category" {
  const def = opts.x_field ? schema.fields[opts.x_field] : undefined;
  return def && TIME_TYPES.has(def.type) ? "time" : "category";
}

/**
 * What a schema says against a chart block: every field the chart reads must
 * be a live field of the schema, the series and the pie value numbers, the
 * window a `datetime`. Empty when the block fits; the registry refuses a
 * collection otherwise.
 */
export function chartOptionsProblems(opts: ChartOptions, schema: SchemaDoc): string[] {
  const live = (f: string) => {
    const def = schema.fields[f];
    return def && !def.deleted ? def : undefined;
  };
  const problems: string[] = [];
  const need = (key: string, field: string | undefined, types?: Set<string>, what?: string) => {
    if (!field) return;
    const def = live(field);
    if (!def) problems.push(`${key}: ${field} is not a field of the schema`);
    else if (types && !types.has(def.type)) {
      problems.push(`${key}: ${field} is ${def.type}, a chart needs ${what}`);
    }
  };
  if (opts.type === "pie") {
    need("category_field", opts.category_field);
    need("value_field", opts.value_field, NUMBER_TYPES, "a number");
  } else {
    need("x_field", opts.x_field);
    opts.series.forEach((s, i) => {
      need(`series[${i}].field`, s.field, NUMBER_TYPES, "a number");
    });
  }
  if (opts.window) need("window.field", opts.window.field, new Set(["datetime"]), "datetime");
  return problems;
}

// --- what is drawn: shared by the browser and the server's tests ------------------------

/** A finite number from a cell (numbers and numeric strings), else `null`. */
export function toChartNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** The instant (ms) of a cell: an ISO string, a `YYYY-MM-DD` date or epoch milliseconds. */
export function toChartInstant(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v === "") return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

export interface PieSlice {
  /** The category's text; `""` for rows without one. */
  category: string;
  value: number;
  /** The rows the slice sums. */
  count: number;
  /** The folded remainder: every category past `max_slices`. */
  other?: true;
}

/**
 * The slices of a pie: rows summed per category, the categories by value
 * (largest first, ties by name), the first `max_slices` as they are and the
 * rest folded into one `other` slice. A slice must have something to draw:
 * rows without a positive value are left out.
 */
export function foldSlices(
  rows: readonly Record<string, unknown>[],
  category_field: string,
  value_field: string,
  max_slices: number,
): PieSlice[] {
  const byCategory = new Map<string, PieSlice>();
  for (const row of rows) {
    const value = toChartNumber(row[value_field]);
    if (value === null || value <= 0) continue;
    const raw = row[category_field];
    const category = raw === null || raw === undefined ? "" : String(raw);
    const slice = byCategory.get(category);
    if (slice) {
      slice.value += value;
      slice.count += 1;
    } else byCategory.set(category, { category, value, count: 1 });
  }
  const sorted = [...byCategory.values()].sort(
    (a, b) => b.value - a.value || a.category.localeCompare(b.category),
  );
  const keep = Math.max(1, Math.floor(max_slices));
  if (sorted.length <= keep) return sorted;
  const rest = sorted.slice(keep);
  const other: PieSlice = {
    category: "",
    value: rest.reduce((s, x) => s + x.value, 0),
    count: rest.reduce((s, x) => s + x.count, 0),
    other: true,
  };
  return [...sorted.slice(0, keep), other];
}

export interface TimePoint {
  /** The bucket's first instant (ms). */
  t: number;
  /** Per series field: the bucket's value by the series' `agg`, `null` when no row had one. */
  values: Record<string, number | null>;
  /** The rows in the bucket. */
  count: number;
}

/**
 * Rows on a time axis, one point per `bucket` milliseconds (counted from the
 * epoch, so the same rows always fall into the same buckets): every row whose
 * `x_field` is an instant goes into its bucket, and each series reads the
 * bucket by its `agg` (mean by default, `max` for an error count, `sum` for a
 * total). `bucket = 1` merges only the rows of one instant (three hosts
 * reporting at the same quarter hour). Points are sorted by time.
 */
export function bucketByTime(
  rows: readonly Record<string, unknown>[],
  x_field: string,
  bucket: number,
  series: readonly { field: string; agg?: SeriesAgg | undefined }[],
): TimePoint[] {
  const size = Math.max(1, Math.floor(bucket));
  const acc = new Map<number, { count: number; sum: number[]; max: number[]; n: number[] }>();
  for (const row of rows) {
    const at = toChartInstant(row[x_field]);
    if (at === null) continue;
    const t = Math.floor(at / size) * size;
    let b = acc.get(t);
    if (!b) {
      b = {
        count: 0,
        sum: series.map(() => 0),
        max: series.map(() => Number.NEGATIVE_INFINITY),
        n: series.map(() => 0),
      };
      acc.set(t, b);
    }
    b.count += 1;
    series.forEach((s, i) => {
      const v = toChartNumber(row[s.field]);
      if (v === null) return;
      (b.sum[i] as number) += v;
      b.max[i] = Math.max(b.max[i] as number, v);
      (b.n[i] as number) += 1;
    });
  }
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => {
      const values: Record<string, number | null> = {};
      series.forEach((s, i) => {
        const n = b.n[i] as number;
        if (n === 0) values[s.field] = null;
        else if (s.agg === "max") values[s.field] = b.max[i] as number;
        else if (s.agg === "sum") values[s.field] = b.sum[i] as number;
        else values[s.field] = (b.sum[i] as number) / n;
      });
      return { t, values, count: b.count };
    });
}

/** Bucket sizes a reader takes in at a glance, smallest first. */
export const TIME_BUCKETS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  3_600_000,
  2 * 3_600_000,
  3 * 3_600_000,
  6 * 3_600_000,
  12 * 3_600_000,
  86_400_000,
] as const;

/**
 * The bucket for rows spanning `span` ms when at most `maxPoints` fit:
 * `1` (one point per instant) while the distinct instants fit, else the
 * smallest readable bucket that brings the span under `maxPoints`.
 */
export function pickBucket(span: number, distinct: number, maxPoints: number): number {
  if (distinct <= maxPoints || span <= 0) return 1;
  const want = span / maxPoints;
  return TIME_BUCKETS_MS.find((b) => b >= want) ?? Math.ceil(want / 86_400_000) * 86_400_000;
}

// --- the y axis: ported from udc-js chartAxis.ts --------------------------------------
//
// Recharts' own default (`domain=[0,'auto']`, five evenly spaced ticks) frames
// a chart against numbers it invents and does not round: a disk that never
// leaves 67 % gets an axis to 67.5 with ticks at 16.875. `yAxisFrame` takes
// the values one axis draws and answers with a domain and the ticks to label
// it with: the band rounded out to a nice step (1 / 2 / 2.5 / 5 × 10ⁿ);
// `baseline: zero` keeps 0 inside it (a percentage read against a floating
// baseline exaggerates a wiggle into a cliff), `data` frames min → max (a
// magnitude, a temperature). Each axis is framed on its own, per window.

/** Gaps between ticks aimed for (⇒ up to 5 labels). */
const TICK_INTERVALS = 4;
/** A pathological step must not print 10 000 labels. */
const MAX_TICKS = 13;

/** Kill the float noise `0.1 * 3` leaves on a tick. */
function tidy(v: number): number {
  return Number(v.toFixed(10));
}

/** `raw` rounded up to 1, 2, 2.5, 5 or 10 × a power of ten. */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const f = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return tidy(f * mag);
}

export interface AxisFrame {
  domain: [number, number];
  /** Explicit labels; absent leaves the spacing to the chart library. */
  ticks?: number[];
}

/** The domain and ticks of one y axis over the values it draws; `null` with nothing to draw. */
export function yAxisFrame(
  values: readonly number[],
  baseline: "zero" | "data" = "zero",
): AxisFrame | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  let lo = finite.reduce((a, b) => Math.min(a, b));
  let hi = finite.reduce((a, b) => Math.max(a, b));
  const allPositive = lo >= 0;
  if (baseline === "zero") {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo === hi) {
    // One sample, or a flat series on the baseline: a zero-height band draws no line.
    const pad = Math.abs(hi) > 0 ? Math.abs(hi) * 0.1 : 1;
    lo -= pad;
    hi += pad;
    if (allPositive) lo = Math.max(lo, 0);
  }
  const step = niceStep((hi - lo) / TICK_INTERVALS);
  // Float slack, not headroom: a max exactly on a tick stays on it (100 % ⇒ 0–100).
  const eps = step * 1e-9;
  const loT = tidy(Math.floor(lo / step + eps) * step);
  let hiT = tidy(Math.ceil(hi / step - eps) * step);
  if (hiT <= loT) hiT = tidy(loT + step);
  const ticks: number[] = [];
  for (let v = loT; v <= hiT + eps && ticks.length < MAX_TICKS; v = tidy(v + step)) ticks.push(v);
  if (ticks.length >= MAX_TICKS) return { domain: [loT, hiT] };
  return { domain: [loT, hiT], ticks };
}
