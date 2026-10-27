import { describe, expect, it } from "vitest";
import {
  CalendarOptionsSchema,
  calendarOptionsProblems,
  SchemaDocSchema,
  ViewConfigSchema,
} from "../src/index.js";

describe("CalendarOptions", () => {
  it("fills every default from an empty block", () => {
    expect(CalendarOptionsSchema.parse({})).toEqual({
      start_field: "start",
      end_field: "end",
      title_field: "title",
      color_map: {},
      default_preset: "week",
      available_presets: ["day", "workweek", "week", "month"],
      workweek_days: 5,
      snap_minutes: 15,
      min_event_minutes: 15,
      business_hours: [9, 18],
      hour_height_px: 48,
      show_now_line: true,
      week_starts_on: "monday",
      month_max_chips_per_day: 4,
    });
  });

  it("normalises detail fields to {field, editable?} and defaults delete", () => {
    const opts = CalendarOptionsSchema.parse({
      detail: { fields: ["title", { field: "room", editable: true }] },
    });
    expect(opts.detail).toEqual({
      fields: [{ field: "title" }, { field: "room", editable: true }],
      delete: false,
    });
  });

  it("accepts biweekly and drops preset names jsudc does not draw (dclabs ndays)", () => {
    const opts = CalendarOptionsSchema.parse({
      available_presets: ["day", "ndays", "workweek", "week", "biweekly", "month"],
      default_preset: "workweek",
      n_days: 3,
      calendar_colors: {},
    });
    expect(opts.available_presets).toEqual(["day", "workweek", "week", "biweekly", "month"]);
    // Loose: keys jsudc does not read survive.
    expect(opts).toHaveProperty("n_days", 3);
  });

  it.each([
    [{ business_hours: [18, 9] }, "business_hours"],
    [{ default_preset: "month", available_presets: ["day", "week"] }, "default_preset"],
    [{ available_presets: [] }, "available_presets"],
    [{ default_preset: "year" }, "default_preset"],
    [{ snap_minutes: 0 }, "snap_minutes"],
  ])("refuses %j", (block, path) => {
    const res = CalendarOptionsSchema.safeParse(block);
    expect(res.success).toBe(false);
    expect(res.error?.issues.map((i) => i.path[0])).toContain(path);
  });

  it("is validated inside a view", () => {
    expect(ViewConfigSchema.safeParse({ calendar_options: { hour_height_px: 2 } }).success).toBe(
      false,
    );
    const view = ViewConfigSchema.parse({
      available_renderers: ["calendar", "table"],
      calendar_options: { start_field: "starts_at", end_field: "ends_at" },
    });
    expect(view.calendar_options?.snap_minutes).toBe(15);
  });
});

describe("calendarOptionsProblems", () => {
  const schema = SchemaDocSchema.parse({
    version: "v1",
    fields: {
      title: { type: "string" },
      start: { type: "datetime" },
      end: { type: "datetime" },
      day: { type: "date" },
      doctor: { type: "enum", values: ["a", "b"] },
      gone: { type: "datetime", deleted: true },
    },
  });
  const problems = (block: Record<string, unknown>) =>
    calendarOptionsProblems(CalendarOptionsSchema.parse(block), schema);

  it("is empty when every field fits", () => {
    expect(
      problems({ color_field: "doctor", detail: { fields: ["title", { field: "doctor" }] } }),
    ).toEqual([]);
  });

  it("names a missing, deleted or non-datetime start/end", () => {
    expect(problems({ start_field: "begins" })).toEqual([
      "start_field: begins is not a field of the schema",
    ]);
    expect(problems({ end_field: "gone" })).toEqual([
      "end_field: gone is not a field of the schema",
    ]);
    expect(problems({ start_field: "day" })).toEqual([
      "start_field: day is date, a calendar needs datetime",
    ]);
  });

  it("names a missing title, colour or detail field", () => {
    expect(
      problems({ title_field: "name", color_field: "dentist", detail: { fields: ["note"] } }),
    ).toEqual([
      "title_field: name is not a field of the schema",
      "color_field: dentist is not a field of the schema",
      "detail.fields[0]: note is not a field of the schema",
    ]);
  });
});
