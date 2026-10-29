import { COLUMN_COLORS, type ColumnColor, type ColumnConfig, type FieldDef } from "@jsudc/core";
import { Check, X } from "lucide-react";
import type { ReactNode } from "react";
import { resolveIcon } from "../icons/resolve";
import { cn } from "../lib/utils";
import { useTimezone } from "../time/timezone";
import { zonedFormat } from "../time/zoned";
import { HeadingGlyph, Sparkline } from "./sparkline";
import { applyTransforms, hasTransforms, parseIsoParts } from "./transforms";

export type RenderKind =
  | "text"
  | "number_format"
  | "bool"
  | "date"
  | "datetime"
  | "number"
  | "bytes"
  | "badge"
  | "icon"
  | "sparkline"
  | "heading_glyph";

/** The column's `render`, or the one its field type implies. */
export function renderKind(column: ColumnConfig, def: FieldDef | undefined): RenderKind {
  switch (column.render) {
    case "text":
    case "number_format":
    case "bool":
    case "date":
    case "datetime":
    case "bytes":
    case "badge":
    case "icon":
    case "sparkline":
    case "heading_glyph":
      return column.render;
  }
  switch (def?.type) {
    case "integer":
    case "decimal":
    case "rating":
      return "number_format";
    case "year":
      return "number";
    case "bool":
      return "bool";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    default:
      return "text";
  }
}

export function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

export function formatNumber(v: unknown, intlLocale: string, decimals?: number): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return new Intl.NumberFormat(intlLocale, {
    maximumFractionDigits: decimals ?? 2,
    ...(decimals === undefined ? {} : { minimumFractionDigits: decimals }),
  }).format(n);
}

/**
 * A `number_format` value: `render_options.precision` (or `decimals`, the
 * older spelling) fraction digits and `suffix` after it (`" m"`, `"°"`).
 */
export function formatNumberColumn(v: unknown, column: ColumnConfig, intlLocale: string): string {
  const o = column.render_options;
  const digits = o?.precision ?? o?.decimals;
  const text = formatNumber(v, intlLocale, typeof digits === "number" ? digits : undefined);
  return typeof o?.suffix === "string" ? `${text}${o.suffix}` : text;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** A size in bytes as people read it: `512 B`, `1.5 KB`, `12 MB` (powers of 1024). */
export function formatBytes(v: unknown, intlLocale: string): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return String(v);
  let unit = 0;
  let size = n;
  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || size >= 100 ? 0 : 1;
  const text = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: digits }).format(size);
  return `${text} ${BYTE_UNITS[unit]}`;
}

const isTone = (v: unknown): v is ColumnColor =>
  typeof v === "string" && (COLUMN_COLORS as readonly string[]).includes(v);

/** The tone of one badge value: `render_options.map[value]`, else `render_options.default`, else muted. */
export function badgeTone(value: unknown, options: ColumnConfig["render_options"]): ColumnColor {
  const map = options?.map;
  const mapped =
    map && typeof map === "object" ? (map as Record<string, unknown>)[String(value)] : undefined;
  if (isTone(mapped)) return mapped;
  return isTone(options?.default) ? options.default : "muted";
}

/** A date is a calendar day: formatted in UTC so no time zone moves it. */
export function formatDate(v: unknown, intlLocale: string): string {
  const p = parseIsoParts(v);
  if (!p) return String(v);
  return new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(Date.UTC(p.y, p.m - 1, p.d)),
  );
}

/** An instant, as the clock of `timeZone` (the header's zone; default the browser's) reads it. */
export function formatDateTime(v: unknown, intlLocale: string, timeZone?: string): string {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  const opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };
  return timeZone
    ? zonedFormat(intlLocale, timeZone, opts).format(d)
    : new Intl.DateTimeFormat(intlLocale, opts).format(d);
}

/**
 * The text a non-bool cell shows: transforms first, else the render kind's
 * format. `timeZone` moves a `datetime` (a `date` has no zone and never moves).
 */
