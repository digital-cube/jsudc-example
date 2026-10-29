import {
  type ChartOptionsInput,
  ChartOptionsSchema,
  type DescribeResponse,
  type Row,
  SchemaDocSchema,
  ViewConfigSchema,
} from "@jsudc/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { ChartView } from "../src/chart/ChartRenderer";
import {
  axisFrames,
  axisValues,
  barSize,
  cartesianData,
  formatAxisValue,
  formatTimeTick,
  maxPointsFor,
  seriesColor,
  timeTicks,
} from "../src/chart/model";
import { type ChartWindowState, useChartWindow } from "../src/chart/useChartWindow";
import {
  andWindow,
  parseWall,
  readWindow,
  wallOf,
  windowCondition,
  windowRange,
  writeWindow,
} from "../src/chart/window";
import { UdcI18nProvider } from "../src/i18n/i18n";
import { rendererEntry } from "../src/renderers/registry";
import { TimezoneProvider, useTimezone } from "../src/time/timezone";
import { row } from "./fetchMock";

const BG = "Europe/Belgrade";
const TOKYO = "Asia/Tokyo";
/** The e2e clock: noon of 2026-10-27 in Belgrade (winter time, UTC+1). */
const NOW = Date.parse("2026-10-27T11:00:00Z");

const win = (block: Record<string, unknown> = {}) =>
  ChartOptionsSchema.parse({
    x_field: "ts",
    series: [{ field: "cpu" }],
    window: { field: "ts", ...block },
  }).window as NonNullable<ReturnType<typeof ChartOptionsSchema.parse>["window"]>;

describe("the registry", () => {
  it("has the chart tab: no paging, no edit mode", () => {
    expect(rendererEntry("chart")).toMatchObject({
      labelKey: "TAB_CHART",
      paging: false,
      editMode: false,
    });
  });
});

describe("window → between", () => {
  const between = (preset: string, zone: string) =>
    windowCondition("ts", { kind: "preset", preset }, NOW, zone);

  it.each([
    ["1h", BG, ["2026-10-27T11:00:00.000+01:00", "2026-10-27T12:00:00.000+01:00"]],
    ["6h", BG, ["2026-10-27T06:00:00.000+01:00", "2026-10-27T12:00:00.000+01:00"]],
    ["24h", BG, ["2026-10-26T12:00:00.000+01:00", "2026-10-27T12:00:00.000+01:00"]],
    ["24h", TOKYO, ["2026-10-26T20:00:00.000+09:00", "2026-10-27T20:00:00.000+09:00"]],
    // Days are the zone's calendar days: Belgrade is still on summer time on the 21st.
    ["7d", BG, ["2026-10-21T00:00:00.000+02:00", "2026-10-27T23:59:59.999+01:00"]],
    ["7d", TOKYO, ["2026-10-21T00:00:00.000+09:00", "2026-10-27T23:59:59.999+09:00"]],
    ["30d", BG, ["2026-09-28T00:00:00.000+02:00", "2026-10-27T23:59:59.999+01:00"]],
  ])("%s in %s", (preset, zone, value) => {
    expect(between(preset, zone)).toEqual({ field: "ts", op: "between", value });
  });

  it("hours are the same instants in every zone, days are not", () => {
    const instants = (preset: string, zone: string) =>
      windowRange({ kind: "preset", preset }, NOW, zone);
    expect(instants("24h", TOKYO)).toEqual(instants("24h", BG));
    const [tokyo] = instants("7d", TOKYO);
    const [belgrade] = instants("7d", BG);
    expect((belgrade ?? 0) - (tokyo ?? 0)).toBe(7 * 3_600_000);
  });

  it("ends an hour preset at now, to the minute", () => {
    const [, to] = windowRange({ kind: "preset", preset: "1h" }, NOW + 59_999, BG);
    expect(to).toBe(NOW);
  });

  it("reads a custom range as wall times in the zone; a missing side leaves it open", () => {
    const custom = (from: string | null, to: string | null, zone: string) =>
      windowCondition("ts", { kind: "custom", from, to }, NOW, zone);
    expect(custom("2026-10-26T08:00", "2026-10-26T18:30", BG)).toEqual({
      field: "ts",
      op: "between",
      value: ["2026-10-26T08:00:00.000+01:00", "2026-10-26T18:30:59.999+01:00"],
    });
    expect(custom("2026-10-26T08:00", null, TOKYO)).toEqual({
      field: "ts",
      op: "gte",
      value: "2026-10-26T08:00:00.000+09:00",
    });
    expect(custom(null, "2026-10-26T08:00", BG)).toMatchObject({ op: "lte" });
    expect(custom(null, null, BG)).toBeUndefined();
  });

  it("is ANDed with the data view's filter", () => {
    const cond = between("24h", BG);
    const chip = { field: "host", op: "in" as const, value: ["db-1"] };
    expect(andWindow(chip, cond)).toEqual({ and: [chip, cond] });
    expect(andWindow(undefined, cond)).toBe(cond);
    expect(andWindow(chip, undefined)).toBe(chip);
  });
});

