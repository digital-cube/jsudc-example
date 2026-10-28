import { z } from "zod";
import { FilterNodeSchema, FilterOpSchema } from "./filter.js";
import { PageRequestSchema, SortKeySchema } from "./query.js";
import { RowSchema } from "./row.js";
import { FieldDefSchema, FieldNameSchema, FieldTypeSchema, SchemaDocSchema } from "./schema.js";
import { SourceGroupSchema, SourceKindSchema } from "./source.js";
import { ViewConfigSchema } from "./view.js";

const CollectionName = z.string().min(1);

export const CapabilitiesSchema = z.looseObject({
  mutate: z.boolean(),
  subscribe: z.boolean(),
  total_count: z.boolean(),
  schema_edit: z.boolean(),
  config_edit: z.boolean(),
  /** The source renumbers an order field server-side (`reindex`). */
  reindex: z.boolean(),
  /** The source moves a tree node and keeps its structure fields consistent (`tree.reparent`). */
  tree_reparent: z.boolean(),
  /** The source is a file the UI may show as it is written (`source.read`, the Source tab). */
  source_yaml: z.boolean().default(false),
  /**
   * How `list` pages: keyset `cursor`, `offset`, or both. Absent means both.
   * An array-backed source (memory, filesystem, http_api) answers `["offset"]`:
   * the infinite list and `useUdcAllRows` then walk it by offset.
   */
  paging: z.array(z.enum(["cursor", "offset"])).optional(),
  supported_filter_ops: z.array(FilterOpSchema),
});

export type Capabilities = z.infer<typeof CapabilitiesSchema>;

// collections ---------------------------------------------------------------

export const CollectionsRequestSchema = z.object({});
export type CollectionsRequest = z.infer<typeof CollectionsRequestSchema>;

export const CollectionListingSchema = z.looseObject({
  name: z.string().min(1),
  label: z.string().optional(),
  default_renderer: z.string(),
  capabilities: CapabilitiesSchema,
  /** The `kind` of its `source.yaml` (`postgres_jsonb` without one). */
  source_kind: SourceKindSchema,
  /** The sidebar group, derived from `source_kind` (`sourceGroup`). */
  group: SourceGroupSchema.optional(),
});

export type CollectionListing = z.infer<typeof CollectionListingSchema>;

export const CollectionsResponseSchema = z.object({
  collections: z.array(CollectionListingSchema),
});

export type CollectionsResponse = z.infer<typeof CollectionsResponseSchema>;

// describe ------------------------------------------------------------------

export const DescribeRequestSchema = z.object({ collection: CollectionName });
export type DescribeRequest = z.infer<typeof DescribeRequestSchema>;

/** One filter-builder entry, already merged with the type defaults (`filterableForType`). */
export const FilterableFieldSchema = z.looseObject({
  field: z.string().min(1),
  type: FieldTypeSchema,
  ops: z.array(FilterOpSchema),
  default_op: FilterOpSchema,
  widget: z.string(),
  label: z.string().optional(),
});

export type FilterableField = z.infer<typeof FilterableFieldSchema>;

/** The locales a collection README may be written in. */
export const LOCALES_WITH_DOCS = ["en", "sr"] as const;

/** A collection's README per locale (markdown): `README.md` is `en`, `README.<locale>.md` the others. */
export const CollectionDocsSchema = z.object({
  en: z.string().optional(),
  sr: z.string().optional(),
});

export type CollectionDocs = z.infer<typeof CollectionDocsSchema>;

/**
 * What a source says about how it reaches its rows, for the freshness pill:
 * an http_api source's credential (`anonymous` or `oauth2`) and the TTL its
 * server cache uses now.
 */
export const SourceInfoSchema = z.looseObject({
  auth: z.enum(["anonymous", "oauth2"]).optional(),
  cache_ttl_ms: z.number().int().min(0).optional(),
});

export type SourceInfo = z.infer<typeof SourceInfoSchema>;

export const DescribeResponseSchema = z.object({
  collection: z.string().min(1),
  capabilities: CapabilitiesSchema,
  source_kind: SourceKindSchema,
  /** Absent for a source with nothing to say (every source but http_api). */
  source: SourceInfoSchema.optional(),
  /** Present when the collection directory has a README; the UI shows a Doc tab. */
  docs: CollectionDocsSchema.optional(),
  schema: SchemaDocSchema,
  view: ViewConfigSchema,
  filterable: z.object({ fields: z.array(FilterableFieldSchema) }),
});

