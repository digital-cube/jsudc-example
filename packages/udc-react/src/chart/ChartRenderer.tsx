import {
  type ChartOptions,
  type ColumnConfig,
  chartXKind,
  type DescribeResponse,
  foldSlices,
  type PieSlice,
  type Row,
} from "@jsudc/core";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  type BarShapeProps,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  type PieLabelRenderProps,
  Rectangle,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "../components/ui/misc";
import { tableSection, useI18n } from "../i18n/i18n";
import { cn, humanize } from "../lib/utils";
import { AllRowsStatus } from "../renderers/AllRowsStatus";
import type { RendererProps } from "../renderers/types";
import { CellValue } from "../table/cells";
import { EmptyState, ErrorState } from "../table/states";
import { isoInZone } from "../time/zoned";
import { useUdcAllRows, useUdcCollection } from "../udc/hooks";
import {
  axisFrames,
  barSize,
  CHART_SLOTS,
  type ChartPoint,
  COUNT_KEY,
  cartesianData,
  formatAxisValue,
  formatTimeTick,
  maxPointsFor,
  seriesColor,
  timeTicks,
  X_KEY,
} from "./model";

/** The `chart` tab: the rows of the filter (and the window) drawn as `chart_options` says. */
export function ChartRenderer(props: RendererProps) {
  const opts = props.describe.view.chart_options;
  const { t } = useI18n();
  if (!opts) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground" data-testid="chart-missing">
        {t("APP", "CHART_NO_OPTIONS")}
      </div>
    );
  }
  return <ChartTab {...props} opts={opts} />;
}

function ChartTab({
  collection,
  describe,
  filter,
  unwindowedFilter,
  chartWindow,
  filtered,
  onClearFilters,
  onCount,
  opts,
}: RendererProps & { opts: ChartOptions }) {
  const { schema, capabilities, view } = describe;
  const xKind = chartXKind(opts, schema);
  // Pages in x order, so a cut by max_rows keeps the start of the window; a pie keeps its biggest.
  const sort =
    opts.type === "pie"
      ? [{ field: opts.value_field ?? "", dir: "desc" as const }]
      : xKind === "time" && opts.x_field
        ? [{ field: opts.x_field }]
        : [];
  const q = useUdcAllRows({
    collection,
    filter,
    sort,
    capabilities,
    max: opts.max_rows,
    refetchInterval: view.refresh_interval_ms,
  });
  // "N points in window of M": M counts the filter without the window (one row asked for).
  const outside = useUdcCollection({
    collection,
    filter: unwindowedFilter,
    mode: "pages",
    pageLimit: 1,
    enabled: chartWindow !== undefined,
    capabilities,
  });

  const windowed = chartWindow !== undefined;
  const windowTotal = windowed ? outside.total : null;
  useEffect(() => {
    if (q.total === null) {
      onCount(null);
      return;
    }
    onCount({
      shown: q.total,
      total: windowTotal ?? q.total,
      ...(windowed ? { unit: "chart" as const } : {}),
      fetchedAt: q.fetchedAt,
      stale: q.stale,
    });
  }, [onCount, q.total, windowTotal, windowed, q.fetchedAt, q.stale]);
  useEffect(() => () => onCount(null), [onCount]);

  if (q.error && q.rows.length === 0) {
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  }
  const firstLoad = q.isLoading && q.rows.length === 0;
  const empty = !firstLoad && !q.isFetching && q.rows.length === 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="chart-tab">
      <AllRowsStatus result={q} />
      {firstLoad ? (
        <div className="p-6">
          <Skeleton
            className="w-full"
            style={{ height: opts.height_px }}
            data-testid="chart-loading"
          />
        </div>
      ) : empty ? (
        <EmptyState filtered={filtered} onClear={onClearFilters} body={opts.empty_label} />
      ) : (
        <ChartView
          collection={collection}
          describe={describe}
          rows={q.rows}
          opts={opts}
          range={chartWindow?.range}
          timeZone={chartWindow?.timeZone}
        />
      )}
    </div>
  );
}

/** The width of an element, followed as it resizes (jsdom has no layout: 720 there). */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.floor(w));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, width > 0 ? width : 720];
}

const MARGIN = { top: 12, right: 12, bottom: 4, left: 4 };
const Y_AXIS_WIDTH = 56;
const AXIS_TICK = { fontSize: 11, fill: "var(--muted-foreground)" };

