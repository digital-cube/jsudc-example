import { z } from "zod";

export const FIELD_NAME_RE = /^[a-z][a-z0-9_]{0,62}$/;

/** The field-name rule: the server's SQL allowlist and the schema form both use it. */
export function isValidFieldName(name: unknown): name is string {
  return typeof name === "string" && FIELD_NAME_RE.test(name);
}

export const FieldNameSchema = z
  .string()
  .regex(FIELD_NAME_RE, "field names are lowercase snake_case, 1-63 chars, starting with a letter");

/** Every type udc-py knows, so dclabs documents parse. */
export const FIELD_TYPES = [
  "string",
  "text",
  "integer",
  "year",
  "decimal",
  "bool",
  "date",
  "datetime",
  "image",
  "relation",
  "string_array",
  "rating",
  "json",
  "enum",
  "lookup",
  "lookup_array",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const FieldTypeSchema = z.enum(FIELD_TYPES);

/** The types jsudc can store, sort and filter in phase 1. */
export const PHASE1_FIELD_TYPES = [
  "string",
  "text",
  "integer",
  "decimal",
  "year",
  "bool",
  "date",
  "datetime",
  "json",
] as const satisfies readonly FieldType[];

export type Phase1FieldType = (typeof PHASE1_FIELD_TYPES)[number];

export function isPhase1Type(type: unknown): type is Phase1FieldType {
  return (PHASE1_FIELD_TYPES as readonly unknown[]).includes(type);
}

// Loose: udc-py field defs carry type-specific extras (rating_type, on_unknown, …).
export const FieldDefSchema = z
  .looseObject({
    type: FieldTypeSchema,
    length: z.number().int().positive().optional(),
    index: z.boolean().optional(),
    required: z.boolean().optional(),
    deleted: z.boolean().optional(),
    description: z.string().optional(),
    values: z.array(z.string()).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    ref: z.string().optional(),
    label_field: z.string().optional(),
  })
  .superRefine((def, ctx) => {
    if (def.type === "enum" && (!def.values || def.values.length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["values"],
        message: "enum needs a non-empty values list",
      });
    }
    if (def.min !== undefined && def.max !== undefined && def.min > def.max) {
      ctx.addIssue({ code: "custom", path: ["min"], message: "min is greater than max" });
    }
  });

export type FieldDef = z.infer<typeof FieldDefSchema>;

/**
 * `version` is the wire string (`"v1"`, `"v2"`, …). `field_order` may be
 * omitted on input; it defaults to the key order of `fields`, and any field
 * it leaves out is appended in that order.
 */
export const SchemaDocSchema = z
  .object({
    version: z.string().min(1),
    core_fields: z.array(z.string()).default([]),
    fields: z.record(FieldNameSchema, FieldDefSchema),
    field_order: z.array(z.string()).optional(),
  })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>();
    doc.field_order?.forEach((name, i) => {
      if (!(name in doc.fields)) {
        ctx.addIssue({
          code: "custom",
          path: ["field_order", i],
          message: `unknown field ${name}`,
        });
      }
      if (seen.has(name)) {
        ctx.addIssue({ code: "custom", path: ["field_order", i], message: `duplicate ${name}` });
      }
      seen.add(name);
    });
  })
  .transform((doc) => {
    const order = doc.field_order ?? [];
    const rest = Object.keys(doc.fields).filter((name) => !order.includes(name));
    return { ...doc, field_order: [...order, ...rest] };
  });

export type SchemaDocInput = z.input<typeof SchemaDocSchema>;
export type SchemaDoc = z.output<typeof SchemaDocSchema>;
