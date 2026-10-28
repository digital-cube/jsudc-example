import { Navigation2 } from "lucide-react";
import { cn } from "../lib/utils";

/** The finite numbers of a value that should be an array (a history); anything else drops out. */
export function sparkValues(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "number" ? x : typeof x === "string" && x.trim() ? Number(x) : NaN))
    .filter((x) => Number.isFinite(x));
}

export interface SparkGeometry {
  /** `[x, y]` per value, in px of a `width` × `height` box (y down). */
  points: [number, number][];
  min: number;
  max: number;
}

/**
 * A line framed on its own values: the lowest at the bottom, the highest at
 * the top, inside `pad` px of the box (a flat line sits in the middle).
 * Oldest left, newest right; one value is a single point at the right edge.
 */
export function sparkGeometry(
  values: readonly number[],
  width: number,
  height: number,
  pad = 2,
): SparkGeometry | null {
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const w = width - 2 * pad;
  const h = height - 2 * pad;
  const round = (n: number) => Math.round(n * 100) / 100;
  const points = values.map((v, i): [number, number] => {
    const x = values.length === 1 ? width - pad : pad + (i / (values.length - 1)) * w;
    const y = span === 0 ? height / 2 : pad + (1 - (v - min) / span) * h;
    return [round(x), round(y)];
  });
  return { points, min, max };
}

/**
 * A number array as a line: the newest value a dot, min–max and the last
 * value in the tooltip. "—" for no values.
 */
export function Sparkline({
  value,
  width = 96,
  height = 22,
  format = String,
  className,
}: {
  value: unknown;
  width?: number;
  height?: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const values = sparkValues(value);
  const geo = sparkGeometry(values, width, height);
  if (!geo) return <span className="text-muted-foreground/50">—</span>;
  const last = geo.points[geo.points.length - 1] as [number, number];
  const title = `${format(geo.min)} – ${format(geo.max)} · ${format(values[values.length - 1] as number)}`;
  return (
    <svg
      data-testid="sparkline"
      data-points={values.length}
      data-min={geo.min}
      data-max={geo.max}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("block shrink-0 overflow-visible text-sem-info", className)}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {geo.points.length > 1 ? (
        <polyline
          points={geo.points.map((p) => p.join(",")).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <circle data-testid="sparkline-last" cx={last[0]} cy={last[1]} r={2} fill="currentColor" />
    </svg>
  );
}

/** Degrees clockwise from north as `[0, 360)`; `null` for anything that is not a number. */
export function headingDegrees(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? ((n % 360) + 360) % 360 : null;
}

/** An arrow pointing where the value says (north up), the degrees in its tooltip. */
export function HeadingGlyph({ value }: { value: unknown }) {
  const deg = headingDegrees(value);
  if (deg === null) return <span className="text-muted-foreground/50">—</span>;
  const label = `${Math.round(deg)}°`;
  return (
    <span
      data-testid="heading-glyph"
      data-deg={deg}
      title={label}
      className="inline-grid size-5 place-items-center text-muted-foreground"
    >
      <Navigation2
        className="size-3.5 fill-current"
        style={{ transform: `rotate(${deg}deg)` }}
        aria-label={label}
      />
    </span>
  );
}
