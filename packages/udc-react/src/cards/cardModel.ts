import type { CardOptions, ColumnColor, ColumnConfig, ViewConfig } from "@jsudc/core";

export type CardSize = "small" | "medium" | "large";

/** `card_options.size` → the minimum width of a grid column, px. */
export const CARD_MIN_WIDTH: Record<CardSize, number> = { small: 240, medium: 300, large: 380 };

/** `sm` / `lg` (the dclabs spelling) and `small` / `large` are the same size; default `medium`. */
export function cardSize(size: CardOptions["size"]): CardSize {
  switch (size) {
    case "sm":
    case "small":
      return "small";
    case "lg":
    case "large":
      return "large";
    default:
      return "medium";
  }
}

export interface CardSlots {
  title: ColumnConfig;
  subtitle: ColumnConfig | null;
  image: string | null;
  /** `cover` across the top, or `avatar` in the avatar's place. */
  imageStyle: "cover" | "avatar";
  meta: ColumnConfig[];
  size: CardSize;
  /** One number shown large under the header. */
  metric: NonNullable<CardOptions["metric"]> | null;
  /** A number array drawn under the meta fields. */
  sparkline: { field: string; width: number; height: number } | null;
}

/** The card's sparkline box when `card_options.sparkline` gives none, px. */
export const CARD_SPARKLINE = { width: 240, height: 36 };

/**
 * The metric as text: `precision` fraction digits (the locale's grouping),
 * then `unit`. `null` when the value is not a number.
 */
export function metricText(
  value: unknown,
  metric: NonNullable<CardOptions["metric"]>,
  intlLocale: string,
): string | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return null;
  const digits = metric.precision;
  const text = new Intl.NumberFormat(intlLocale, {
    maximumFractionDigits: digits ?? 2,
    ...(digits === undefined ? {} : { minimumFractionDigits: digits }),
  }).format(n);
  return `${text}${metric.unit ?? ""}`;
}

/**
 * Which field fills which part of a card. Every slot is formatted through
 * the field's table column (render, transform, color), so a card shows a
 * value exactly as the table does; a field without a column gets a bare one.
 * Without `title_field` the title is the first left-pinned column, else the
 * first column.
 */
export function cardSlots(view: ViewConfig): CardSlots {
  const opts = view.card_options ?? {};
  const column = (field: string): ColumnConfig =>
    view.columns.find((c) => c.field === field) ?? { field };
  const titleField =
    opts.title_field ??
    view.columns.find((c) => c.pin === "left")?.field ??
    view.columns[0]?.field ??
    "name";
  return {
    title: column(titleField),
    subtitle: opts.subtitle_field ? column(opts.subtitle_field) : null,
    image: opts.image_field ?? null,
    imageStyle: opts.image_style ?? "cover",
    meta: (opts.meta_fields ?? []).map(column),
    size: cardSize(opts.size),
    metric: opts.metric ?? null,
    sparkline: opts.sparkline
      ? {
          field: opts.sparkline.field,
          width: opts.sparkline.width ?? CARD_SPARKLINE.width,
          height: opts.sparkline.height ?? CARD_SPARKLINE.height,
        }
      : null,
  };
}

/**
 * Up to two letters for the avatar: the first letter of the first two
 * words, or the first two letters of a single word. `?` for no letters.
 */
export function initials(text: string): string {
  const words = text
    .normalize("NFC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0] ?? "";
  const letters =
    words.length === 1
      ? Array.from(first).slice(0, 2)
      : [first, words[1] ?? ""].map((w) => Array.from(w)[0] ?? "");
  return letters.join("").toLocaleUpperCase();
}

const AVATAR_TONES: readonly ColumnColor[] = ["accent", "info", "success", "warning", "danger"];

/** A stable avatar colour for a title, so the same company always looks the same. */
export function avatarTone(seed: string): ColumnColor {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length] ?? "accent";
}
