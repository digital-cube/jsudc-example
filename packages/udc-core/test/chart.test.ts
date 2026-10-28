import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  bucketByTime,
  ChartOptionsSchema,
  chartOptionsProblems,
  chartXKind,
  foldSlices,
  niceStep,
  parseWindowPreset,
  pickBucket,
  SchemaDocSchema,
  ViewConfigSchema,
  yAxisFrame,
} from "../src/index.js";

const line = { x_field: "ts", series: [{ field: "cpu" }] };

describe("ChartOptions", () => {
  it("fills every default of a line chart", () => {
    expect(ChartOptionsSchema.parse(line)).toEqual({
      type: "line",
      x_field: "ts",
      series: [{ field: "cpu", axis: "left", agg: "mean" }],
      max_slices: 12,
      y_axis: { left: { baseline: "zero" }, right: { baseline: "zero" } },
      legend: true,
      height_px: 360,
      max_rows: 5000,
    });
  });

  it("fills the window's presets, default and custom range", () => {
    expect(ChartOptionsSchema.parse({ ...line, window: { field: "ts" } }).window).toEqual({
      field: "ts",
      presets: ["1h", "6h", "24h", "7d", "30d"],
      default: "24h",
      allow_custom: true,
    });
  });

  it("fills one side of y_axis when the other is given", () => {
    const opts = ChartOptionsSchema.parse({ ...line, y_axis: { right: { baseline: "data" } } });
    expect(opts.y_axis).toEqual({ left: { baseline: "zero" }, right: { baseline: "data" } });
  });

  it.each([
    [{ type: "line", series: [{ field: "cpu" }] }, "x_field"],
    [{ type: "bar", x_field: "ts" }, "series"],
    [{ type: "area", x_field: "ts", series: [{ field: "a" }, { field: "a" }] }, "series"],
    [{ type: "pie", category_field: "name" }, "value_field"],
    [{ type: "pie", value_field: "stars" }, "category_field"],
    [{ ...line, type: "scatter" }, "type"],
    [{ ...line, window: { field: "ts", presets: ["24h"], default: "7d" } }, "window"],
    [{ ...line, window: { field: "ts", presets: ["a week"] } }, "window"],
    [{ ...line, y_axis: { left: { format: "currency" } } }, "y_axis"],
    [{ ...line, series: [{ field: "cpu", axis: "top" }] }, "series"],
    [{ ...line, series: [{ field: "cpu", agg: "median" }] }, "series"],
    [{ ...line, height_px: 10 }, "height_px"],
    [{ ...line, max_rows: 0 }, "max_rows"],
  ])("refuses %j", (block, path) => {
    const res = ChartOptionsSchema.safeParse(block);
    expect(res.success).toBe(false);
    expect(res.error?.issues.map((i) => i.path[0])).toContain(path);
  });

  it("keeps the dclabs keys it does not read", () => {
    const opts = ChartOptionsSchema.parse({ ...line, chart_type: "line", stacked: true });
    expect(opts).toMatchObject({ chart_type: "line", stacked: true });
  });

  it("reads a preset name as hours or days", () => {
    expect(parseWindowPreset("24h")).toEqual({ n: 24, unit: "h" });
    expect(parseWindowPreset("30d")).toEqual({ n: 30, unit: "d" });
    expect(parseWindowPreset("0h")).toBeNull();
    expect(parseWindowPreset("1w")).toBeNull();
    expect(parseWindowPreset(undefined)).toBeNull();
  });

  it("refuses a view that lists chart without chart_options", () => {
    const res = ViewConfigSchema.safeParse({ available_renderers: ["table", "chart"] });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(["chart_options"]);
  });
});

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("expected a chart_options block");
  return v;
}

const viewOf = (name: string) =>
  ViewConfigSchema.parse(
    parse(
      readFileSync(
        new URL(`../../../backend/collections/${name}/view.yaml`, import.meta.url),
        "utf8",
      ),
    ),
  );
const schemaOf = (name: string) =>
  SchemaDocSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(`../../../backend/collections/${name}/schema.json`, import.meta.url),
        "utf8",
      ),
    ),
  );

