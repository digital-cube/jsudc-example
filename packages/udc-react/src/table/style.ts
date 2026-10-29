import type { ColumnColor, RowColorConfig } from "@jsudc/core";

/** Semantic text colour tokens → classes. Literal strings so Tailwind sees them. */
export const TEXT_COLOR: Record<ColumnColor, string> = {
  default: "text-foreground",
  accent: "text-sem-accent",
  success: "text-sem-success",
  warning: "text-sem-warning",
  danger: "text-sem-danger",
  info: "text-sem-info",
  muted: "text-sem-muted",
};

/** Semantic background tokens → classes; `default` paints nothing. */
export const BG_COLOR: Record<ColumnColor, string> = {
  default: "",
  accent: "bg-sem-accent-bg",
  success: "bg-sem-success-bg",
  warning: "bg-sem-warning-bg",
  danger: "bg-sem-danger-bg",
  info: "bg-sem-info-bg",
  muted: "bg-sem-muted-bg",
};

export interface RowTone {
  color?: ColumnColor;
  bg?: ColumnColor;
}

/**
 * The first `row_color` rule the row matches: `value` (equality), `min`/`max`
 * (inclusive numeric range), or the `else` rule when none of the others did.
 * `null` when there is no config, `apply: false`, or nothing matched.
 */
export function resolveRowColor(
  row: Record<string, unknown>,
  cfg: RowColorConfig | undefined,
): RowTone | null {
  if (!cfg || cfg.apply === false) return null;
  const v = row[cfg.field];
  const tone = (r: (typeof cfg.rules)[number]): RowTone => ({
    ...(r.color ? { color: r.color } : {}),
    ...(r.bg ? { bg: r.bg } : {}),
  });
  for (const rule of cfg.rules) {
    if (rule.else) continue;
    if ("value" in rule && rule.value !== undefined) {
      if (rule.value === v || (v !== null && v !== undefined && String(rule.value) === String(v))) {
        return tone(rule);
      }
      continue;
    }
    if (rule.min !== undefined || rule.max !== undefined) {
      const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN;
      if (!Number.isFinite(n)) continue;
      if (rule.min !== undefined && n < rule.min) continue;
      if (rule.max !== undefined && n > rule.max) continue;
      return tone(rule);
    }
  }
  const fallback = cfg.rules.find((r) => r.else);
  return fallback ? tone(fallback) : null;
}
