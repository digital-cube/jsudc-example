import type { CalendarOptions, CalendarPreset, FilterNode, Row, SchemaDoc } from "@jsudc/core";
import {
  addDays,
  addMonths,
  type CivilDay,
  DAY,
  dayOf,
  daysBetween,
  formatDay,
  isoInZone,
  MINUTE,
  minuteOfDay,
  startOfDay,
  weekdayOf,
  zonedToInstant,
} from "../time/zoned";

/*
 * The calendar's pure half: which days a preset shows, the window the server
 * is asked for, events from rows, overlap lanes, snapping, and the patch a
 * move writes. Every instant is computed in the display zone.
 */

export interface CalendarWindow {
  preset: CalendarPreset;
  anchor: CivilDay;
  /** The columns (time grids) or cells (month), in order. */
  days: CivilDay[];
  /** 00:00 of the first day, in the zone. */
  from: number;
  /** The last millisecond of the last day, in the zone. */
  to: number;
}

/** The first day of the week `day` is in. */
export function weekStart(day: CivilDay, startsOn: CalendarOptions["week_starts_on"]): CivilDay {
  const first = startsOn === "sunday" ? 0 : 1;
  return addDays(day, -((weekdayOf(day) - first + 7) % 7));
}

/** The days a preset shows around `anchor`. */
export function presetDays(
  preset: CalendarPreset,
  anchor: CivilDay,
  opts: Pick<CalendarOptions, "week_starts_on" | "workweek_days">,
): CivilDay[] {
  const run = (from: CivilDay, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));
  switch (preset) {
    case "day":
      return [anchor];
    case "workweek":
      return run(weekStart(anchor, opts.week_starts_on), opts.workweek_days);
    case "week":
      return run(weekStart(anchor, opts.week_starts_on), 7);
    case "biweekly":
      return run(weekStart(anchor, opts.week_starts_on), 14);
    case "month": {
      const first = { ...anchor, d: 1 };
      const last = addDays(addMonths(first, 1), -1);
      const start = weekStart(first, opts.week_starts_on);
      const weeks = Math.ceil((daysBetween(start, last) + 1) / 7);
      return run(start, weeks * 7);
    }
  }
}

export function computeWindow(
  preset: CalendarPreset,
  anchor: CivilDay,
  opts: Pick<CalendarOptions, "week_starts_on" | "workweek_days">,
  timeZone: string,
): CalendarWindow {
  const days = presetDays(preset, anchor, opts);
  const first = days[0] ?? anchor;
  const last = days.at(-1) ?? anchor;
  return {
    preset,
    anchor,
    days,
    from: startOfDay(first, timeZone),
    to: startOfDay(addDays(last, 1), timeZone) - 1,
  };
}

/** The `between` values of a window: ISO with the zone's offset, both ends included. */
export function windowBetween(win: CalendarWindow, timeZone: string): [string, string] {
  return [isoInZone(win.from, timeZone, true), isoInZone(win.to, timeZone, true)];
}

/** The data view's filter and the window, as one `list` filter. */
export function windowFilter(
  base: FilterNode | undefined,
  opts: Pick<CalendarOptions, "start_field">,
  win: CalendarWindow,
  timeZone: string,
): FilterNode {
  const within: FilterNode = {
    field: opts.start_field,
    op: "between",
    value: windowBetween(win, timeZone),
  };
  return base ? { and: [base, within] } : within;
}

/** The anchor one step back (`-1`) or on (`1`): a day, a week, two weeks or a month. */
export function stepAnchor(preset: CalendarPreset, anchor: CivilDay, dir: 1 | -1): CivilDay {
  switch (preset) {
    case "day":
      return addDays(anchor, dir);
    case "workweek":
    case "week":
      return addDays(anchor, 7 * dir);
    case "biweekly":
      return addDays(anchor, 14 * dir);
    case "month":
      return addMonths({ ...anchor, d: 1 }, dir);
  }
}