describe("the backend's chart views", () => {
  it("metrics opens on a dual-axis line chart over a 24h window on ts", () => {
    const view = viewOf("metrics");
    expect(view.default_renderer).toBe("chart");
    expect(view.available_renderers).toEqual(["chart", "table"]);
    const opts = must(view.chart_options);
    expect(opts.type).toBe("line");
    expect(opts.series.map((s) => [s.field, s.axis])).toEqual([
      ["cpu", "left"],
      ["mem", "left"],
      ["load", "right"],
    ]);
    expect(opts.window).toEqual({
      field: "ts",
      presets: ["1h", "6h", "24h", "7d"],
      default: "24h",
      allow_custom: true,
    });
    expect(opts.y_axis).toEqual({
      left: { baseline: "zero", format: "percent" },
      right: { baseline: "data" },
    });
    expect(chartXKind(opts, schemaOf("metrics"))).toBe("time");
    expect(chartOptionsProblems(opts, schemaOf("metrics"))).toEqual([]);
  });

  it("repos has a pie of stars per repository, ten slices", () => {
    const opts = must(viewOf("repos").chart_options);
    expect(opts).toMatchObject({
      type: "pie",
      category_field: "name",
      value_field: "stargazers_count",
      max_slices: 10,
    });
    expect(chartOptionsProblems(opts, schemaOf("repos"))).toEqual([]);
  });

  it("quakes has bars of magnitude over a 7d window on time", () => {
    const view = viewOf("quakes");
    expect(view.available_renderers).toContain("chart");
    const opts = must(view.chart_options);
    expect(opts).toMatchObject({ type: "bar", x_field: "time" });
    expect(opts.series).toEqual([{ field: "mag", axis: "left", agg: "max" }]);
    expect(opts.window).toMatchObject({ field: "time", presets: ["24h", "7d", "30d"] });
    expect(opts.window?.default).toBe("7d");
    expect(opts.y_axis.left.baseline).toBe("data");
    expect(chartOptionsProblems(opts, schemaOf("quakes"))).toEqual([]);
  });
});

describe("chartOptionsProblems", () => {
  const schema = SchemaDocSchema.parse({
    version: "v1",
    fields: {
      ts: { type: "datetime" },
      day: { type: "date" },
      name: { type: "string" },
      stars: { type: "integer" },
      cpu: { type: "decimal" },
      gone: { type: "decimal", deleted: true },
    },
  });
  const problems = (block: Record<string, unknown>) =>
    chartOptionsProblems(ChartOptionsSchema.parse(block), schema);

  it("is empty when every field fits", () => {
    expect(problems({ ...line, window: { field: "ts" } })).toEqual([]);
    expect(problems({ type: "pie", category_field: "name", value_field: "stars" })).toEqual([]);
  });

  it("refuses a series of type string, and names a missing or deleted field", () => {
    expect(problems({ x_field: "ts", series: [{ field: "name" }] })).toEqual([
      "series[0].field: name is string, a chart needs a number",
    ]);
    expect(problems({ x_field: "time", series: [{ field: "gone" }] })).toEqual([
      "x_field: time is not a field of the schema",
      "series[0].field: gone is not a field of the schema",
    ]);
  });

  it("wants a number for the pie's value and a datetime for the window", () => {
    expect(problems({ type: "pie", category_field: "name", value_field: "name" })).toEqual([
      "value_field: name is string, a chart needs a number",
    ]);
    expect(problems({ ...line, window: { field: "day" } })).toEqual([
      "window.field: day is date, a chart needs datetime",
    ]);
  });

  it("reads a datetime or a date x field as time, anything else as categories", () => {
    const kind = (x: string) =>
      chartXKind(ChartOptionsSchema.parse({ ...line, x_field: x }), schema);
    expect(kind("ts")).toBe("time");
    expect(kind("day")).toBe("time");
    expect(kind("name")).toBe("category");
  });
});

