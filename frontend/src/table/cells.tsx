import type { ColumnConfig, FieldDef } from "@jsudc/udc-core";
import { Check, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import { useTimezone } from "../time/timezone";
import { zonedFormat } from "../time/zoned";
import { applyTransforms, hasTransforms, parseIsoParts } from "./transforms";

export type RenderKind = "text" | "number_format" | "bool" | "date" | "datetime" | "number";

/** The column's `render`, or the one its field type implies. */
export function renderKind(column: ColumnConfig, def: FieldDef | undefined): RenderKind {
  switch (column.render) {
    case "text":
    case "number_format":
    case "bool":
    case "date":
    case "datetime":
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
  const decimals = column.render_options?.decimals;
  switch (kind) {
    case "number_format":
      return formatNumber(value, intlLocale, typeof decimals === "number" ? decimals : undefined);
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
  if (isBlank(value)) return <span className="text-muted-foreground/50">—</span>;
  const text = displayText(value, column, kind, locale, intlLocale, timeZone);
  return (
    <span
      className={cn(
        "block truncate",
        kind === "number_format" || kind === "number" ? "tabular-nums" : "",
      )}
      title={typeof value === "string" && value.length > 24 ? value : undefined}
    >
      {text}
    </span>
  );
}
