import {
  CalendarOptionsSchema,
  type DescribeResponse,
  type FilterNode,
  type Row,
  SchemaDocSchema,
  ViewConfigSchema,
} from "@jsudc/core";
import { UdcClient } from "@jsudc/core/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { CalendarRenderer, prefillFromFilter } from "../src/calendar/CalendarRenderer";
import {
  canCreate,
  computeWindow,
  dragResult,
  isAllDay,
  layoutLanes,
  movePatch,
  moveToDay,
  newEventRow,
  presetDays,
  snapMinutes,
  stepAnchor,
  toEvents,
  windowBetween,
  windowFilter,
  windowLabel,
} from "../src/calendar/model";
import { Toaster } from "../src/components/ui/toast";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { UdcI18nProvider } from "../src/i18n/i18n";
import { rendererEntry } from "../src/renderers/registry";
import type { RendererProps } from "../src/renderers/types";
import { CellValue } from "../src/table/cells";
import { applyTransforms } from "../src/table/transforms";
import { TimezoneProvider, TZ_STORAGE_KEY, useTimezone } from "../src/time/timezone";
import { dayKey } from "../src/time/zoned";
import type { UdcCollectionResult } from "../src/udc/hooks";
import { createUdcQueryClient, UdcProvider } from "../src/udc/provider";
import { listOf, mockUdcFetch, row } from "./fetchMock";

const BG = "Europe/Belgrade";
const TOKYO = "Asia/Tokyo";
const NY = "America/New_York";
const opts = CalendarOptionsSchema.parse({
  start_field: "start",
  end_field: "end",
  color_field: "doctor",
  color_map: { Ana: "#2563eb" },
  default_preset: "workweek",
  available_presets: ["day", "workweek", "week", "biweekly", "month"],
});
const day = { y: 2026, m: 10, d: 27 };
const keys = (days: { y: number; m: number; d: number }[]) => days.map(dayKey);

describe("calendar window", () => {
  it("lays out the days of each preset, weeks from Monday", () => {
    expect(keys(presetDays("day", day, opts))).toEqual(["2026-10-27"]);
    expect(keys(presetDays("workweek", day, opts))).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
    ]);
    expect(presetDays("week", day, opts).map(dayKey).at(-1)).toBe("2026-11-01");
    expect(presetDays("biweekly", day, opts)).toHaveLength(14);
    const month = presetDays("month", day, opts);
    expect(dayKey(month[0] ?? day)).toBe("2026-09-28");
    expect(dayKey(month.at(-1) ?? day)).toBe("2026-11-01");
    expect(month).toHaveLength(35);
  });

  it("starts the week on Sunday when asked", () => {
    const sunday = { ...opts, week_starts_on: "sunday" as const };
    expect(keys(presetDays("week", day, sunday))[0]).toBe("2026-10-25");
    expect(keys(presetDays("workweek", day, { ...opts, workweek_days: 6 })).at(-1)).toBe(
      "2026-10-31",
    );
  });

  it("asks for 00:00-24:00 of the visible days in the zone", () => {
    const win = computeWindow("workweek", day, opts, BG);
    expect(windowBetween(win, BG)).toEqual([
      "2026-10-26T00:00:00.000+01:00",
      "2026-10-30T23:59:59.999+01:00",
    ]);
    // The same date, Tokyo: other instants, Tokyo's offset.
    const tokyo = computeWindow("workweek", day, opts, TOKYO);
    expect(windowBetween(tokyo, TOKYO)).toEqual([
      "2026-10-26T00:00:00.000+09:00",
      "2026-10-30T23:59:59.999+09:00",
    ]);
    expect(tokyo.from).toBe(win.from - 8 * 3_600_000);
    // A week across the European DST change: summer offset at the start, winter at the end.
    const dst = computeWindow("week", { y: 2026, m: 10, d: 21 }, opts, BG);
    expect(windowBetween(dst, BG)).toEqual([
      "2026-10-19T00:00:00.000+02:00",
      "2026-10-25T23:59:59.999+01:00",
    ]);
    expect(dst.to + 1 - dst.from).toBe(7 * 86_400_000 + 3_600_000);
  });

  it("ANDs the window onto the data view's filter", () => {
    const win = computeWindow("day", day, opts, BG);
    const chip: FilterNode = { field: "doctor", op: "in", value: ["Ana"] };
    expect(windowFilter(chip, opts, win, BG)).toEqual({
      and: [
        chip,
        {
          field: "start",
          op: "between",
          value: ["2026-10-27T00:00:00.000+01:00", "2026-10-27T23:59:59.999+01:00"],
        },
      ],
    });
    expect(windowFilter(undefined, { start_field: "starts_at" }, win, BG)).toMatchObject({
      field: "starts_at",
      op: "between",
    });
  });

  it("steps by the preset and labels the window", () => {
    expect(dayKey(stepAnchor("day", day, -1))).toBe("2026-10-26");
    expect(dayKey(stepAnchor("workweek", day, 1))).toBe("2026-11-03");
    expect(dayKey(stepAnchor("biweekly", day, 1))).toBe("2026-11-10");
    expect(dayKey(stepAnchor("month", { y: 2026, m: 1, d: 31 }, 1))).toBe("2026-02-01");
    // ICU spaces ranges with thin spaces, and not the same in every version.
    const label = (p: "workweek" | "week") =>
      windowLabel(computeWindow(p, day, opts, BG), "en-GB").replace(/\s+/g, " ");
    expect(label("workweek")).toMatch(/^26 ?– ?30 Oct 2026$/);
    expect(label("week")).toBe("26 Oct – 1 Nov 2026");
    expect(windowLabel(computeWindow("month", day, opts, BG), "en-US")).toBe("October 2026");
  });
});

