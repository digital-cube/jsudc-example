import { z } from "zod";

export const SUPPORTED_OPS = [
  "eq",
  "neq",
  "in",
  "not_in",
  "contains",
  "starts_with",
  "ends_with",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "is_null",
  "is_not_null",
] as const;

export type FilterOp = (typeof SUPPORTED_OPS)[number];

export const FilterOpSchema = z.enum(SUPPORTED_OPS);

export interface Condition {
  field: string;
  op: FilterOp;
  value?: unknown;
  case_insensitive?: boolean;
}

export type LogicalGroup = { and: FilterNode[] } | { or: FilterNode[] } | { not: FilterNode };

export type FilterNode = Condition | LogicalGroup;

export function isCondition(node: FilterNode): node is Condition {
  return "field" in node && "op" in node;
}

export const ConditionSchema = z.object({
  field: z.string().min(1),
  op: FilterOpSchema,
  value: z.unknown().optional(),
  case_insensitive: z.boolean().optional(),
});

// Groups are strict so a typo such as `{"And": [...]}` is an error, not an empty match.
export const FilterNodeSchema: z.ZodType<FilterNode> = z.lazy(() =>
  z.union([
    ConditionSchema,
    z.strictObject({ and: z.array(FilterNodeSchema) }),
    z.strictObject({ or: z.array(FilterNodeSchema) }),
    z.strictObject({ not: FilterNodeSchema }),
  ]),
);

/** Builders, as in udc-js, plus one per remaining op. */
export const filter = {
  eq: (field: string, value: unknown): Condition => ({ field, op: "eq", value }),
  neq: (field: string, value: unknown): Condition => ({ field, op: "neq", value }),
  in: (field: string, value: unknown[]): Condition => ({ field, op: "in", value }),
  notIn: (field: string, value: unknown[]): Condition => ({ field, op: "not_in", value }),
  contains: (field: string, value: string, ci = true): Condition => ({
    field,
    op: "contains",
    value,
    case_insensitive: ci,
  }),
  startsWith: (field: string, value: string, ci = false): Condition =>
    ci
      ? { field, op: "starts_with", value, case_insensitive: true }
      : { field, op: "starts_with", value },
  endsWith: (field: string, value: string, ci = false): Condition =>
    ci
      ? { field, op: "ends_with", value, case_insensitive: true }
      : { field, op: "ends_with", value },
  gt: (field: string, value: unknown): Condition => ({ field, op: "gt", value }),
  gte: (field: string, value: unknown): Condition => ({ field, op: "gte", value }),
  lt: (field: string, value: unknown): Condition => ({ field, op: "lt", value }),
  lte: (field: string, value: unknown): Condition => ({ field, op: "lte", value }),
  between: (field: string, lo: unknown, hi: unknown): Condition => ({
    field,
    op: "between",
    value: [lo, hi],
  }),
  isNull: (field: string): Condition => ({ field, op: "is_null" }),
  isNotNull: (field: string): Condition => ({ field, op: "is_not_null" }),
  and: (...children: FilterNode[]): LogicalGroup => ({ and: children }),
  or: (...children: FilterNode[]): LogicalGroup => ({ or: children }),
  not: (child: FilterNode): LogicalGroup => ({ not: child }),
};