export type DescribeResponse = z.infer<typeof DescribeResponseSchema>;

// list ----------------------------------------------------------------------

export const ListRequestSchema = z.object({
  collection: CollectionName,
  filter: FilterNodeSchema.optional(),
  sort: z.array(SortKeySchema).optional(),
  page: PageRequestSchema.optional(),
});

export type ListRequest = z.infer<typeof ListRequestSchema>;

export const ListResponseSchema = z.object({
  rows: z.array(RowSchema),
  next_cursor: z.string().nullable(),
  total: z.number().int().min(0).nullable(),
  /**
   * A source that serves a fetched copy (http_api): when that copy was
   * fetched (ISO instant), and `stale` when the last refresh failed and the
   * copy is older than its TTL. Absent for a live source.
   */
  fetched_at: z.string().optional(),
  stale: z.boolean().optional(),
});

export type ListResponse = z.infer<typeof ListResponseSchema>;

// read ----------------------------------------------------------------------

export const ReadRequestSchema = z.object({ collection: CollectionName, id: z.string().min(1) });
export type ReadRequest = z.infer<typeof ReadRequestSchema>;

export const ReadResponseSchema = z.object({ row: RowSchema });
export type ReadResponse = z.infer<typeof ReadResponseSchema>;

// mutate --------------------------------------------------------------------

export const MUTATE_OPS = ["insert", "update", "delete"] as const;
export type MutateOp = (typeof MUTATE_OPS)[number];

export const MutateRequestSchema = z
  .object({
    collection: CollectionName,
    op: z.enum(MUTATE_OPS),
    id: z.string().min(1).optional(),
    row: z.record(z.string(), z.unknown()).optional(),
    expected_version: z.number().int().min(1).optional(),
  })
  .superRefine((req, ctx) => {
    if (req.op !== "insert" && req.id === undefined) {
      ctx.addIssue({ code: "custom", path: ["id"], message: `${req.op} needs an id` });
    }
    if (req.op !== "delete" && req.row === undefined) {
      ctx.addIssue({ code: "custom", path: ["row"], message: `${req.op} needs a row` });
    }
  });

export type MutateRequest = z.infer<typeof MutateRequestSchema>;

export const MutateResponseSchema = z.object({ row: RowSchema });
export type MutateResponse = z.infer<typeof MutateResponseSchema>;

// schema.* ------------------------------------------------------------------

export const SchemaPositionSchema = z
  .object({
    where: z.enum(["before", "after", "end"]),
    anchor: z.string().min(1).optional(),
  })
  .refine((p) => p.where === "end" || p.anchor !== undefined, {
    message: "before/after need an anchor field",
    path: ["anchor"],
  });

export type SchemaPosition = z.infer<typeof SchemaPositionSchema>;

export const SchemaAddFieldRequestSchema = z.object({
  collection: CollectionName,
  name: FieldNameSchema,
  fielddef: FieldDefSchema,
  position: SchemaPositionSchema,
});

export type SchemaAddFieldRequest = z.infer<typeof SchemaAddFieldRequestSchema>;

export const SchemaUpdateFieldRequestSchema = z.object({
  collection: CollectionName,
  name: FieldNameSchema,
  fielddef: FieldDefSchema,
});

export type SchemaUpdateFieldRequest = z.infer<typeof SchemaUpdateFieldRequestSchema>;

/** `field`, not `name`: the udc-py/udc-js spelling. */
export const SchemaSoftDeleteFieldRequestSchema = z.object({
  collection: CollectionName,
  field: FieldNameSchema,
});

export type SchemaSoftDeleteFieldRequest = z.infer<typeof SchemaSoftDeleteFieldRequestSchema>;

export const SchemaResponseSchema = z.object({ schema: SchemaDocSchema });
export type SchemaResponse = z.infer<typeof SchemaResponseSchema>;

// reindex -------------------------------------------------------------------

/** One scope value: the rows renumbered are those whose fields equal every entry. */
const ScopeValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/**
 * Renumber `order_field` (default `order`) of the rows in `scope` to `gap`,
 * `2*gap`, … in their current order (ties by id). What a client calls when
 * two neighbours left no integer between them.
 */
export const ReindexRequestSchema = z.object({
  collection: CollectionName,
  scope: z.record(z.string().min(1), ScopeValueSchema),
  order_field: z.string().min(1).optional(),
  gap: z.number().int().min(2).max(1_000_000).optional(),
});