describe("calendar events", () => {
  const ev = (id: string, start: string, end: string) => ({
    id,
    start: Date.parse(start),
    end: Date.parse(end),
  });

  it("puts three overlapping events in three lanes, and a later one back in the first", () => {
    const lanes = layoutLanes([
      ev("a", "2026-10-27T08:00:00Z", "2026-10-27T10:00:00Z"),
      ev("b", "2026-10-27T08:30:00Z", "2026-10-27T09:30:00Z"),
      ev("c", "2026-10-27T09:00:00Z", "2026-10-27T11:00:00Z"),
      ev("d", "2026-10-27T10:00:00Z", "2026-10-27T10:30:00Z"),
      ev("e", "2026-10-27T12:00:00Z", "2026-10-27T13:00:00Z"),
    ]);
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 3 });
    expect(lanes.get("b")).toEqual({ lane: 1, lanes: 3 });
    expect(lanes.get("c")).toEqual({ lane: 2, lanes: 3 });
    // Starts as a ends: touching is not overlapping.
    expect(lanes.get("d")).toEqual({ lane: 0, lanes: 3 });
    expect(lanes.get("e")).toEqual({ lane: 0, lanes: 1 });
  });

  it("makes events from rows: colour from the map, no start no event, a missing end an hour", () => {
    const rows: Row[] = [
      row("1", 1, { title: "A", doctor: "Ana", start: "2026-10-27T08:00:00+01:00" }),
      row("2", 1, {
        title: "B",
        doctor: "Bo",
        start: "2026-10-27T07:00:00+01:00",
        end: "2026-10-27T07:30:00+01:00",
      }),
      row("3", 1, { title: "C", start: null }),
    ];
    const events = toEvents(rows, opts);
    expect(events.map((e) => e.id)).toEqual(["2", "1"]);
    expect(events[1]?.color).toBe("#2563eb");
    expect(events[0]?.color).toBeNull();
    expect((events[1]?.end ?? 0) - (events[1]?.start ?? 0)).toBe(3_600_000);
  });

  it("an event over midnight or a day long goes to the all-day row", () => {
    expect(isAllDay(ev("x", "2026-10-27T07:00:00Z", "2026-10-27T09:00:00Z"), BG)).toBe(false);
    expect(isAllDay(ev("x", "2026-10-27T22:00:00Z", "2026-10-28T01:00:00Z"), BG)).toBe(true);
    // Ends exactly at midnight: still that day.
    expect(isAllDay(ev("x", "2026-10-27T21:00:00Z", "2026-10-27T23:00:00Z"), BG)).toBe(false);
  });
});

