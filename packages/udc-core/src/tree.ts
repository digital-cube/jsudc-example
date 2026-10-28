import { z } from "zod";
import type { SchemaDoc } from "./schema.js";

const Field = z.string().min(1);

export const TreeSortKeySchema = z.looseObject({
  field: Field,
  dir: z.enum(["asc", "desc"]).default("asc"),
});

/** The roots: rows whose `field` is null (the default, on `parent_field`) or equals `value`. */
export const TreeRootFilterSchema = z
  .looseObject({
    field: Field,
    op: z.enum(["is_null", "eq"]),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .refine((f) => f.op === "is_null" || f.value !== undefined, {
    message: "eq needs a value",
    path: ["value"],
  });

export const TreeExpandSchema = z.looseObject({
  /** `localstorage` keeps the expanded ids under `udc:tree:<key>`; `none` starts over on every mount. */
  persist: z.enum(["localstorage", "none"]).default("localstorage"),
  /** The storage key; the collection name when absent. */
  key: Field.optional(),
  /** Levels open on a first visit (1: the roots show their children). */
  default_depth: z.number().int().min(0).default(1),
});

export const TreeInteractiveSchema = z.looseObject({
  rename: z.boolean().default(false),
  reparent: z.boolean().default(false),
  reply: z.boolean().default(false),
  /** Declared for dclabs views; jsudc does not offer delete on the tree yet. */
  delete: z.boolean().default(false),
});

export const TreeOnSearchSchema = z.looseObject({
  /** `highlight_and_expand` keeps the tree and opens the way to every match; `filter_only` lets the server filter. */
  mode: z.enum(["highlight_and_expand", "filter_only"]).default("highlight_and_expand"),
  collapse_others: z.boolean().default(true),
});

// Loose, as every view block: a dclabs `tree_options` carries keys jsudc
// does not read (starred_section, interactive.star) and must still parse.
// Every key declared here is one the tree renderer reads.
export const TreeOptionsSchema = z
  .looseObject({
    parent_field: Field.default("parent_id"),
    order_field: Field.default("order"),
    label_field: Field.default("name"),
    /** The label is a `<SECTION>_<TERM>` i18n key, resolved by `t(section, term)`. */
    label_i18n: z.boolean().default(false),
    icon_field: Field.optional(),
    /** Initials drawn in a round avatar instead of an icon. */
    avatar_field: Field.optional(),
    /** Shown muted after the label. */
    path_field: Field.optional(),
    depth_field: Field.optional(),
    /** A lazy tree draws the expander only where this is above zero. */
    children_count_field: Field.optional(),
    ancestor_ids_field: Field.optional(),
    /** `false`: the whole (filtered) collection is read and built client-side; `true`: one level per expand. */
    lazy: z.boolean().default(false),
    lazy_page_size: z.number().int().min(1).max(1000).default(512),
    root_filter: TreeRootFilterSchema.optional(),
    sibling_sort: z.array(TreeSortKeySchema).optional(),
    expand: TreeExpandSchema.prefault({}),
    interactive: TreeInteractiveSchema.prefault({}),
    on_search: TreeOnSearchSchema.prefault({}),
  })
  .superRefine((o, ctx) => {
    if (o.lazy && !o.children_count_field) {
      ctx.addIssue({
        code: "custom",
        path: ["children_count_field"],
        message: "a lazy tree needs children_count_field (the expander reads it)",
      });
    }
  })
  // Defaults that name another option: the roots are rows without a parent, siblings sort by order.
  .transform((o) => ({
    ...o,
    root_filter: o.root_filter ?? { field: o.parent_field, op: "is_null" as const },
    sibling_sort: o.sibling_sort ?? [{ field: o.order_field, dir: "asc" as const }],
  }));

export type TreeOptionsInput = z.input<typeof TreeOptionsSchema>;
export type TreeOptions = z.output<typeof TreeOptionsSchema>;

/** The structure fields of a tree, as `tree.reparent` takes them. */
export function treeReparentFields(opts: TreeOptions): {
  parent_field: string;
  order_field: string;
  depth_field?: string;
  ancestor_ids_field?: string;
  children_count_field?: string;
} {
  return {
    parent_field: opts.parent_field,
    order_field: opts.order_field,
    ...(opts.depth_field ? { depth_field: opts.depth_field } : {}),
    ...(opts.ancestor_ids_field ? { ancestor_ids_field: opts.ancestor_ids_field } : {}),
    ...(opts.children_count_field ? { children_count_field: opts.children_count_field } : {}),
  };
}

/**
 * What a schema says against a tree block: every field the tree reads must
 * be a live field of the schema. Empty when the block fits; the registry
 * refuses a collection otherwise.
 */
export function treeOptionsProblems(opts: TreeOptions, schema: SchemaDoc): string[] {
  const live = (f: string) => {
    const def = schema.fields[f];
    return def && !def.deleted ? def : undefined;
  };
  const named: [string, string | undefined][] = [
    ["parent_field", opts.parent_field],
    ["order_field", opts.order_field],
    ["label_field", opts.label_field],
    ["icon_field", opts.icon_field],
    ["avatar_field", opts.avatar_field],
    ["path_field", opts.path_field],
    ["depth_field", opts.depth_field],
    ["children_count_field", opts.children_count_field],
    ["ancestor_ids_field", opts.ancestor_ids_field],
    ["root_filter.field", opts.root_filter.field],
    ...opts.sibling_sort.map((k, i): [string, string] => [`sibling_sort[${i}]`, k.field]),
  ];
  const problems: string[] = [];
  for (const [key, field] of named) {
    if (field && !live(field)) problems.push(`${key}: ${field} is not a field of the schema`);
  }
  for (const key of ["order_field", "depth_field", "children_count_field"] as const) {
    const field = opts[key];
    const type = field ? live(field)?.type : undefined;
    if (type && type !== "integer" && type !== "decimal") {
      problems.push(`${key}: ${field} is ${type}, a tree needs a number`);
    }
  }
  return problems;
}