function Probe({
  onState,
}: {
  onState: (w: ChartWindowState | null, set: (z: string) => void) => void;
}) {
  const view = ViewConfigSchema.parse({
    available_renderers: ["chart"],
    chart_options: { x_field: "ts", series: [{ field: "cpu" }], window: { field: "ts" } },
  });
  const w = useChartWindow(view);
  const { setTimeZone } = useTimezone();
  const loc = useLocation();
  onState(w, setTimeZone);
  return <output data-testid="search">{loc.search}</output>;
}

describe("the window in the URL", () => {
  const cfg = win({ presets: ["1h", "6h", "24h", "7d"], default: "24h" });
  const read = (q: string, c = cfg) => readWindow(new URLSearchParams(q), c);

  it("falls back to the default preset, not explicit", () => {
    expect(read("")).toEqual({ sel: { kind: "preset", preset: "24h" }, explicit: false });
    expect(read("win=30d")).toEqual({ sel: { kind: "preset", preset: "24h" }, explicit: false });
  });

  it("round-trips ?win=", () => {
    const params = writeWindow(new URLSearchParams("tab=chart"), { kind: "preset", preset: "7d" });
    expect(params.toString()).toBe("tab=chart&win=7d");
    expect(read(params.toString())).toEqual({
      sel: { kind: "preset", preset: "7d" },
      explicit: true,
    });
  });

  it("round-trips ?from=&to=, replacing ?win=", () => {
    const params = writeWindow(new URLSearchParams("win=7d"), {
      kind: "custom",
      from: "2026-10-20T08:00",
      to: "2026-10-22T17:30",
    });
    expect(params.toString()).toBe("from=2026-10-20T08%3A00&to=2026-10-22T17%3A30");
    expect(read(params.toString())).toEqual({
      sel: { kind: "custom", from: "2026-10-20T08:00", to: "2026-10-22T17:30" },
      explicit: true,
    });
    expect(writeWindow(params, null).toString()).toBe("");
  });

  it("ignores a malformed wall time, and a custom range the view does not allow", () => {
    expect(read("from=yesterday&win=6h").sel).toEqual({ kind: "preset", preset: "6h" });
    expect(read("from=2026-10-20T08:00", win({ allow_custom: false })).sel).toEqual({
      kind: "preset",
      preset: "24h",
    });
    expect(parseWall("2026-13-01T08:00")).toBeNull();
    expect(wallOf(NOW, TOKYO)).toBe("2026-10-27T20:00");
  });

  it("useChartWindow writes the URL, and the zone changes the condition", () => {
    let state: ChartWindowState | null = null;
    let setZone: (z: string) => void = () => {};
    render(
      <TimezoneProvider>
        <MemoryRouter initialEntries={["/udc/metrics?tab=chart"]}>
          <Probe
            onState={(w, set) => {
              state = w;
              setZone = set;
            }}
          />
        </MemoryRouter>
      </TimezoneProvider>,
    );
    const current = () => state as unknown as ChartWindowState;
    expect(current().explicit).toBe(false);
    act(() => current().setSel({ kind: "preset", preset: "7d" }));
    expect(screen.getByTestId("search").textContent).toBe("?tab=chart&win=7d");
    expect(current().explicit).toBe(true);
    act(() => setZone(BG));
    const belgrade = JSON.stringify(current().cond);
    act(() => setZone(TOKYO));
    expect(JSON.stringify(current().cond)).not.toBe(belgrade);
    expect(JSON.stringify(current().cond)).toContain("+09:00");
    act(() => current().clear());
    expect(screen.getByTestId("search").textContent).toBe("?tab=chart");
  });
});

// --- the drawing ------------------------------------------------------------------------

const metricsSchema = SchemaDocSchema.parse({
  version: "v1",
  fields: {
    ts: { type: "datetime" },
    host: { type: "enum", values: ["web-1", "web-2", "db-1"] },
    cpu: { type: "decimal" },
    mem: { type: "decimal" },
    load: { type: "decimal" },
    errors: { type: "integer" },
  },
});

