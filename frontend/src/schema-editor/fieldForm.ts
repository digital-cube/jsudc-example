import {
  FIELD_NAME_RE,
  type FieldDef,
  type FieldType,
  PHASE1_FIELD_TYPES,
  type SchemaDoc,
  type SchemaPosition,
} from "@jsudc/core";

/** What the schema editor opens: from a column menu item or the trailing `+`. */
export type SchemaAction =
  | { kind: "add"; position: SchemaPosition }
  | { kind: "edit"; field: string }
  | { kind: "delete"; field: string };

/** The types a new column may have: the ones udc-core says the server can store. */
export const FORM_TYPES: readonly FieldType[] = PHASE1_FIELD_TYPES;

export const DEFAULT_STRING_LENGTH = 255;

/** The field form's state: text inputs stay strings until they are submitted. */
export interface FieldDraft {
  name: string;
  type: FieldType;
  labelEn: string;
  labelSr: string;
  required: boolean;
  index: boolean;
  length: string;
  min: string;
  max: string;
  values: string[];
}

export type DraftKey = "name" | "length" | "min" | "max" | "values";

/** Per control, the `APP` translation term of what is wrong with it. */
export type DraftErrors = Partial<Record<DraftKey, string>>;

/** Which type-specific controls a type has. */
export function typeControls(type: FieldType): {
  length: boolean;
  range: boolean;
  values: boolean;
} {
  return {
    length: type === "string",
    range: type === "integer" || type === "decimal" || type === "year",
    values: type === "enum",
  };
}

export function emptyDraft(): FieldDraft {
  return {
    name: "",
    type: "string",
    labelEn: "",
    labelSr: "",
    required: false,
    index: false,
    length: String(DEFAULT_STRING_LENGTH),
    min: "",
    max: "",
    values: [],
  };
}

const num = (v: number | undefined) => (v === undefined ? "" : String(v));

/** The form state for editing an existing field. */
export function draftFromDef(name: string, def: FieldDef): FieldDraft {
  const label = (def as { label?: unknown }).label;
  const labels =
    typeof label === "string"
      ? { en: label, sr: label }
      : label && typeof label === "object"
        ? (label as Record<string, unknown>)
        : {};
  return {
    name,
    type: def.type,
    labelEn: typeof labels.en === "string" ? labels.en : "",
    labelSr: typeof labels.sr === "string" ? labels.sr : "",
    required: def.required === true,
    index: def.index === true,
    length: num(def.length),
    min: num(def.min),
    max: num(def.max),
    values: [...(def.values ?? [])],
  };
}

/** What is wrong with the name alone (`null` when it is fine); checked as the user types. */
export function nameProblem(
  name: string,
  mode: "add" | "edit",
  schema: Pick<SchemaDoc, "fields">,
): string | null {
  if (mode === "edit") return null;
  if (!name) return "ERR_NAME_REQUIRED";
  if (!FIELD_NAME_RE.test(name)) return "ERR_NAME_INVALID";
  if (Object.hasOwn(schema.fields, name)) return "ERR_NAME_TAKEN";
  return null;
}

const parseNum = (s: string): number | null | undefined => {
  if (s.trim() === "") return undefined;
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : null;
};

/** Every problem of the draft; empty when it may be sent. */
export function validateDraft(
  draft: FieldDraft,
  mode: "add" | "edit",
  schema: Pick<SchemaDoc, "fields">,
): DraftErrors {
  const errors: DraftErrors = {};
  const name = nameProblem(draft.name, mode, schema);
  if (name) errors.name = name;

  const controls = typeControls(draft.type);
  if (controls.length) {
    const n = parseNum(draft.length);
    if (n === undefined) errors.length = "ERR_LENGTH_REQUIRED";
    else if (n === null || !Number.isInteger(n) || n < 1) errors.length = "ERR_LENGTH";
  }
  if (controls.range) {
    const whole = draft.type !== "decimal";
    const min = parseNum(draft.min);
    const max = parseNum(draft.max);
    for (const [key, v] of [
      ["min", min],
      ["max", max],
    ] as const) {
      if (v === null) errors[key] = "ERR_NUMBER";
      else if (v !== undefined && whole && !Number.isInteger(v)) errors[key] = "ERR_INTEGER";
    }
    if (!errors.min && !errors.max && min != null && max != null && min > max) {
      errors.max = "ERR_MIN_MAX";
    }
  }
  if (controls.values) {
    if (draft.values.length === 0) errors.values = "ERR_VALUES_REQUIRED";
    else if (new Set(draft.values).size !== draft.values.length) errors.values = "ERR_VALUES_DUP";
  }
  return errors;
}

const MANAGED = ["required", "index", "length", "min", "max", "values", "label"] as const;

/**
 * The `fielddef` a valid draft sends. In edit mode `base` is the current
 * def: keys the form does not manage (a `description`, udc-py extras) are
 * kept, the managed ones are rewritten from the draft.
 */
export function draftToFieldDef(draft: FieldDraft, base?: FieldDef): FieldDef {
  const kept: Record<string, unknown> = { ...(base ?? {}) };
  for (const k of MANAGED) delete kept[k];
  delete kept.deleted;

  const def: Record<string, unknown> = { ...kept, type: draft.type };
  if (draft.required) def.required = true;
  if (draft.index) def.index = true;
  const controls = typeControls(draft.type);
  if (controls.length && draft.length.trim()) def.length = Number(draft.length);
  if (controls.range) {
    if (draft.min.trim()) def.min = Number(draft.min);
    if (draft.max.trim()) def.max = Number(draft.max);
  }
  if (controls.values) def.values = [...draft.values];

  const en = draft.labelEn.trim();
  const sr = draft.labelSr.trim();
  if (en || sr) def.label = { ...(en ? { en } : {}), ...(sr ? { sr } : {}) };
  return def as FieldDef;
}

/** `"Website"` → `"website"`: a name suggestion from the English label, for add mode. */
export function suggestName(label: string): string {
  const s = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "dj")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "");
  return s.slice(0, 63);
}