/** `Tue, Oct 27, 2026`, `Oct 26 – 30, 2026`, `October 2026`: the toolbar's title. */
export function windowLabel(win: CalendarWindow, intlLocale: string): string {
  if (win.preset === "day") {
    return formatDay(win.anchor, intlLocale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  if (win.preset === "month") {
    return formatDay(win.anchor, intlLocale, { month: "long", year: "numeric" });
  }
  const first = win.days[0] ?? win.anchor;
  const last = win.days.at(-1) ?? win.anchor;
  const fmt = new Intl.DateTimeFormat(intlLocale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const noon = (d: CivilDay) => new Date(Date.UTC(d.y, d.m - 1, d.d, 12));
  return fmt.formatRange(noon(first), noon(last));
}

// --- events -----------------------------------------------------------------------------

export interface CalendarEvent {
  id: string;
  row: Row;
  start: number;
  end: number;
  title: string;
  color: string | null;
}

/** The fallback an event without a `color_map` entry is drawn in. */
export const ACCENT = "var(--primary)";

export function eventColor(row: Row, opts: CalendarOptions): string | null {
  if (!opts.color_field) return null;
  const v = row[opts.color_field];
  if (v === null || v === undefined) return null;
  return opts.color_map[String(v)] ?? null;
}

const DEFAULT_LENGTH_MIN = 60;

/** Rows with a start become events; an end missing or before the start makes it an hour long. */
export function toEvents(rows: readonly Row[], opts: CalendarOptions): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const row of rows) {
    const start = Date.parse(String(row[opts.start_field] ?? ""));
    if (Number.isNaN(start)) continue;
    const rawEnd = Date.parse(String(row[opts.end_field] ?? ""));
    const end =
      Number.isNaN(rawEnd) || rawEnd <= start ? start + DEFAULT_LENGTH_MIN * MINUTE : rawEnd;
    const title = row[opts.title_field];
    out.push({
      id: row.__meta.id,
      row,
      start,
      end,
      title: title === null || title === undefined || title === "" ? "—" : String(title),
      color: eventColor(row, opts),
    });
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

/** An event that is a day or longer, or crosses midnight: drawn in the all-day row. */
export function isAllDay(ev: Pick<CalendarEvent, "start" | "end">, timeZone: string): boolean {
  if (ev.end - ev.start >= DAY) return true;
  const a = dayOf(ev.start, timeZone);
  const b = dayOf(ev.end - 1, timeZone);
  return a.y !== b.y || a.m !== b.m || a.d !== b.d;
}

/** The events of one day column: those starting that day (timed ones only). */
export function eventsOnDay(
  events: readonly CalendarEvent[],
  day: CivilDay,
  timeZone: string,
): CalendarEvent[] {
  const from = startOfDay(day, timeZone);
  const to = startOfDay(addDays(day, 1), timeZone);
  return events.filter((e) => e.start >= from && e.start < to);
}

/** Where a timed event sits in its day: minutes from 00:00 on the zone's clock. */
export function verticalSpan(
  ev: Pick<CalendarEvent, "start" | "end">,
  day: CivilDay,
  timeZone: string,
): { top: number; bottom: number } {
  const top = minuteOfDay(ev.start, timeZone);
  const nextDay = startOfDay(addDays(day, 1), timeZone);
  const bottom = ev.end >= nextDay ? 24 * 60 : minuteOfDay(ev.end, timeZone);
  return { top, bottom: Math.max(bottom, top) };
}

export interface Lane {
  lane: number;
  /** Lanes in the event's cluster: the column is split this many ways. */
  lanes: number;
}

/**
 * Side-by-side lanes for one day: events that overlap (transitively) form a
 * cluster; each takes the first lane free at its start; the cluster is as
 * wide as its busiest moment needs. Touching ends do not overlap.
 */
export function layoutLanes(
  events: readonly Pick<CalendarEvent, "id" | "start" | "end">[],
): Map<string, Lane> {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = new Map<string, Lane>();
  let cluster: string[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  const close = () => {
    for (const id of cluster) {
      const l = out.get(id);
      if (l) l.lanes = laneEnds.length;
    }
    cluster = [];
    laneEnds = [];
  };
  for (const ev of sorted) {
    if (ev.start >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= ev.start);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(ev.end);
    } else {
      laneEnds[lane] = ev.end;
    }
    out.set(ev.id, { lane, lanes: 0 });
    cluster.push(ev.id);
    clusterEnd = Math.max(clusterEnd, ev.end);
  }
  close();
  return out;
}

// --- writes -----------------------------------------------------------------------------

/** Minutes rounded to the nearest multiple of `snap`. */
export function snapMinutes(minutes: number, snap: number): number {
  return Math.round(minutes / snap) * snap;
}

/** A wall time on `day`, `minutes` after its 00:00, as an instant in the zone. */
export function instantAt(day: CivilDay, minutes: number, timeZone: string): number {
  const whole = Math.round(minutes);
  const extraDays = Math.floor(whole / (24 * 60));
  const rest = whole - extraDays * 24 * 60;
  const d = addDays(day, extraDays);
  return zonedToInstant({ ...d, hh: Math.floor(rest / 60), mm: rest % 60 }, timeZone);
}

/**
 * What a move or resize writes: the option's own start / end fields (never a
 * hardcoded `start`/`end`), as ISO with the display zone's offset.
 */
export function movePatch(
  opts: Pick<CalendarOptions, "start_field" | "end_field">,
  start: number,
  end: number,
  timeZone: string,
): Record<string, string> {
  return {
    [opts.start_field]: isoInZone(start, timeZone),
    [opts.end_field]: isoInZone(end, timeZone),
  };
}

export type DragKind = "move" | "resize-start" | "resize-end";

/**
 * Where a dragged event ends up: `deltaMin` snapped, `dayShift` columns over.
 * A move keeps the length; a resize keeps the other end and never goes under
 * `min_event_minutes`.
 */
export function dragResult(
  ev: Pick<CalendarEvent, "start" | "end">,
  kind: DragKind,
  deltaMin: number,
  dayShift: number,
  opts: Pick<CalendarOptions, "snap_minutes" | "min_event_minutes">,
  timeZone: string,
): { start: number; end: number } {
  const startDay = dayOf(ev.start, timeZone);
  const startMin = minuteOfDay(ev.start, timeZone);
  const length = ev.end - ev.start;
  const min = opts.min_event_minutes * MINUTE;
  if (kind === "move") {
    const top = snapMinutes(startMin + deltaMin, opts.snap_minutes);
    const start = instantAt(addDays(startDay, dayShift), Math.max(0, top), timeZone);
    return { start, end: start + length };
  }
  if (kind === "resize-end") {
    const endDay = dayOf(ev.end, timeZone);
    const endMin = snapMinutes(minuteOfDay(ev.end, timeZone) + deltaMin, opts.snap_minutes);
    const end = instantAt(endDay, endMin, timeZone);
    return { start: ev.start, end: Math.max(end, ev.start + min) };
  }
  const top = snapMinutes(startMin + deltaMin, opts.snap_minutes);
  const start = instantAt(startDay, Math.max(0, top), timeZone);
  return { start: Math.min(start, ev.end - min), end: ev.end };
}

/** A month-grid move: the start's wall time and the length kept, the day changed. */
export function moveToDay(
  ev: Pick<CalendarEvent, "start" | "end">,
  day: CivilDay,
  timeZone: string,
): { start: number; end: number } {
  const start = instantAt(day, minuteOfDay(ev.start, timeZone), timeZone);
  return { start, end: start + (ev.end - ev.start) };
}

/**
 * The row a click on empty time inserts, or `null` when the schema has a
 * required field the calendar cannot fill. An enum is filled from `prefill`
 * (the active chip) or its first value; nothing else is guessed.
 */
export function newEventRow(args: {
  opts: CalendarOptions;
  schema: SchemaDoc;
  title: string;
  start: number;
  timeZone: string;
  prefill?: Record<string, unknown>;
}): Record<string, unknown> | null {
  const { opts, schema, title, start, timeZone } = args;
  const length = Math.max(opts.min_event_minutes, DEFAULT_LENGTH_MIN) * MINUTE;
  const row: Record<string, unknown> = {
    [opts.title_field]: title,
    ...movePatch(opts, start, start + length, timeZone),
  };
  for (const [name, def] of Object.entries(schema.fields)) {
    if (def.deleted || name in row) continue;
    const pre = args.prefill?.[name];
    if (pre !== undefined && pre !== null) {
      row[name] = pre;
      continue;
    }
    if (!def.required) continue;
    if (def.type === "enum" && def.values?.[0] !== undefined) row[name] = def.values[0];
    else return null;
  }
  return row;
}

/** Whether `newEventRow` can produce a row for this schema at all. */
export function canCreate(opts: CalendarOptions, schema: SchemaDoc): boolean {
  return (
    newEventRow({ opts, schema, title: "x", start: 0, timeZone: "UTC" }) !== null &&
    !!schema.fields[opts.title_field]
  );
}