describe("calendar writes", () => {
  const ev = {
    start: Date.parse("2026-10-27T08:00:00+01:00"),
    end: Date.parse("2026-10-27T08:30:00+01:00"),
  };

  it("snaps to the grid", () => {
    expect(snapMinutes(7, 15)).toBe(0);
    expect(snapMinutes(8, 15)).toBe(15);
    expect(snapMinutes(52, 30)).toBe(60);
  });

  it("moves by snapped minutes and days, keeping the length", () => {
    // 08:00 + 70 min = 09:10, nearest quarter 09:15; one column right.
    const moved = dragResult(ev, "move", 70, 1, opts, BG);
    expect(movePatch(opts, moved.start, moved.end, BG)).toEqual({
      start: "2026-10-28T09:15:00+01:00",
      end: "2026-10-28T09:45:00+01:00",
    });
  });

  it("resizes the end, never under min_event_minutes", () => {
    const longer = dragResult(ev, "resize-end", 60, 0, opts, BG);
    expect(new Date(longer.end).toISOString()).toBe("2026-10-27T08:30:00.000Z");
    const tiny = dragResult(ev, "resize-end", -60, 0, opts, BG);
    expect(tiny.end - tiny.start).toBe(15 * 60_000);
    const top = dragResult(ev, "resize-start", 25, 0, opts, BG);
    expect(top.end - top.start).toBe(15 * 60_000);
  });

  it("writes the option's field names with the display zone's offset", () => {
    const tickets = CalendarOptionsSchema.parse({ start_field: "starts_at", end_field: "ends_at" });
    expect(movePatch(tickets, ev.start, ev.end, NY)).toEqual({
      starts_at: "2026-10-27T03:00:00-04:00",
      ends_at: "2026-10-27T03:30:00-04:00",
    });
    expect(movePatch(tickets, ev.start, ev.end, TOKYO)).not.toHaveProperty("start");
  });

  it("a month move keeps the wall time and length across a DST change", () => {
    const summer = {
      start: Date.parse("2026-10-23T08:00:00+02:00"),
      end: Date.parse("2026-10-23T09:00:00+02:00"),
    };
    const next = moveToDay(summer, { y: 2026, m: 10, d: 26 }, BG);
    expect(movePatch(opts, next.start, next.end, BG)).toEqual({
      start: "2026-10-26T08:00:00+01:00",
      end: "2026-10-26T09:00:00+01:00",
    });
  });

  it("creates only when every required field can be filled", () => {
    const schema = SchemaDocSchema.parse({
      version: "v1",
      fields: {
        title: { type: "string", required: true },
        doctor: { type: "enum", values: ["Ana", "Bo"], required: true },
        start: { type: "datetime", required: true },
        end: { type: "datetime", required: true },
      },
    });
    const start = Date.parse("2026-10-27T10:00:00+01:00");
    expect(newEventRow({ opts, schema, title: "New", start, timeZone: BG })).toEqual({
      title: "New",
      doctor: "Ana",
      start: "2026-10-27T10:00:00+01:00",
      end: "2026-10-27T11:00:00+01:00",
    });
    const chip: FilterNode = { and: [{ field: "doctor", op: "in", value: ["Bo"] }] };
    expect(
      newEventRow({
        opts,
        schema,
        title: "New",
        start,
        timeZone: BG,
        prefill: prefillFromFilter(chip, schema),
      })?.doctor,
    ).toBe("Bo");
    const relation = SchemaDocSchema.parse({
      version: "v1",
      fields: { ...schema.fields, board_id: { type: "relation", ref: "boards", required: true } },
    });
    expect(canCreate(opts, schema)).toBe(true);
    expect(canCreate(opts, relation)).toBe(false);
  });
});

function Zone({ zone }: { zone: string }) {
  const { setTimeZone } = useTimezone();
  return (
    <button type="button" onClick={() => setTimeZone(zone)}>
      to {zone}
    </button>
  );
}

describe("the display zone in cells", () => {
  it("datetime cells and date_format follow the provider; a date does not move", async () => {
    localStorage.setItem(TZ_STORAGE_KEY, BG);
    render(
      <TimezoneProvider>
        <Zone zone={TOKYO} />
        <span data-testid="dt">
          <CellValue
            value="2026-10-27T08:00:00+01:00"
            column={{ field: "start" }}
            def={{ type: "datetime" }}
            locale="en"
            intlLocale="en-GB"
          />
        </span>
        <span data-testid="fmt">
          <CellValue
            value="2026-10-27T08:00:00+01:00"
            column={{ field: "start", transform: "date_format:DD.MM.YYYY HH:mm" }}
            def={{ type: "datetime" }}
            locale="en"
            intlLocale="en-GB"
          />
        </span>
        <span data-testid="date">
          <CellValue
            value="2026-10-27"
            column={{ field: "due", transform: "date_format:DD.MM.YYYY" }}
            def={{ type: "date" }}
            locale="en"
            intlLocale="en-GB"
          />
        </span>
      </TimezoneProvider>,
    );
    expect(screen.getByTestId("dt")).toHaveTextContent("27 Oct 2026, 08:00");
    expect(screen.getByTestId("fmt")).toHaveTextContent("27.10.2026 08:00");
    act(() => screen.getByText(`to ${TOKYO}`).click());
    expect(screen.getByTestId("dt")).toHaveTextContent("27 Oct 2026, 16:00");
    expect(screen.getByTestId("fmt")).toHaveTextContent("27.10.2026 16:00");
    expect(screen.getByTestId("date")).toHaveTextContent("27.10.2026");
    expect(localStorage.getItem(TZ_STORAGE_KEY)).toBe(TOKYO);
  });

  it("date_format reads a value without a zone literally", () => {
    expect(applyTransforms("2026-10-27T08:00:00", "date_format:HH:mm", "en", TOKYO)).toBe("08:00");
    expect(applyTransforms("2026-10-27T07:00:00Z", "date_format:HH:mm", "en", NY)).toBe("03:00");
  });
});