export type ReindexRequest = z.infer<typeof ReindexRequestSchema>;

export const ReindexResponseSchema = z.object({ updated: z.number().int().min(0) });
export type ReindexResponse = z.infer<typeof ReindexResponseSchema>;

// tree.reparent -------------------------------------------------------------

/** The structure fields of the tree, as its `tree_options` name them. */
export const TreeReparentFieldsSchema = z.object({
  parent_field: z.string().min(1),
  order_field: z.string().min(1),
  /** Recomputed for the node and its whole subtree. */
  depth_field: z.string().min(1).optional(),
  /** Recomputed for the node and its whole subtree (root first, the row itself excluded). */
  ancestor_ids_field: z.string().min(1).optional(),
  /** The old parent loses one, the new parent gains one. */
  children_count_field: z.string().min(1).optional(),
});

export type TreeReparentFields = z.infer<typeof TreeReparentFieldsSchema>;

/**
 * Move row `id` under `parent` (`null`: to the root) at `order`, in one
 * transaction. A collision of orders is the caller's to resolve (`reindex`
 * with the new parent as scope, then again), as on the kanban.
 */
export const TreeReparentRequestSchema = z.object({
  collection: CollectionName,
  id: z.string().min(1),
  parent: z.string().min(1).nullable(),
  order: z.number().finite(),
  expected_version: z.number().int().min(1).optional(),
  fields: TreeReparentFieldsSchema,
});

export type TreeReparentRequest = z.infer<typeof TreeReparentRequestSchema>;

/** The moved row as it is now, and how many rows the move changed (it, its subtree, the parents). */
export const TreeReparentResponseSchema = z.object({
  row: RowSchema,
  updated: z.number().int().min(0),
});

export type TreeReparentResponse = z.infer<typeof TreeReparentResponseSchema>;

// source.read ---------------------------------------------------------------

/** The file a `source_yaml` collection is read from, as written. */
export const SourceReadRequestSchema = z.object({ collection: CollectionName });
export type SourceReadRequest = z.infer<typeof SourceReadRequestSchema>;

export const SourceReadResponseSchema = z.object({
  /** Relative to the backend's collections directory (`menu/data/menu.yaml`). */
  path: z.string().min(1),
  text: z.string(),
  /** Last modification, ISO instant. */
  mtime: z.string(),
  /** The file as it is now does not parse: why. The rows served are the last good read (`stale`). */
  error: z.string().optional(),
});

export type SourceReadResponse = z.infer<typeof SourceReadResponseSchema>;

// registry ------------------------------------------------------------------

/** Every action with its payload schemas, so a server can dispatch generically. */
export const ACTIONS = {
  collections: { request: CollectionsRequestSchema, response: CollectionsResponseSchema },
  describe: { request: DescribeRequestSchema, response: DescribeResponseSchema },
  list: { request: ListRequestSchema, response: ListResponseSchema },
  read: { request: ReadRequestSchema, response: ReadResponseSchema },
  mutate: { request: MutateRequestSchema, response: MutateResponseSchema },
  "schema.add_field": { request: SchemaAddFieldRequestSchema, response: SchemaResponseSchema },
  "schema.update_field": {
    request: SchemaUpdateFieldRequestSchema,
    response: SchemaResponseSchema,
  },
  "schema.soft_delete_field": {
    request: SchemaSoftDeleteFieldRequestSchema,
    response: SchemaResponseSchema,
  },
  reindex: { request: ReindexRequestSchema, response: ReindexResponseSchema },
  "tree.reparent": { request: TreeReparentRequestSchema, response: TreeReparentResponseSchema },
  "source.read": { request: SourceReadRequestSchema, response: SourceReadResponseSchema },
} as const satisfies Record<string, { request: z.ZodType; response: z.ZodType }>;

export type ActionName = keyof typeof ACTIONS;
export type ActionRequest<A extends ActionName> = z.output<(typeof ACTIONS)[A]["request"]>;
export type ActionResponse<A extends ActionName> = z.output<(typeof ACTIONS)[A]["response"]>;

export const ACTION_NAMES = Object.keys(ACTIONS) as ActionName[];

export function isActionName(name: unknown): name is ActionName {
  return typeof name === "string" && Object.hasOwn(ACTIONS, name);
}