const metricsOpts: ChartOptionsInput = {
  type: "line",
  x_field: "ts",
  series: [
    { field: "cpu", axis: "left" },
    { field: "mem", axis: "left" },
    { field: "load", axis: "right", color: "var(--chart-7)" },
  ],
  y_axis: { left: { baseline: "zero", format: "percent" }, right: { baseline: "data" } },
};

function describeOf(chart: ChartOptionsInput, schema = metricsSchema): DescribeResponse {
  return {
    collection: "metrics",
    capabilities: {
      mutate: false,
      subscribe: false,
      total_count: true,
      schema_edit: false,
      config_edit: false,
      reindex: false,
      tree_reparent: false,
      source_yaml: false,
      supported_filter_ops: [],
    },
    schema,
    view: ViewConfigSchema.parse({
      available_renderers: ["chart", "table"],
      chart_options: chart,
      columns: [{ field: "cpu", render: "number_format", render_options: { decimals: 1 } }],
    }),
    filterable: { fields: [] },
    source_kind: "postgres_jsonb",
  };
}

/** Four quarter hours, two hosts each. */
const metricRows: Row[] = ["10:00", "10:15", "10:30", "10:45"].flatMap((hhmm, i) => [
  row(`a${i}`, 1, {
    ts: `2026-10-27T${hhmm}:00Z`,
    host: "web-1",
    cpu: 60 + i,
    mem: 40,
    load: 1.2 + i * 0.1,
  }),
  row(`b${i}`, 1, { ts: `2026-10-27T${hhmm}:00Z`, host: "db-1", cpu: 70 + i, mem: 74, load: 2 }),
]);

function renderChart(chart: ChartOptionsInput, rows: Row[], schema = metricsSchema) {
  const d = describeOf(chart, schema);
  const opts = d.view.chart_options;
  if (!opts) throw new Error("chart_options");
  return render(
    <UdcI18nProvider>
      <ChartView collection="metrics" describe={d} rows={rows} opts={opts} timeZone={BG} />
    </UdcI18nProvider>,
  );
}

describe("cartesian points and axes", () => {
  const opts = ChartOptionsSchema.parse(metricsOpts);

  it("merges the hosts of one instant into one point, by mean", () => {
    const { points, bucket } = cartesianData(metricRows, opts, "time", 600);
    expect(bucket).toBe(1);
    expect(points).toHaveLength(4);
    expect(points[0]).toMatchObject({ cpu: 65, mem: 57, load: 1.6, __count: 2 });
  });

  it("buckets when the instants exceed the points the width can draw", () => {
    expect(maxPointsFor(400)).toBe(200);
    expect(maxPointsFor(5000)).toBe(600);
    const { points, bucket } = cartesianData(metricRows, opts, "time", 2);
    expect(bucket).toBe(30 * 60_000);
    expect(points.map((p) => p.__count)).toEqual([4, 4]);
  });

  it("frames each side on its own values, and on what is visible", () => {
    const { points } = cartesianData(metricRows, opts, "time", 600);
    expect(axisFrames(points, opts, new Set())).toEqual({
      left: { domain: [0, 80], ticks: [0, 20, 40, 60, 80] },
      right: { domain: [1.6, 1.75], ticks: [1.6, 1.65, 1.7, 1.75] },
    });
    // mem hidden: the left axis frames cpu alone (65–68, still from zero).
    expect(axisValues(points, opts, "left", new Set(["mem"]))).toEqual([65, 66, 67, 68]);
  });

  it("stacks series of one stack by their sum", () => {
    const stacked = ChartOptionsSchema.parse({
      type: "bar",
      x_field: "ts",
      series: [
        { field: "a", stack: "s" },
        { field: "b", stack: "s" },
      ],
    });
    expect(axisValues([{ __x: 1, a: 2, b: 3 }], stacked, "left", new Set())).toEqual([5, 0]);
  });

  it("formats y ticks as percent, bytes or numbers", () => {
    expect(formatAxisValue(67, "percent", "en-US")).toBe("67%");
    expect(formatAxisValue(2048, "bytes", "en-US")).toMatch(/2(\.0)? KB/);
    expect(formatAxisValue(1.25, undefined, "en-US")).toBe("1.25");
  });

  it("colours a series by its place in the options, or its own colour", () => {
    expect(seriesColor({}, 0)).toBe("var(--chart-1)");
    expect(seriesColor({}, 9)).toBe("var(--chart-2)");
    expect(seriesColor({ color: "#123456" }, 0)).toBe("#123456");
    expect(barSize(1000, 10)).toBe(8);
    expect(barSize(100, 100)).toBe(2);
  });

  it("puts time ticks on the zone's round hours, and labels them there", () => {
    const from = Date.parse("2026-10-26T11:00:00Z");
    const to = NOW;
    const bg = timeTicks(from, to, BG, 8);
    const tokyo = timeTicks(from, to, TOKYO, 8);
    const label = (ticks: number[], zone: string) =>
      ticks.map((t) => formatTimeTick(t, ticks, "en-GB", zone));
    expect(label(bg, BG)).toEqual([
      "12:00",
      "15:00",
      "18:00",
      "21:00",
      "27 Oct",
      "03:00",
      "06:00",
      "09:00",
      "12:00",
    ]);
    expect(label(tokyo, TOKYO)).toEqual([
      "21:00",
      "27 Oct",
      "03:00",
      "06:00",
      "09:00",
      "12:00",
      "15:00",
      "18:00",
    ]);
    // A week: one tick per local midnight.
    const week = timeTicks(Date.parse("2026-10-20T22:00:00Z"), NOW, BG, 8);
    expect(label(week, BG)).toEqual([
      "21 Oct",
      "22 Oct",
      "23 Oct",
      "24 Oct",
      "25 Oct",
      "26 Oct",
      "27 Oct",
    ]);
  });
});

