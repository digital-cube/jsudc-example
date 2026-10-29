import {
  type Condition,
  type FilterChipConfig,
  type FilterNode,
  isCondition,
  type SearchConfig,
} from "@jsudc/core";
import { type ChipState, type ChipValue, isEmptyChip } from "./urlState";

/** The search box as a filter: `contains` over every `search.fields`, or-ed. */
export function searchFilter(
  text: string,
  search: Pick<SearchConfig, "fields" | "case_insensitive"> | undefined,
): FilterNode | null {
  const q = text.trim();
  if (!q || !search || search.fields.length === 0) return null;
  const ci = search.case_insensitive ?? true;
  const conditions: Condition[] = search.fields.map((field) => ({
    field,
    op: "contains",
    value: q,
    ...(ci ? { case_insensitive: true } : {}),
  }));
  return conditions.length === 1 ? (conditions[0] as Condition) : { or: conditions };
}

/** One chip as a condition: `in` for select, `between` (or one side) for range, `eq` for bool. */
export function chipCondition(field: string, v: ChipValue): Condition | null {
  if (isEmptyChip(v)) return null;
  switch (v.kind) {
    case "select":
      return { field, op: "in", value: v.values };
    case "bool":
      return { field, op: "eq", value: v.value };
    case "range":
      if (v.min !== null && v.max !== null) return { field, op: "between", value: [v.min, v.max] };
      if (v.min !== null) return { field, op: "gte", value: v.min };
      return { field, op: "lte", value: v.max };
  }
}

/** The chips the view declares, in view order; state for an undeclared chip is ignored. */
export function chipsFilter(
  state: ChipState,
  configs: readonly FilterChipConfig[] | undefined,
): Condition[] {
  const out: Condition[] = [];
  for (const cfg of configs ?? []) {
    const v = state[cfg.field];
    if (!v || v.kind !== cfg.kind) continue;
    const c = chipCondition(cfg.field, v);
    if (c) out.push(c);
  }
  return out;
}

export interface ComposeInput {
  search: string;
  searchConfig: Pick<SearchConfig, "fields" | "case_insensitive"> | undefined;
  chips: ChipState;
  chipConfigs: readonly FilterChipConfig[] | undefined;
  tree: FilterNode | null;
}

/** The request filter: search `and` chips `and` the builder's tree; `undefined` when empty. */
export function composeFilter(input: ComposeInput): FilterNode | undefined {
  const parts: FilterNode[] = [];
  const s = searchFilter(input.search, input.searchConfig);
  if (s) parts.push(s);
  parts.push(...chipsFilter(input.chips, input.chipConfigs));
  if (input.tree) parts.push(input.tree);
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : { and: parts };
}

/**
 * The builder edits a flat list of conditions, and-ed. A tree from a link
 * that is not of that shape (an `or`, a `not`, nesting) is kept as it is
 * and shown as one pill: `null` here.
 */
export function treeToConditions(tree: FilterNode | null): Condition[] | null {
  if (!tree) return [];
  if (isCondition(tree)) return [tree];
  if ("and" in tree && tree.and.every(isCondition)) return tree.and as Condition[];
  return null;
}

export function conditionsToTree(conditions: readonly Condition[]): FilterNode | null {
  return conditions.length ? { and: [...conditions] } : null;
}