describe("CalendarRenderer", () => {
  const schema = SchemaDocSchema.parse({
    version: "v1",
    fields: {
      title: { type: "string", required: true },
      doctor: { type: "enum", values: ["Ana", "Bo"] },
      start: { type: "datetime", required: true },
      end: { type: "datetime", required: true },
    },
  });
  const view = ViewConfigSchema.parse({
    available_renderers: ["calendar", "table"],
    default_renderer: "calendar",
    calendar_options: opts,
  });

  function renderCalendar(mutate: boolean, zone = BG) {
    localStorage.setItem(TZ_STORAGE_KEY, zone);
    const mock = mockUdcFetch({
      list: () => ({
        ok: listOf([
          row("e1", 1, {
            title: "Check-up",
            doctor: "Ana",
            start: "2026-10-27T08:00:00+01:00",
            end: "2026-10-27T08:30:00+01:00",
          }),
        ]),
      }),
    });
    const client = new UdcClient({ httpUrl: "http://api", fetch: mock.fetch });
    const describe: DescribeResponse = {
      collection: "appointments",
      capabilities: {
        mutate,
        subscribe: false,
        total_count: true,
        schema_edit: false,
        config_edit: false,
        reindex: false,
        tree_reparent: false,
        source_yaml: false,
        supported_filter_ops: [],
      },
      schema,
      view,
      filterable: { fields: [] },
      source_kind: "postgres_jsonb",
    };
    const props: RendererProps = {
      collection: "appointments",
      describe,
      data: {} as UdcCollectionResult,
      filter: undefined,
      baseFilter: undefined,
      search: "",
      sort: [],
      onSort: () => {},
      mode: "infinite",
      page: 1,
      limit: 50,
      onPage: () => {},
      filtered: false,
      onClearFilters: () => {},
      resetKey: "",
      onCount: vi.fn(),
    };
    render(
      <UdcI18nProvider>
        <TimezoneProvider>
          <UdcProvider client={client}>
            <QueryClientProvider client={createUdcQueryClient()}>
              <TooltipProvider>
                <Toaster>
                  <MemoryRouter initialEntries={["/udc/appointments?date=2026-10-27"]}>
                    <CalendarRenderer {...props} />
                  </MemoryRouter>
                </Toaster>
              </TooltipProvider>
            </QueryClientProvider>
          </UdcProvider>
        </TimezoneProvider>
      </UdcI18nProvider>,
    );
    return { props, mock };
  }

  it("is registered without paging", () => {
    expect(rendererEntry("calendar")).toMatchObject({ paging: false, editMode: false });
  });

  it("asks for the work week of ?date= in the zone and draws the event there", async () => {
    const { mock, props } = renderCalendar(true, TOKYO);
    const event = await screen.findByTestId("cal-event");
    expect(event).toHaveAttribute("data-start", "2026-10-27T16:00:00+09:00");
    const list = mock.calls.find((c) => c.action === "list");
    expect(list?.body.filter).toEqual({
      field: "start",
      op: "between",
      value: ["2026-10-26T00:00:00.000+09:00", "2026-10-30T23:59:59.999+09:00"],
    });
    expect(list?.body.sort).toEqual([{ field: "start" }]);
    expect(screen.getAllByTestId("cal-day-column")).toHaveLength(5);
    await waitFor(() => expect(props.onCount).toHaveBeenCalledWith({ shown: 1, total: 1 }));
    expect(screen.getByTestId("cal-resize-end")).toBeInTheDocument();
  });

  it("read-only hides the resize handles", async () => {
    renderCalendar(false);
    await screen.findByTestId("cal-event");
    expect(screen.queryByTestId("cal-resize-end")).toBeNull();
    expect(screen.queryByTestId("cal-resize-start")).toBeNull();
  });
});