describe("<ChartView>", () => {
  it("draws two lines on the left axis and one on the right, framed per side", () => {
    renderChart(metricsOpts, metricRows);
    const chart = screen.getByTestId("chart");
    expect(chart).toHaveAttribute("data-type", "line");
    expect(chart).toHaveAttribute("data-points", "4");
    expect(chart).toHaveAttribute("data-left-domain", "0,80");
    expect(chart).toHaveAttribute("data-right-domain", "1.6,1.75");
    expect(screen.getAllByTestId("chart-legend-item").map((b) => b.dataset.field)).toEqual([
      "cpu",
      "mem",
      "load",
    ]);
  });

  it("toggles a series from the legend, re-framing its axis", () => {
    renderChart(metricsOpts, metricRows);
    const mem = screen.getAllByTestId("chart-legend-item")[1] as HTMLElement;
    fireEvent.click(mem);
    expect(mem).toHaveAttribute("data-hidden", "true");
    expect(mem).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("chart")).toHaveAttribute("data-left-domain", "0,80");
    const load = screen.getAllByTestId("chart-legend-item")[2] as HTMLElement;
    fireEvent.click(load);
    // Nothing visible on the right: no frame to report.
    expect(screen.getByTestId("chart")).not.toHaveAttribute("data-right-domain");
    fireEvent.click(load);
    expect(load).toHaveAttribute("data-hidden", "false");
    expect(screen.getByTestId("chart")).toHaveAttribute("data-right-domain", "1.6,1.75");
  });

  it("folds a pie past max_slices into Other", () => {
    const schema = SchemaDocSchema.parse({
      version: "v1",
      fields: { name: { type: "string" }, stars: { type: "integer" } },
    });
    const rows = Array.from({ length: 14 }, (_, i) =>
      row(`r${i}`, 1, { name: `repo-${i}`, stars: 14 - i }),
    );
    rows.push(row("zero", 1, { name: "none", stars: 0 }));
    renderChart(
      { type: "pie", category_field: "name", value_field: "stars", max_slices: 10 },
      rows,
      schema,
    );
    const chart = screen.getByTestId("chart");
    expect(chart).toHaveAttribute("data-slices", "11");
    expect(chart).toHaveAttribute("data-other", "true");
    const legend = screen.getAllByTestId("chart-legend-item").map((li) => li.textContent);
    expect(legend[0]).toMatch(/^repo-0/);
    // 4 + 3 + 2 + 1 of 105 stars.
    expect(legend.at(-1)).toBe("Other9.5%");
    expect(legend).not.toContain(expect.stringMatching(/^none/));
  });

  it("shows no legend box for a single series", () => {
    renderChart({ type: "bar", x_field: "ts", series: [{ field: "cpu" }] }, metricRows);
    expect(screen.getByTestId("chart")).toHaveAttribute("data-type", "bar");
    expect(screen.queryByTestId("chart-legend")).toBeNull();
  });
});