export function displayText(
  value: unknown,
  column: ColumnConfig,
  kind: RenderKind,
  locale: string,
  intlLocale: string,
  timeZone?: string,
): string {
  const zone = kind === "datetime" ? timeZone : undefined;
  if (hasTransforms(column.transform)) {
    return String(applyTransforms(value, column.transform, locale, zone));
  }
  switch (kind) {
    case "number_format":
      return formatNumberColumn(value, column, intlLocale);
    case "bytes":
      return formatBytes(value, intlLocale);
    case "date":
      return formatDate(value, intlLocale);
    case "datetime":
      return formatDateTime(value, intlLocale, zone);
    default:
      // A string_array reads as a list, not as JSON.
      if (Array.isArray(value) && value.every((v) => typeof v !== "object")) {
        return value.map(String).join(", ");
      }
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

function BoolValue({ value, style }: { value: unknown; style: unknown }) {
  const on = value === true;
  if (style === "badge") {
    return (
      <span
        className={cn(
          "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium",
          on ? "bg-sem-success-bg text-sem-success" : "bg-muted text-muted-foreground",
        )}
      >
        {on ? "✓" : "–"}
      </span>
    );
  }
  return on ? (
    <span
      data-bool="true"
      className="inline-grid size-5 place-items-center rounded-full bg-sem-success-bg text-sem-success"
    >
      <Check className="size-3.5" strokeWidth={2.75} aria-label="true" />
    </span>
  ) : (
    <span
      data-bool="false"
      className="inline-grid size-5 place-items-center rounded-full text-sem-muted/70"
    >
      <X className="size-3.5" strokeWidth={2.5} aria-label="false" />
    </span>
  );
}

/** Badge tone → classes. Literal strings so Tailwind sees them. */
const BADGE: Record<ColumnColor, string> = {
  default: "bg-muted text-foreground",
  accent: "bg-sem-accent-bg text-sem-accent",
  success: "bg-sem-success-bg text-sem-success",
  warning: "bg-sem-warning-bg text-sem-warning",
  danger: "bg-sem-danger-bg text-sem-danger",
  info: "bg-sem-info-bg text-sem-info",
  muted: "bg-muted text-muted-foreground",
};

/** One pill per value (a `string_array` is several), toned by `render_options.map`. */
export function Badges({ value, column }: { value: unknown; column: ColumnConfig }) {
  const values = (Array.isArray(value) ? value : [value]).filter((v) => !isBlank(v));
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
      {values.map((v, i) => {
        const tone = badgeTone(v, column.render_options);
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: values may repeat
            key={i}
            data-testid="badge"
            data-tone={tone}
            className={cn(
              "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap",
              BADGE[tone],
            )}
          >
            {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </span>
        );
      })}
    </span>
  );
}

/** What one table cell shows. */
export function CellValue({
  value,
  column,
  def,
  locale,
  intlLocale,
}: {
  value: unknown;
  column: ColumnConfig;
  def: FieldDef | undefined;
  locale: string;
  intlLocale: string;
}): ReactNode {
  const { timeZone } = useTimezone();
  const kind = renderKind(column, def);
  if (kind === "bool" && !isBlank(value)) {
    return <BoolValue value={value} style={column.render_options?.style} />;
  }
  if (isBlank(value) || (Array.isArray(value) && value.length === 0)) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  if (kind === "badge") return <Badges value={value} column={column} />;
  if (kind === "sparkline") {
    const o = column.render_options;
    return (
      <Sparkline
        value={value}
        width={typeof o?.width === "number" ? o.width : undefined}
        height={typeof o?.height === "number" ? o.height : undefined}
        format={(n) => formatNumber(n, intlLocale, 0)}
      />
    );
  }
  if (kind === "heading_glyph") return <HeadingGlyph value={value} />;
  if (kind === "icon") {
    const Icon = resolveIcon(value);
    return Icon ? (
      <span title={String(value)} data-testid="icon-value" data-icon={String(value)}>
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </span>
    ) : null;
  }
  const text = displayText(value, column, kind, locale, intlLocale, timeZone);
  return (
    <span
      className={cn(
        "block truncate",
        kind === "number_format" || kind === "number" || kind === "bytes" ? "tabular-nums" : "",
      )}
      title={typeof value === "string" && value.length > 24 ? value : undefined}
    >
      {text}
    </span>
  );
}
