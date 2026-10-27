import type { FilterOp } from "./filter.js";
import type { FieldType } from "./schema.js";

/** Which input the filter builder draws for a field. */
export type FilterWidget = "text" | "number" | "date" | "bool" | "select" | "lookup" | "none";

export interface FilterableDefaults {
  ops: readonly FilterOp[];
  default_op: FilterOp;
  widget: FilterWidget;
}

const STRING_OPS = [
  "eq",
  "neq",
  "contains",
  "starts_with",
  "ends_with",
  "in",
  "not_in",
  "is_null",
  "is_not_null",
] as const satisfies readonly FilterOp[];

const ORDERED_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "is_null",
  "is_not_null",
] as const satisfies readonly FilterOp[];

const CHOICE_OPS = [
  "eq",
  "neq",
  "in",
  "not_in",
  "is_null",
  "is_not_null",
] as const satisfies readonly FilterOp[];

const NULL_OPS = ["is_null", "is_not_null"] as const satisfies readonly FilterOp[];

const BY_TYPE: Record<FieldType, FilterableDefaults> = {
  string: { ops: STRING_OPS, default_op: "contains", widget: "text" },
  text: { ops: STRING_OPS, default_op: "contains", widget: "text" },
  integer: { ops: ORDERED_OPS, default_op: "eq", widget: "number" },
  year: { ops: ORDERED_OPS, default_op: "eq", widget: "number" },
  decimal: { ops: ORDERED_OPS, default_op: "eq", widget: "number" },
  rating: { ops: ORDERED_OPS, default_op: "gte", widget: "number" },
  date: { ops: ORDERED_OPS, default_op: "eq", widget: "date" },
  datetime: { ops: ORDERED_OPS, default_op: "eq", widget: "date" },
  bool: { ops: ["eq", "is_null", "is_not_null"], default_op: "eq", widget: "bool" },
  json: { ops: NULL_OPS, default_op: "is_null", widget: "none" },
  image: { ops: NULL_OPS, default_op: "is_not_null", widget: "none" },
  enum: { ops: CHOICE_OPS, default_op: "in", widget: "select" },
  lookup: { ops: CHOICE_OPS, default_op: "in", widget: "lookup" },
  relation: { ops: CHOICE_OPS, default_op: "eq", widget: "text" },
  string_array: {
    ops: ["contains", "in", "not_in", ...NULL_OPS],
    default_op: "contains",
    widget: "text",
  },
  lookup_array: { ops: ["contains", ...NULL_OPS], default_op: "contains", widget: "lookup" },
};

/** The filter ops a field of this type allows, its default op and its builder widget. */
export function filterableForType(type: FieldType): FilterableDefaults {
  return BY_TYPE[type];
}