describe("foldSlices", () => {
  const rows = [
    { name: "a", stars: 5 },
    { name: "b", stars: 9 },
    { name: "c", stars: 1 },
    { name: "d", stars: 3 },
    { name: "a", stars: 2 },
    { name: "e", stars: 0 },
    { name: "f", stars: null },
    { name: null, stars: 4 },
  ];

  it.each([
    [
      10,
      [
        { category: "b", value: 9, count: 1 },
        { category: "a", value: 7, count: 2 },
        { category: "", value: 4, count: 1 },
        { category: "d", value: 3, count: 1 },
        { category: "c", value: 1, count: 1 },
      ],
    ],
    [
      5,
      [
        { category: "b", value: 9, count: 1 },
        { category: "a", value: 7, count: 2 },
        { category: "", value: 4, count: 1 },
        { category: "d", value: 3, count: 1 },
        { category: "c", value: 1, count: 1 },
      ],
    ],
    [
      2,
      [
        { category: "b", value: 9, count: 1 },
        { category: "a", value: 7, count: 2 },
        { category: "", value: 8, count: 3, other: true },
      ],
    ],
    [
      1,
      [
        { category: "b", value: 9, count: 1 },
        { category: "", value: 15, count: 5, other: true },
      ],
    ],
  ])("max_slices %i", (max, expected) => {
    expect(foldSlices(rows, "name", "stars", max)).toEqual(expected);
  });

  it("orders equal values by name, and reads numeric strings", () => {
    expect(
      foldSlices(
        [
          { k: "y", v: "2" },
          { k: "x", v: 2 },
        ],
        "k",
        "v",
        12,
      ).map((s) => s.category),
    ).toEqual(["x", "y"]);
  });

  it("is empty when nothing has a positive value", () => {
    expect(foldSlices([{ k: "a", v: 0 }], "k", "v", 12)).toEqual([]);
  });
});

describe("bucketByTime", () => {
  const at = (hhmm: string) => `2026-10-27T${hhmm}:00Z`;
  const ms = (hhmm: string) => Date.parse(at(hhmm));
  const rows = [
    { ts: at("10:00"), cpu: 10, errors: 1 },
    { ts: at("10:00"), cpu: 30, errors: 5 },
    { ts: at("10:15"), cpu: 20, errors: 0 },
    { ts: at("10:45"), cpu: null, errors: 2 },
    { ts: at("11:00"), cpu: 50, errors: 3 },
    { ts: "not a time", cpu: 99, errors: 99 },
  ];
  const series = [
    { field: "cpu" },
    { field: "errors", agg: "max" as const },
    { field: "errors_sum", agg: "sum" as const },
  ];
  const withSum = rows.map((r) => ({ ...r, errors_sum: r.errors }));

  it.each([
    [
      "one point per instant",
      1,
      [
        { t: ms("10:00"), values: { cpu: 20, errors: 5, errors_sum: 6 }, count: 2 },
        { t: ms("10:15"), values: { cpu: 20, errors: 0, errors_sum: 0 }, count: 1 },
        { t: ms("10:45"), values: { cpu: null, errors: 2, errors_sum: 2 }, count: 1 },
        { t: ms("11:00"), values: { cpu: 50, errors: 3, errors_sum: 3 }, count: 1 },
      ],
    ],
    [
      "half-hour buckets",
      30 * 60_000,
      [
        { t: ms("10:00"), values: { cpu: 20, errors: 5, errors_sum: 6 }, count: 3 },
        { t: ms("10:30"), values: { cpu: null, errors: 2, errors_sum: 2 }, count: 1 },
        { t: ms("11:00"), values: { cpu: 50, errors: 3, errors_sum: 3 }, count: 1 },
      ],
    ],
    [
      "hourly buckets",
      3_600_000,
      [
        { t: ms("10:00"), values: { cpu: 20, errors: 5, errors_sum: 8 }, count: 4 },
        { t: ms("11:00"), values: { cpu: 50, errors: 3, errors_sum: 3 }, count: 1 },
      ],
    ],
  ])("%s", (_, bucket, expected) => {
    expect(bucketByTime(withSum, "ts", bucket, series)).toEqual(expected);
  });

  it("sorts by time whatever the rows' order, and reads epoch milliseconds", () => {
    const got = bucketByTime(
      [
        { t: ms("11:00"), v: 1 },
        { t: ms("09:00"), v: 2 },
      ],
      "t",
      1,
      [{ field: "v" }],
    );
    expect(got.map((p) => p.t)).toEqual([ms("09:00"), ms("11:00")]);
  });

  it("picks one point per instant while they fit, else a readable bucket", () => {
    const day = 86_400_000;
    expect(pickBucket(day, 96, 600)).toBe(1);
    // 7 days of quarter hours: 672 instants do not fit 600 points, half hours do.
    expect(pickBucket(7 * day, 672, 600)).toBe(30 * 60_000);
    expect(pickBucket(30 * day, 2880, 300)).toBe(3 * 3_600_000);
    expect(pickBucket(0, 1000, 10)).toBe(1);
  });
});

