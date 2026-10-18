import type { FieldDef, SchemaDoc } from "./schema.js";

export interface RowProblem {
  field: string;
  message: string;
}

export type ValidateMode = "insert" | "patch";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?$/;

function isCalendarDate(y: string, m: string, d: string): boolean {
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d)
  );
}

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = DATE_RE.exec(v);
  return m !== null && isCalendarDate(m[1] as string, m[2] as string, m[3] as string);
}

export function isIsoDateTime(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = DATETIME_RE.exec(v);
  return m !== null && isCalendarDate(m[1] as string, m[2] as string, m[3] as string);
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "";

function checkRange(def: FieldDef, v: number): string | null {
  if (def.min !== undefined && v < def.min) return `must be >= ${def.min}`;
  if (def.max !== undefined && v > def.max) return `must be <= ${def.max}`;
  return null;
}

const isStringArray = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");

/** The type/modifier check for one non-empty value; `null` when it is fine. */
function checkValue(def: FieldDef, v: unknown): string | null {
  switch (def.type) {
    case "string":
    case "text":
    case "image":
    case "lookup":
      if (typeof v !== "string") return "must be a string";
      if (def.length !== undefined && v.length > def.length) {
        return `must be at most ${def.length} characters`;
      }
      return null;
    case "integer":
      if (typeof v !== "number" || !Number.isInteger(v)) return "must be an integer";
      return checkRange(def, v);
    case "year":
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1000 || v > 9999) {
        return "must be a 4-digit year";
      }
      return checkRange(def, v);
    case "decimal":
      if (typeof v !== "number" || !Number.isFinite(v)) return "must be a number";
      return checkRange(def, v);
    case "rating":
      if (typeof v === "number" && Number.isFinite(v)) return checkRange(def, v);
      if (
        typeof v === "object" &&
        v !== null &&
        typeof (v as { value?: unknown }).value === "number"
      ) {
        return null;
      }
      return "must be a number";
    case "bool":
      return typeof v === "boolean" ? null : "must be true or false";
    case "date":
      return isIsoDate(v) ? null : "must be a date (YYYY-MM-DD)";
    case "datetime":
      return isIsoDateTime(v) ? null : "must be an ISO 8601 datetime";
    case "enum":
      return typeof v === "string" && (def.values ?? []).includes(v)
        ? null
        : `must be one of: ${(def.values ?? []).join(", ")}`;
    case "string_array":
    case "lookup_array":
      return isStringArray(v) ? null : "must be a list of strings";
    case "relation":
      return typeof v === "string" || typeof v === "number" ? null : "must be an id";
    case "json":
      return typeof v === "function" || typeof v === "symbol" || typeof v === "bigint"
        ? "must be JSON"
        : null;
  }
}

/**
 * Check a row (insert) or a partial patch (update) against a schema. Returns
 * every problem found; an empty list means the row is valid. `__meta` is
 * ignored. A deleted field counts as unknown. `required` is enforced for all
 * fields on insert, and on patch only for the fields the patch touches.
 */
export function validateRow(
  schema: Pick<SchemaDoc, "fields">,
  row: Record<string, unknown>,
  opts: { mode: ValidateMode },
): RowProblem[] {
  const problems: RowProblem[] = [];

  for (const [field, value] of Object.entries(row)) {
    if (field === "__meta") continue;
    const def = Object.hasOwn(schema.fields, field) ? schema.fields[field] : undefined;
    if (!def || def.deleted) {
      problems.push({ field, message: "unknown field" });
      continue;
    }
    if (isEmpty(value)) {
      if (def.required && opts.mode === "patch") problems.push({ field, message: "is required" });
      continue;
    }
    const message = checkValue(def, value);
    if (message) problems.push({ field, message });
  }

  if (opts.mode === "insert") {
    for (const [field, def] of Object.entries(schema.fields)) {
      if (def.required && !def.deleted && isEmpty(row[field])) {
        problems.push({ field, message: "is required" });
      }
    }
  }

  return problems;
}
