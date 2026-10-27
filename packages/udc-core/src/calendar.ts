import { z } from "zod";
import type { SchemaDoc } from "./schema.js";

const Field = z.string().min(1);

/** The calendar's views of time. `biweekly` parses for dclabs views; jsudc draws it as two weeks. */
export const CALENDAR_PRESETS = ["day", "workweek", "week", "biweekly", "month"] as const;
export const CalendarPresetSchema = z.enum(CALENDAR_PRESETS);
export type CalendarPreset = z.infer<typeof CalendarPresetSchema>;

export function isCalendarPreset(name: unknown): name is CalendarPreset {
  return (CALENDAR_PRESETS as readonly unknown[]).includes(name);
}

export const CalendarDetailFieldSchema = z.looseObject({
  field: Field,
  /** Edited in place with the table's cell editor. */
  editable: z.boolean().optional(),
});

/** `fields` entries are a bare field name or `{field, editable}`. */
export const CalendarDetailSchema = z.looseObject({
  fields: z
    .array(z.union([Field, CalendarDetailFieldSchema]))
    .default([])
    .transform((fields) => fields.map((f) => (typeof f === "string" ? { field: f } : f))),
  /** A Delete button in the event popover. */
  delete: z.boolean().default(false),
});

const Hour = z.number().min(0).max(24);

// Loose, as every view block: a dclabs `calendar_options` carries keys jsudc
// does not read (calendar_colors, overridable_errors, n_days) and must still
// parse. Every key declared here is one the calendar renderer reads.
export const CalendarOptionsSchema = z
  .looseObject({
    /** A `datetime` field: where the event starts. */
    start_field: Field.default("start"),
    /** A `datetime` field: where the event ends. */
    end_field: Field.default("end"),
    title_field: Field.default("title"),
    /** The field whose value picks the event's colour from `color_map`. */
    color_field: Field.optional(),
    /** Field value → CSS colour; a value missing here gets the accent. */
    color_map: z.record(z.string(), z.string()).default({}),
    default_preset: CalendarPresetSchema.default("week"),
    /** Unknown names (dclabs `ndays`) are dropped, so a dclabs block parses. */
    available_presets: z
      .array(z.string())
      .transform((names) => names.filter(isCalendarPreset))
      .pipe(z.array(CalendarPresetSchema).min(1))
      .default(["day", "workweek", "week", "month"]),
    /** Days a work week shows, from the week's first day. */
    workweek_days: z.number().int().min(1).max(7).default(5),
    snap_minutes: z.number().int().min(1).max(240).default(15),
    min_event_minutes: z.number().int().min(1).default(15),
    /** `[from, to]` in hours of the day, shaded as working time. */
    business_hours: z.tuple([Hour, Hour]).default([9, 18]),
    hour_height_px: z.number().int().min(16).max(240).default(48),
    show_now_line: z.boolean().default(true),
    week_starts_on: z.enum(["monday", "sunday"]).default("monday"),
    month_max_chips_per_day: z.number().int().min(1).default(4),
    /** Where the time grid scrolls to on open (hours, 7.5 = 07:30); else the first business hour. */
    scroll_to_hour: Hour.optional(),
    detail: CalendarDetailSchema.optional(),
  })
  .superRefine((o, ctx) => {
    if (o.business_hours[0] >= o.business_hours[1]) {
      ctx.addIssue({ code: "custom", path: ["business_hours"], message: "from must be before to" });
    }
    if (!o.available_presets.includes(o.default_preset)) {
      ctx.addIssue({
        code: "custom",
        path: ["default_preset"],
        message: "default_preset must be one of available_presets",
      });
    }
  });

export type CalendarOptionsInput = z.input<typeof CalendarOptionsSchema>;
export type CalendarOptions = z.output<typeof CalendarOptionsSchema>;

/**
 * What a schema says against a calendar block: start and end must be
 * `datetime` fields, and every other field the calendar reads must exist.
 * Empty when the block fits. The registry refuses a collection otherwise.
 */
export function calendarOptionsProblems(opts: CalendarOptions, schema: SchemaDoc): string[] {
  const problems: string[] = [];
  const live = (f: string) => {
    const def = schema.fields[f];
    return def && !def.deleted ? def : undefined;
  };
  for (const key of ["start_field", "end_field"] as const) {
    const def = live(opts[key]);
    if (!def) problems.push(`${key}: ${opts[key]} is not a field of the schema`);
    else if (def.type !== "datetime") {
      problems.push(`${key}: ${opts[key]} is ${def.type}, a calendar needs datetime`);
    }
  }
  const read = [
    ["title_field", opts.title_field],
    ...(opts.color_field ? [["color_field", opts.color_field]] : []),
    ...(opts.detail?.fields ?? []).map((f, i) => [`detail.fields[${i}]`, f.field]),
  ];
  for (const [key, field] of read) {
    if (field && !live(field)) problems.push(`${key}: ${field} is not a field of the schema`);
  }
  return problems;
}
