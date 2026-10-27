import { UdcError } from "./envelope.js";
import { type Condition, type FilterNode, isCondition } from "./filter.js";

/**
 * Three-valued result, as in a SQL WHERE clause: a comparison against a
 * missing value is UNKNOWN (`null`), not false, so `not(eq(f, x))` does not
 * match a row without `f` — exactly what `NOT (data->>'f' = 'x')` does on the
 * server. Only a final `true` matches.
 */
type Tri = boolean | null;

const isMissing = (v: unknown): v is null | undefined => v === null || v === undefined;

function asText(v: unknown, ci: boolean): string {
  const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  return ci ? s.toLowerCase() : s;
}

/** Numbers compare numerically when both sides are numbers; anything else compares as text. */
function compare(a: unknown, b: unknown, ci: boolean): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = asText(a, ci);
  const y = asText(b, ci);
  return x < y ? -1 : x > y ? 1 : 0;
}

function equals(a: unknown, b: unknown, ci: boolean): boolean {
  return compare(a, b, ci) === 0;
}

function textOp(lhs: unknown, rhs: unknown, ci: boolean, test: (l: string, r: string) => boolean) {
  const r = asText(rhs, ci);
  // An array field (string_array, lookup_array) matches when one element does.
  if (Array.isArray(lhs)) return lhs.some((el) => !isMissing(el) && test(asText(el, ci), r));
  return test(asText(lhs, ci), r);
}

function evaluateCondition(cond: Condition, row: Record<string, unknown>): Tri {
  const lhs = row[cond.field];
  const rhs = cond.value;
  const ci = cond.case_insensitive === true;

  if (cond.op === "is_null") return isMissing(lhs);
  if (cond.op === "is_not_null") return !isMissing(lhs);
  if (isMissing(lhs)) return null;

  switch (cond.op) {
    case "eq":
      return isMissing(rhs) ? null : equals(lhs, rhs, ci);
    case "neq":
      return isMissing(rhs) ? null : !equals(lhs, rhs, ci);
    case "in":
    case "not_in": {
      if (!Array.isArray(rhs)) {
        throw new UdcError("validation_error", `${cond.op} expects an array value`, {
          field: cond.field,
        });
      }
      const member = (x: unknown) => rhs.some((v) => !isMissing(v) && equals(x, v, ci));
      // An array field is in the list when one of its elements is, as for the text ops.
      const hit = Array.isArray(lhs) ? lhs.some((el) => !isMissing(el) && member(el)) : member(lhs);
      return cond.op === "in" ? hit : !hit;
    }
    case "contains":
      return isMissing(rhs) ? null : textOp(lhs, rhs, ci, (l, r) => l.includes(r));
    case "starts_with":
      return isMissing(rhs) ? null : textOp(lhs, rhs, ci, (l, r) => l.startsWith(r));
    case "ends_with":
      return isMissing(rhs) ? null : textOp(lhs, rhs, ci, (l, r) => l.endsWith(r));
    case "gt":
      return isMissing(rhs) ? null : compare(lhs, rhs, ci) > 0;
    case "gte":
      return isMissing(rhs) ? null : compare(lhs, rhs, ci) >= 0;
    case "lt":
      return isMissing(rhs) ? null : compare(lhs, rhs, ci) < 0;
    case "lte":
      return isMissing(rhs) ? null : compare(lhs, rhs, ci) <= 0;
    case "between": {
      if (!Array.isArray(rhs) || rhs.length !== 2) {
        throw new UdcError("validation_error", "between expects [lo, hi]", { field: cond.field });
      }
      const [lo, hi] = rhs;
      if (isMissing(lo) || isMissing(hi)) return null;
      return compare(lhs, lo, ci) >= 0 && compare(lhs, hi, ci) <= 0;
    }
    default:
      throw new UdcError("unsupported_op", `unsupported op: ${String((cond as Condition).op)}`);
  }
}

function evaluateNode(node: FilterNode, row: Record<string, unknown>): Tri {
  if (isCondition(node)) return evaluateCondition(node, row);
  if ("and" in node) {
    let out: Tri = true;
    for (const child of node.and) {
      const v = evaluateNode(child, row);
      if (v === false) return false;
      if (v === null) out = null;
    }
    return out;
  }
  if ("or" in node) {
    let out: Tri = false;
    for (const child of node.or) {
      const v = evaluateNode(child, row);
      if (v === true) return true;
      if (v === null) out = null;
    }
    return out;
  }
  if ("not" in node) {
    const v = evaluateNode(node.not, row);
    return v === null ? null : !v;
  }
  throw new UdcError("validation_error", "unrecognised filter node");
}

/**
 * Evaluate a filter tree against one row in memory, with the semantics the
 * server's SQL compiler has. No filter (`null`/`undefined`) matches every row.
 * Throws `UdcError` for an unknown op or a malformed `in`/`between` value.
 */
export function evaluateFilter(
  node: FilterNode | null | undefined,
  row: Record<string, unknown>,
): boolean {
  if (node === null || node === undefined) return true;
  return evaluateNode(node, row) === true;
}