export interface ChartViewProps {
  collection: string;
  describe: DescribeResponse;
  rows: readonly Row[];
  opts: ChartOptions;
  /** The window, when there is one: the time axis spans it. */
  range?: [number | null, number | null] | undefined;
  /** The header's zone (the time axis and the tooltip read in it); the browser's without one. */
  timeZone?: string | undefined;
}

/** The chart over rows already loaded: cartesian or pie. Exported for the unit tests. */
export function ChartView(props: ChartViewProps) {
  return props.opts.type === "pie" ? <PieView {...props} /> : <CartesianView {...props} />;
}

/** `view.columns`' block for `field`, or a bare one: tooltips format as the table does. */
function columnOf(describe: DescribeResponse, field: string): ColumnConfig {
  return describe.view.columns.find((c) => c.field === field) ?? { field };
}

function useFieldLabel(collection: string) {
  const { tMaybe } = useI18n();
  const section = tableSection(collection);
  return (field: string, label?: string) => tMaybe(section, field) ?? label ?? humanize(field);
}

function CartesianView({ collection, describe, rows, opts, range, timeZone }: ChartViewProps) {
  const { intlLocale } = useI18n();
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const fieldLabel = useFieldLabel(collection);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const xKind = chartXKind(opts, describe.schema);
  const sides = (["left", "right"] as const).filter((side) =>
    opts.series.some((s) => s.axis === side),
  );
  const plotWidth = width - MARGIN.left - MARGIN.right - sides.length * Y_AXIS_WIDTH;
  const { points, bucket } = useMemo(
    () => cartesianData(rows, opts, xKind, maxPointsFor(plotWidth)),
    [rows, opts, xKind, plotWidth],
  );
  const frames = axisFrames(points, opts, hidden);

  // The time axis spans the window when there is one, else the rows.
  const xs = points.map((p) => p[X_KEY]).filter((x): x is number => typeof x === "number");
  const from = range?.[0] ?? (xs.length ? Math.min(...xs) : 0);
  const to = range?.[1] ?? (xs.length ? Math.max(...xs) : 0);
  const ticks =
    xKind === "time" ? timeTicks(from, to, zone, Math.max(3, Math.floor(plotWidth / 110))) : [];

  const toggle = (field: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (!next.delete(field)) next.add(field);
      return next;
    });

  const timeBar = barSize(plotWidth, points.length);
  const series = opts.series.map((s, i) => {
    const common = {
      dataKey: s.field,
      name: fieldLabel(s.field, s.label),
      yAxisId: s.axis,
      hide: hidden.has(s.field),
      isAnimationActive: false,
    };
    const color = seriesColor(s, i);
    if (opts.type === "bar") {
      return (
        <Bar
          key={s.field}
          {...common}
          fill={color}
          stackId={s.stack}
          radius={s.stack ? 0 : [2, 2, 0, 0]}
          // A number axis has no bands: recharts sizes a bar by the closest two instants (two
          // quakes a minute apart leave it 0.4 px wide), so a time bar is drawn at a fixed width.
          shape={
            xKind === "time"
              ? (p: BarShapeProps) => (
                  <Rectangle
                    {...p}
                    x={p.x + p.width / 2 - timeBar / 2}
                    width={timeBar}
                    // A ring of the surface keeps two close instants apart.
                    stroke="var(--surface)"
                    strokeWidth={1}
                    radius={s.stack ? 0 : [2, 2, 0, 0]}
                  />
                )
              : undefined
          }
        />
      );
    }
    if (opts.type === "area") {
      return (
        <Area
          key={s.field}
          {...common}
          type="monotone"
          stroke={color}
          strokeWidth={2}
          fill={color}
          fillOpacity={0.16}
          stackId={s.stack}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
        />
      );
    }
    return (
      <Line
        key={s.field}
        {...common}
        type="monotone"
        stroke={color}
        strokeWidth={2}
        dot={false}
        activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
      />
    );
  });

  const Chart = opts.type === "bar" ? BarChart : opts.type === "area" ? AreaChart : LineChart;
  const frameAttr = (side: "left" | "right") => frames[side]?.domain.join(",") ?? undefined;

  return (
    <div
      ref={ref}
      className="px-4 pt-4 pb-2"
      data-testid="chart"
      data-type={opts.type}
      data-x-kind={xKind}
      data-points={points.length}
      data-bucket={bucket}
      data-tz={zone}
      data-from={range?.[0] != null ? isoInZone(range[0], zone, true) : undefined}
      data-to={range?.[1] != null ? isoInZone(range[1], zone, true) : undefined}
      data-left-domain={frameAttr("left")}
      data-right-domain={frameAttr("right")}
    >
      <Chart
        width={width - 32}
        height={opts.height_px}
        data={points}
        margin={MARGIN}
        barCategoryGap="10%"
      >
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey={X_KEY}
          type={xKind === "time" ? "number" : "category"}
          scale={xKind === "time" ? "time" : "auto"}
          domain={xKind === "time" ? [from, to] : undefined}
          ticks={xKind === "time" ? ticks : undefined}
          tickFormatter={(v: number | string) =>
            xKind === "time" && typeof v === "number"
              ? formatTimeTick(v, ticks, intlLocale, zone)
              : String(v)
          }
          allowDataOverflow={xKind === "time"}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: "var(--border-strong)" }}
          minTickGap={8}
        />
        {sides.map((side) => (
          <YAxis
            key={side}
            yAxisId={side}
            orientation={side}
            width={Y_AXIS_WIDTH}
            domain={frames[side]?.domain ?? ["auto", "auto"]}
            ticks={frames[side]?.ticks}
            allowDataOverflow
            tickFormatter={(v: number) => formatAxisValue(v, opts.y_axis[side].format, intlLocale)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
          />
        ))}
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: "var(--border-strong)", fill: "var(--hover)" }}
          content={(p) => (
            <SeriesTooltip
              active={p.active === true}
              point={p.payload?.[0]?.payload as ChartPoint | undefined}
              describe={describe}
              opts={opts}
              hidden={hidden}
              fieldLabel={fieldLabel}
              bucket={bucket}
            />
          )}
        />
        {series}
      </Chart>
      {/* One series needs no legend: the tab and the axis name it. */}
      {opts.legend && opts.series.length > 1 ? (
        <ul
          className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1"
          data-testid="chart-legend"
        >
          {opts.series.map((s, i) => {
            const off = hidden.has(s.field);
            return (
              <li key={s.field}>
                <button
                  type="button"
                  data-testid="chart-legend-item"
                  data-field={s.field}
                  data-axis={s.axis}
                  data-hidden={off}
                  aria-pressed={!off}
                  onClick={() => toggle(s.field)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-foreground hover:bg-hover",
                    off && "text-muted-foreground line-through",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-0.5 w-3.5 rounded-full",
                      opts.type !== "line" && "h-2.5 w-2.5 rounded-sm",
                      off && "opacity-30",
                    )}
                    style={{ background: seriesColor(s, i) }}
                  />
                  {fieldLabel(s.field, s.label)}
                  {sides.length > 1 ? (
                    <span className="text-muted-foreground">{s.axis === "left" ? "◂" : "▸"}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function TooltipBox({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div
      data-testid={testId}
      className="min-w-40 rounded-md border border-border bg-surface-raised px-3 py-2 text-xs text-foreground shadow-md"
    >
      {children}
    </div>
  );
}

/** One point: its x as the table shows it, then every visible series' value, formatted the same way. */
function SeriesTooltip({
  active,
  point,
  describe,
  opts,
  hidden,
  fieldLabel,
  bucket,
}: {
  active: boolean;
  point: ChartPoint | undefined;
  describe: DescribeResponse;
  opts: ChartOptions;
  hidden: ReadonlySet<string>;
  fieldLabel: (field: string, label?: string) => string;
  bucket: number;
}) {
  const { t, locale, intlLocale } = useI18n();
  if (!active || !point) return null;
  const x = opts.x_field ?? "";
  const xValue = point[X_KEY];
  const count = Number(point[COUNT_KEY] ?? 1);
  return (
    <TooltipBox testId="chart-tooltip">
      <div className="mb-1.5 font-medium text-muted-foreground" data-testid="chart-tooltip-x">
        <CellValue
          value={typeof xValue === "number" ? new Date(xValue).toISOString() : xValue}
          column={columnOf(describe, x)}
          def={describe.schema.fields[x]}
          locale={locale}
          intlLocale={intlLocale}
        />
      </div>
      <table className="w-full">
        <tbody>
          {opts.series.map((s, i) =>
            hidden.has(s.field) ? null : (
              <tr key={s.field} data-testid="chart-tooltip-row" data-field={s.field}>
                <td className="pr-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block size-2 rounded-full"
                      style={{ background: seriesColor(s, i) }}
                    />
                    {fieldLabel(s.field, s.label)}
                  </span>
                </td>
                <td
                  className="text-right font-medium tabular-nums"
                  data-testid="chart-tooltip-value"
                >
                  <CellValue
                    value={point[s.field]}
                    column={columnOf(describe, s.field)}
                    def={describe.schema.fields[s.field]}
                    locale={locale}
                    intlLocale={intlLocale}
                  />
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      {count > 1 ? (
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          {t("APP", bucket > 1 ? "CHART_BUCKET_ROWS" : "CHART_MERGED_ROWS", { count })}
        </div>
      ) : null}
    </TooltipBox>
  );
}

const OTHER_COLOR = "var(--sem-muted)";

function PieView({ collection, describe, rows, opts }: ChartViewProps) {
  const { t, locale, intlLocale } = useI18n();
  const fieldLabel = useFieldLabel(collection);
  const [ref, width] = useWidth<HTMLDivElement>();
  const category = opts.category_field ?? "";
  const value = opts.value_field ?? "";
  const slices = useMemo(
    () => foldSlices(rows, category, value, opts.max_slices),
    [rows, category, value, opts.max_slices],
  );
  const sum = slices.reduce((s, x) => s + x.value, 0);
  const pct = (v: number) =>
    new Intl.NumberFormat(intlLocale, { style: "percent", maximumFractionDigits: 1 }).format(
      sum > 0 ? v / sum : 0,
    );
  const nameOf = (s: PieSlice) => (s.other ? t("APP", "CHART_OTHER") : s.category || "—");
  const colorOf = (s: PieSlice, i: number) =>
    s.other ? OTHER_COLOR : `var(--chart-${(i % CHART_SLOTS) + 1})`;
  const data = slices.map((s, i) => ({ ...s, name: nameOf(s), fill: colorOf(s, i) }));
  const radius = Math.max(60, Math.min(opts.height_px / 2 - 40, width / 4));

  if (slices.length === 0) {
    return <EmptyState filtered={false} onClear={() => {}} body={opts.empty_label} />;
  }
  return (
    <div
      ref={ref}
      className="flex flex-wrap items-center justify-center gap-6 px-4 pt-4 pb-2"
      data-testid="chart"
      data-type="pie"
      data-slices={slices.length}
      data-other={slices.some((s) => s.other)}
    >
      <PieChart width={Math.min(width - 32, radius * 2 + 360)} height={opts.height_px}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={radius * 0.55}
          outerRadius={radius}
          paddingAngle={1}
          stroke="var(--surface)"
          strokeWidth={2}
          isAnimationActive={false}
          // Labels wear the text ink, not the slice's colour; the slice beside them says which.
          label={(e: PieLabelRenderProps) => (
            <text
              x={e.x}
              y={e.y}
              textAnchor={e.textAnchor}
              dominantBaseline="central"
              fill="var(--muted-foreground)"
              fontSize={11}
              data-testid="chart-slice-label"
            >
              {`${e.name ?? ""} ${pct(Number(e.value ?? 0))}`}
            </text>
          )}
          labelLine={false}
        >
          {data.map((s) => (
            <Cell
              key={s.other ? "__other" : s.category}
              fill={s.fill}
              data-testid="chart-slice"
              data-other={s.other === true}
            />
          ))}
        </Pie>
        <Tooltip
          isAnimationActive={false}
          content={(p) => {
            const s = p.payload?.[0]?.payload as (PieSlice & { name: string }) | undefined;
            if (!p.active || !s) return null;
            return (
              <TooltipBox testId="chart-tooltip">
                <div className="mb-1 font-medium">{s.name}</div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{fieldLabel(value)}</span>
                  <span className="font-medium tabular-nums" data-testid="chart-tooltip-value">
                    <CellValue
                      value={s.value}
                      column={columnOf(describe, value)}
                      def={describe.schema.fields[value]}
                      locale={locale}
                      intlLocale={intlLocale}
                    />{" "}
                    · {pct(s.value)}
                  </span>
                </div>
                {s.other ? (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {t("APP", "CHART_OTHER_COUNT", { count: s.count })}
                  </div>
                ) : null}
              </TooltipBox>
            );
          }}
        />
      </PieChart>
      {opts.legend ? (
        <ul className="grid gap-1 text-xs" data-testid="chart-legend">
          {data.map((s) => (
            <li
              key={s.other ? "__other" : s.category}
              className="flex items-center gap-2"
              data-testid="chart-legend-item"
            >
              <span className="inline-block size-2.5 rounded-sm" style={{ background: s.fill }} />
              <span className="min-w-0 truncate">{s.name}</span>
              <span className="ml-auto pl-3 text-muted-foreground tabular-nums">
                {pct(s.value)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
