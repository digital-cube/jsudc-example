import { z } from "zod";
import { CalendarOptionsSchema } from "./calendar.js";
import { FilterNodeSchema, FilterOpSchema } from "./filter.js";
import { KanbanOptionsSchema } from "./kanban.js";
import { TreeOptionsSchema } from "./tree.js";

// Every block is loose: dclabs views carry renderer-specific option blocks
// and keys jsudc does not read yet, and they must parse without edits.

/**
 * The renderer names jsudc knows. `available_renderers` stays an open list:
 * an unknown name parses, and the UI shows its tab disabled.
 */
export const RENDERER_NAMES = [
  "table",
  "cards",
  "kanban",
  "calendar",
  "tree",
  "map",
  "chart",
] as const;
export type RendererName = (typeof RENDERER_NAMES)[number];

export function isRendererName(name: unknown): name is RendererName {
  return (RENDERER_NAMES as readonly unknown[]).includes(name);
}

export const COLUMN_COLORS = [
  "default",
  "accent",
  "success",
  "warning",
  "danger",
  "info",
  "muted",
] as const;

export const ColumnColorSchema = z.enum(COLUMN_COLORS);
export type ColumnColor = z.infer<typeof ColumnColorSchema>;

export const ColumnConfigSchema = z.looseObject({
  field: z.string().min(1),
  /** Column identity when one field backs two columns; defaults to `field`. */
  id: z.string().min(1).optional(),
  pin: z.enum(["left", "right"]).nullable().optional(),
  editable: z.boolean().optional(),
  width: z.number().positive().optional(),
  /** Open: `text | number_format | bool | date` in phase 1, more later. */
  render: z.string().optional(),
  render_options: z.record(z.string(), z.unknown()).optional(),
  align: z.enum(["left", "right", "center"]).optional(),
  /** Open: `titlecase`, `truncate:N`, `date_format:PATTERN`, or a pipeline of them. */
  transform: z.union([z.string(), z.array(z.string())]).optional(),
  color: ColumnColorSchema.optional(),
  bg: ColumnColorSchema.optional(),
});

export type ColumnConfig = z.infer<typeof ColumnConfigSchema>;

export const SearchConfigSchema = z.looseObject({
  fields: z.array(z.string()),
  placeholder: z.string().optional(),
  case_insensitive: z.boolean().default(true),
});

export type SearchConfig = z.infer<typeof SearchConfigSchema>;

const ChipOptionSchema = z.union([z.string(), z.number(), z.boolean()]);

export const FilterChipConfigSchema = z.looseObject({
  field: z.string().min(1),
  kind: z.enum(["select", "range", "bool"]),
  label: z.string().optional(),
  options: z.array(ChipOptionSchema).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
});

export type FilterChipConfig = z.infer<typeof FilterChipConfigSchema>;

export const FilterableFieldConfigSchema = z.looseObject({
  field: z.string().min(1),
  ops: z.array(FilterOpSchema).optional(),
  default_op: FilterOpSchema.optional(),
  label: z.string().optional(),
  widget: z.string().optional(),
  values: z.array(z.unknown()).optional(),
});

/** `fields` entries are a bare field name or a per-field override block. */
export const FilterableConfigSchema = z.looseObject({
  fields: z.array(z.union([z.string().min(1), FilterableFieldConfigSchema])).default([]),
  /** Per field type: the op the builder preselects. */
  default_op: z.record(z.string(), FilterOpSchema).optional(),
});

export type FilterableConfig = z.infer<typeof FilterableConfigSchema>;

export const CardOptionsSchema = z.looseObject({
  title_field: z.string().optional(),
  subtitle_field: z.string().optional(),
  image_field: z.string().optional(),
  meta_fields: z.array(z.string()).optional(),
  /** dclabs spells the ends `sm` / `lg`; both spellings parse. */
  size: z.enum(["sm", "small", "medium", "lg", "large"]).optional(),
});

export type CardOptions = z.infer<typeof CardOptionsSchema>;

export const RowColorRuleSchema = z.looseObject({
  value: z.unknown().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  else: z.boolean().optional(),
  color: ColumnColorSchema.optional(),
  bg: ColumnColorSchema.optional(),
});

export const RowColorConfigSchema = z.looseObject({
  apply: z.boolean().optional(),
  field: z.string().min(1),
  rules: z.array(RowColorRuleSchema),
});

export type RowColorConfig = z.infer<typeof RowColorConfigSchema>;

// Phase 2: declared so dclabs views parse; the phase-1 renderers ignore them.

export const ActionDefSchema = z.looseObject({
  kind: z.string().min(1),
  label: z.string().optional(),
  /** Eligibility predicate over `row.__meta.state`; omitted means always. */
  when: z.union([FilterNodeSchema, z.boolean()]).optional(),
  icon: z.string().optional(),
  variant: z.enum(["default", "outline", "destructive"]).optional(),
});

export type ActionDef = z.infer<typeof ActionDefSchema>;

export const EditModeConfigSchema = z.looseObject({
  enabled: z.boolean().default(true),
  default_enabled: z.boolean().default(false),
  enter_policy: z.enum(["edit_mode", "double_click"]).default("edit_mode"),
});

export const PreviewConfigSchema = z.looseObject({
  placement: z.enum(["modal", "right_drawer"]).optional(),
  renderer: z.string().optional(),
});

export const ViewConfigSchema = z.looseObject({
  default_renderer: z.string().min(1).default("table"),
  available_renderers: z.array(z.string().min(1)).default(["table"]),
  columns: z.array(ColumnConfigSchema).default([]),
  page_size_default: z.number().int().min(1).max(1000).default(50),
  pagination: z.enum(["infinite", "pages"]).default("infinite"),
  row_height: z.number().positive().optional(),
  default_column_width: z.number().positive().default(160),
  search: SearchConfigSchema.optional(),
  filters: z.array(FilterChipConfigSchema).optional(),
  filterable: FilterableConfigSchema.optional(),
  card_options: CardOptionsSchema.optional(),
  /** Validated when present: a typo in a field name fails at load, not on screen. */
  kanban_options: KanbanOptionsSchema.optional(),
  calendar_options: CalendarOptionsSchema.optional(),
  tree_options: TreeOptionsSchema.optional(),
  row_color: RowColorConfigSchema.optional(),

  row_actions: z.array(z.string()).default([]),
  row_action_defs: z.array(ActionDefSchema).optional(),
  bulk_actions: z.array(ActionDefSchema).optional(),
  multiselect: z.boolean().optional(),
  row_actions_display: z.enum(["inline", "menu"]).optional(),
  edit_mode: EditModeConfigSchema.optional(),
  preview: PreviewConfigSchema.optional(),
  refresh_interval_ms: z.number().int().positive().optional(),
});

export type ViewConfigInput = z.input<typeof ViewConfigSchema>;
export type ViewConfig = z.output<typeof ViewConfigSchema>;
