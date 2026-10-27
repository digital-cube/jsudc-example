import { z } from "zod";
import { FilterNodeSchema, FilterOpSchema } from "./filter.js";
import { PageRequestSchema, SortKeySchema } from "./query.js";
import { RowSchema } from "./row.js";
import { FieldDefSchema, FieldNameSchema, FieldTypeSchema, SchemaDocSchema } from "./schema.js";
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

export const DescribeResponseSchema = z.object({
  collection: z.string().min(1),
  capabilities: CapabilitiesSchema,
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
} as const satisfies Record<string, { request: z.ZodType; response: z.ZodType }>;

export type ActionName = keyof typeof ACTIONS;
export type ActionRequest<A extends ActionName> = z.output<(typeof ACTIONS)[A]["request"]>;
export type ActionResponse<A extends ActionName> = z.output<(typeof ACTIONS)[A]["response"]>;

export const ACTION_NAMES = Object.keys(ACTIONS) as ActionName[];

export function isActionName(name: unknown): name is ActionName {
  return typeof name === "string" && Object.hasOwn(ACTIONS, name);
}
