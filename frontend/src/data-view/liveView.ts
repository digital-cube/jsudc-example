import {
  type DescribeResponse,
  type FilterNode,
  isCondition,
  type SchemaDoc,
  type SortKey,
  type ViewConfig,
} from "@jsudc/core";

/** A field the schema has and has not soft-deleted. */
export function isLiveField(schema: SchemaDoc, field: string): boolean {
  return Object.hasOwn(schema.fields, field) && schema.fields[field]?.deleted !== true;
}

/**
 * The view with every reference to a field the schema no longer has (or has
 * soft-deleted) taken out: chips, search fields, card slots, `row_color`.
 * `describe` already drops such columns and filter-builder fields; the rest
 * of `view.yaml` is served as written, and a request naming a deleted field
 * would be refused by the server's allowlist.
 */
export function liveView(view: ViewConfig, schema: SchemaDoc): ViewConfig {
  const live = (f: string | undefined) => f !== undefined && isLiveField(schema, f);
  const out: ViewConfig = {
    ...view,
    columns: view.columns.filter((c) => live(c.field)),
  };
  if (view.filters) out.filters = view.filters.filter((c) => live(c.field));
  if (view.search) out.search = { ...view.search, fields: view.search.fields.filter(live) };
  if (view.card_options) {
    const { title_field, subtitle_field, image_field, meta_fields, ...rest } = view.card_options;
    out.card_options = {
      ...rest,
      ...(live(title_field) ? { title_field } : {}),
      ...(live(subtitle_field) ? { subtitle_field } : {}),
      ...(live(image_field) ? { image_field } : {}),
      ...(meta_fields ? { meta_fields: meta_fields.filter(live) } : {}),
    };
  }
  if (view.row_color && !live(view.row_color.field)) delete out.row_color;
  return out;
}

/** `describe` with `liveView` applied. */
export function liveDescribe(d: DescribeResponse): DescribeResponse {
  return { ...d, view: liveView(d.view, d.schema) };
}

/** Sort keys on live fields only. */
export function liveSort(sort: readonly SortKey[], schema: SchemaDoc): SortKey[] {
  return sort.filter((k) => isLiveField(schema, k.field));
}

/**
 * The tree without conditions on fields that are gone; an emptied group
 * disappears, and `null` when nothing is left.
 */
export function pruneTree(tree: FilterNode | null, schema: SchemaDoc): FilterNode | null {
  if (!tree) return null;
  if (isCondition(tree)) return isLiveField(schema, tree.field) ? tree : null;
  if ("not" in tree) {
    const inner = pruneTree(tree.not, schema);
    return inner ? { not: inner } : null;
  }
  const key = "and" in tree ? "and" : "or";
  const kids = ("and" in tree ? tree.and : tree.or)
    .map((n) => pruneTree(n, schema))
    .filter((n): n is FilterNode => n !== null);
  if (kids.length === 0) return null;
  return (key === "and" ? { and: kids } : { or: kids }) as FilterNode;
}