// The udc-js chartAxis cases, ported.
describe("niceStep", () => {
  it("rounds up to 1 / 2 / 2.5 / 5 × a power of ten", () => {
    expect(niceStep(0.9)).toBe(1);
    expect(niceStep(1.7)).toBe(2);
    expect(niceStep(2.4)).toBe(2.5);
    expect(niceStep(4)).toBe(5);
    expect(niceStep(16.875)).toBe(20);
    expect(niceStep(0.12)).toBe(0.2);
  });

  it("survives a degenerate range instead of returning 0 or NaN", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-3)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });
});

describe("yAxisFrame", () => {
  it("returns null when the axis has nothing to draw", () => {
    expect(yAxisFrame([])).toBeNull();
    expect(yAxisFrame([Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
  });

  it("keeps zero on the axis and rounds a flat 67 % series to round ticks", () => {
    expect(yAxisFrame([67.5, 67.4, 47.1, 52])).toEqual({
      domain: [0, 80],
      ticks: [0, 20, 40, 60, 80],
    });
    expect(yAxisFrame([67, 67.2, 66.9])).toEqual({ domain: [0, 80], ticks: [0, 20, 40, 60, 80] });
  });

  it("frames the second axis on its own (small) numbers", () => {
    expect(yAxisFrame([1.38, 1.3, 2.2, 1.1])).toEqual({ domain: [0, 3], ticks: [0, 1, 2, 3] });
  });

  it("does not invent headroom above a max that already sits on a tick", () => {
    expect(yAxisFrame([0, 55, 100])).toEqual({ domain: [0, 100], ticks: [0, 25, 50, 75, 100] });
  });

  it("re-frames when the window shows a different slice of the series", () => {
    expect(yAxisFrame([12, 9, 14])?.domain).toEqual([0, 15]);
    expect(yAxisFrame([12, 9, 14, 91])?.domain).toEqual([0, 100]);
  });

  it("frames min → max for baseline: data", () => {
    expect(yAxisFrame([67.5, 67.4, 47.1, 52], "data")).toEqual({
      domain: [40, 70],
      ticks: [40, 50, 60, 70],
    });
    expect(yAxisFrame([4.5, 6.1, 5.2], "data")).toEqual({
      domain: [4.5, 6.5],
      ticks: [4.5, 5, 5.5, 6, 6.5],
    });
  });

  it("gives a flat-on-zero series a band to sit in", () => {
    expect(yAxisFrame([0, 0, 0])).toEqual({ domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1] });
  });

  it("gives a single sample a band around it, never below zero", () => {
    const frame = yAxisFrame([42], "data");
    expect(frame?.domain[0]).toBeGreaterThanOrEqual(0);
    expect(frame?.domain[0]).toBeLessThan(42);
    expect(frame?.domain[1]).toBeGreaterThan(42);
  });

  it("spans both sides of zero when the data does", () => {
    const frame = yAxisFrame([-3, 7]);
    expect(frame?.domain[0]).toBeLessThanOrEqual(-3);
    expect(frame?.domain[1]).toBeGreaterThanOrEqual(7);
    expect(frame?.ticks).toContain(0);
  });

  it("prints ticks free of float noise", () => {
    for (const tick of yAxisFrame([0.7, 0.1])?.ticks ?? []) {
      expect(String(tick).length).toBeLessThan(6);
    }
  });
});
