import { z } from "zod";

const Field = z.string().min(1);

// Loose, as every view block: a dclabs `kanban_options` carries keys jsudc
// does not read (assignees collections, lazy loading) and must still parse.
// Every key declared here is one the kanban renderer reads.

export const KanbanCardFieldsSchema = z.looseObject({
  title_field: Field,
  body_field: Field.optional(),
  priority_field: Field.optional(),
  tags_field: Field.optional(),
  due_field: Field.optional(),
  /** A `string_array` of names; the card shows their initials. */
  assignees_field: Field.optional(),
  footer_fields: z.array(Field).optional(),
});

export const KanbanCardsSchema = z.looseObject({
  title_lines: z.number().int().min(1).max(10).default(3),
  body_lines: z.number().int().min(0).max(20).default(2),
  show_priority_left_border: z.boolean().default(true),
  tags_max_visible: z.number().int().min(0).default(4),
  density: z.enum(["comfortable", "compact"]).default("comfortable"),
});

export const KanbanBucketsSchema = z.looseObject({
  /** Cards drawn per column before a "show more". */
  max_visible_tickets: z.number().int().min(1).default(50),
  show_count: z.boolean().default(true),
  show_add_ticket_button: z.boolean().default(true),
  min_width_px: z.number().int().min(160).default(280),
});

export const KanbanBoardSchema = z.looseObject({
  /** The `+ Add bucket` slot after the last column. */
  extendable_with_buckets: z.boolean().default(true),
  /** Columns reorder by dragging their headers. */
  buckets_sortable: z.boolean().default(true),
});

export const KanbanPermissionsSchema = z.looseObject({
  read_only: z.boolean().default(false),
});

export const KanbanOptionsSchema = z.looseObject({
  /** The collection whose rows are the columns. */
  bucket_collection: Field,
  /** The bucket field holding the board id. */
  bucket_filter_field: Field,
  bucket_order_field: Field.default("order"),
  bucket_label_field: Field.default("name"),
  bucket_color_field: Field.optional(),
  /** The card field holding the board id (denormalised, so one filter lists a board). */
  ticket_board_field: Field,
  /** The card field holding the bucket id. */
  ticket_bucket_field: Field,
  ticket_order_field: Field.default("order"),
  card: KanbanCardFieldsSchema,
  cards: KanbanCardsSchema.prefault({}),
  buckets: KanbanBucketsSchema.prefault({}),
  board: KanbanBoardSchema.prefault({}),
  permissions: KanbanPermissionsSchema.prefault({}),
});

export type KanbanOptionsInput = z.input<typeof KanbanOptionsSchema>;
export type KanbanOptions = z.output<typeof KanbanOptionsSchema>;
