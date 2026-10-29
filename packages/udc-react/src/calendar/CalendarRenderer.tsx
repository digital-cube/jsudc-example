import {
  type CalendarOptions,
  type CalendarPreset,
  type FilterNode,
  isCalendarPreset,
  isCondition,
  isVersionConflict,
  type SchemaDoc,
} from "@jsudc/core";
import { ChevronLeft, ChevronRight, Globe } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "../components/ui/button";
import { Segmented } from "../components/ui/segmented";
import { useToast } from "../components/ui/toast";
import { useI18n } from "../i18n/i18n";
import { useKanbanBoard } from "../kanban/useKanbanBoard";
import { AllRowsStatus } from "../renderers/AllRowsStatus";
import type { RendererProps } from "../renderers/types";
import { EmptyState, ErrorState } from "../table/states";
import { useTimezone } from "../time/timezone";
import {
  type CivilDay,
  dayKey,
  dayOf,
  offsetLabel,
  offsetMinutes,
  parseDayKey,
  zoneCity,
} from "../time/zoned";
import { useUdcAllRows, useUdcMutate } from "../udc/hooks";
import { EventDetail } from "./EventDetail";
import { MonthGrid } from "./MonthGrid";
import {
  type CalendarEvent,
  canCreate,
  computeWindow,
  movePatch,
  moveToDay,
  newEventRow,
  stepAnchor,
  toEvents,
  windowBetween,
  windowFilter,
  windowLabel,
} from "./model";
import { TimeGrid } from "./TimeGrid";

export const PRESET_PARAM = "preset";
export const DATE_PARAM = "date";

/** `?preset=&date=`: what the calendar shows. The zone is a preference, not URL state. */
function useCalendarUrl(opts: CalendarOptions, today: CivilDay) {
  const [params, setParams] = useSearchParams();
  const presetOf = (p: URLSearchParams): CalendarPreset => {
    const raw = p.get(PRESET_PARAM);
    return isCalendarPreset(raw) && opts.available_presets.includes(raw)
      ? raw
      : opts.default_preset;
  };
  const anchorOf = (p: URLSearchParams) => parseDayKey(p.get(DATE_PARAM)) ?? today;
  // Every change starts from the address bar as it is now, not as the last render saw it:
  // navigations render in a transition, so two quick clicks would both step from the same day.
  const update = (edit: (p: URLSearchParams) => Record<string, string>) => {
    const now = new URLSearchParams(window.location.search);
    const next = new URLSearchParams(now);
    for (const [k, v] of Object.entries(edit(now))) next.set(k, v);
    setParams(next, { replace: true });
  };
  return {
    preset: presetOf(params),
    anchor: anchorOf(params),
    setPreset: (p: CalendarPreset) => update(() => ({ [PRESET_PARAM]: p })),
    setAnchor: (d: CivilDay) => update(() => ({ [DATE_PARAM]: dayKey(d) })),
    step: (dir: 1 | -1) =>
      update((p) => ({ [DATE_PARAM]: dayKey(stepAnchor(presetOf(p), anchorOf(p), dir)) })),
    openDay: (d: CivilDay) => update(() => ({ [PRESET_PARAM]: "day", [DATE_PARAM]: dayKey(d) })),
  };
}

/** The clock, a tick a minute: the now line and "today". */
function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/**
 * Enum values the filter pins (a chip with values picked): what a new event
 * gets, so an appointment added under the "Ana" chip is Ana's.
 */
export function prefillFromFilter(
  filter: FilterNode | undefined,
  schema: SchemaDoc,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (node: FilterNode | undefined) => {
    if (!node) return;
    if (isCondition(node)) {
      if (schema.fields[node.field]?.type !== "enum" || node.field in out) return;
      if (node.op === "eq") out[node.field] = node.value;
      else if (node.op === "in" && Array.isArray(node.value) && node.value.length > 0) {
        out[node.field] = node.value[0];
      }
      return;
    }
    if ("and" in node) node.and.forEach(walk);
  };
  walk(filter);
  return out;
}

/** The `calendar` tab: the window of a preset, asked from the server, drawn in the header's zone. */
export function CalendarRenderer(props: RendererProps) {
  const opts = props.describe.view.calendar_options;
  const { t } = useI18n();
  if (!opts) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground" data-testid="calendar-missing">
        {t("APP", "CAL_NO_OPTIONS")}
      </div>
    );
  }
  return <Calendar {...props} opts={opts} />;
}

function Calendar({
  collection,
  describe,
  filter,
  filtered,
  onClearFilters,
  onCount,
  opts,
}: RendererProps & { opts: CalendarOptions }) {
  const { t, intlLocale } = useI18n();
  const { toast } = useToast();
  const { timeZone, setPickerOpen } = useTimezone();
  const { schema, capabilities } = describe;
  const now = useNow();
  const today = dayOf(now, timeZone);
  const url = useCalendarUrl(opts, today);
  const { preset, anchor } = url;
  // Cheap, and a new object each render: the list key is hashed by value, so nothing refetches.
  const win = computeWindow(preset, anchor, opts, timeZone);

  // On a kanban collection the calendar shows the board the board tab shows (`?board=`).
  const kanban = describe.view.kanban_options;
  const board = useKanbanBoard(describe);
  const boardId = kanban ? board.boardId : null;
  const base = useMemo<FilterNode | undefined>(() => {
    if (!kanban || !boardId) return filter;
    const onBoard: FilterNode = { field: kanban.ticket_board_field, op: "eq", value: boardId };
    return filter ? { and: [filter, onBoard] } : onBoard;
  }, [filter, kanban, boardId]);

  const listFilter = windowFilter(base, opts, win, timeZone);
  const q = useUdcAllRows({
    collection,
    filter: listFilter,
    sort: [{ field: opts.start_field }],
    capabilities,
    enabled: !kanban || boardId !== null,
    refetchInterval: describe.view.refresh_interval_ms,
  });

  // Moves in flight: drawn where they were dropped until the server answers.
  const [pending, setPending] = useState<ReadonlyMap<string, { start: number; end: number }>>(
    new Map(),
  );
  const events = useMemo(
    () =>
      toEvents(q.rows, opts).map((e) => {
        const p = pending.get(e.id);
        return p ? { ...e, ...p } : e;
      }),
    [q.rows, opts, pending],
  );

  useEffect(() => {
    onCount({ shown: events.length, total: q.total ?? events.length });
  }, [onCount, events.length, q.total]);
  useEffect(() => () => onCount(null), [onCount]);

  const readOnly = !capabilities.mutate;
  const creatable = !readOnly && canCreate(opts, schema);
  const mutate = useUdcMutate(collection);
  const [detail, setDetail] = useState<{ id: string; el: HTMLElement } | null>(null);
  const detailEvent = detail ? events.find((e) => e.id === detail.id) : undefined;

  const fail = useCallback(
    (err: unknown, title: string) => {
      if (isVersionConflict(err)) {
        toast({
          variant: "warning",
          title: t("APP", "CAL_CONFLICT_TITLE"),
          description: t("APP", "CAL_CONFLICT_BODY"),
        });
      } else {
        toast({ variant: "danger", title, description: (err as Error).message });
      }
    },
    [toast, t],
  );

  const move = (ev: CalendarEvent, start: number, end: number) => {
    setPending((m) => new Map(m).set(ev.id, { start, end }));
    mutate
      .mutateAsync({
        op: "update",
        id: ev.id,
        row: movePatch(opts, start, end, timeZone),
        expected_version: ev.row.__meta.version,
      })
      .catch((err: unknown) => fail(err, t("APP", "CAL_MOVE_FAILED")))
      .finally(() =>
        setPending((m) => {
          const next = new Map(m);
          next.delete(ev.id);
          return next;
        }),
      );
  };

  const save = async (ev: CalendarEvent, field: string, value: unknown) => {
    try {
      await mutate.mutateAsync({
        op: "update",
        id: ev.id,
        row: { [field]: value },
        expected_version: ev.row.__meta.version,
      });
    } catch (err) {
      fail(err, t("APP", "CAL_MOVE_FAILED"));
      throw err;
    }
  };

  const remove = async (ev: CalendarEvent) => {
    try {
      await mutate.mutateAsync({
        op: "delete",
        id: ev.id,
        expected_version: ev.row.__meta.version,
      });
      setDetail(null);
    } catch (err) {
      fail(err, t("APP", "CAL_DELETE_FAILED"));
    }
  };

  const create = (title: string, start: number) => {
    const row = newEventRow({
      opts,
      schema,
      title,
      start,
      timeZone,
      prefill: prefillFromFilter(filter, schema),
    });
    if (!row) return;
    mutate
      .mutateAsync({ op: "insert", row })
      .catch((err: unknown) => fail(err, t("APP", "CAL_ADD_FAILED")));
  };

  if (q.error && q.rows.length === 0) {
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  }

  const [from, to] = windowBetween(win, timeZone);
  const zoneOffset = offsetLabel(offsetMinutes(win.from, timeZone));
  const grid = {
    win,
    events,
    opts,
    timeZone,
    today,
    readOnly,
    onOpen: (ev: CalendarEvent, el: HTMLElement) => setDetail({ id: ev.id, el }),
    onDay: url.openDay,
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="calendar"
      data-preset={preset}
      data-date={dayKey(anchor)}
      data-from={from}
      data-to={to}
      data-tz={timeZone}
    >
      <div
        data-testid="cal-toolbar"
        className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2"
      >
        <Button size="sm" data-testid="cal-today" onClick={() => url.setAnchor(today)}>
          {t("APP", "CAL_TODAY")}
        </Button>
        <div className="flex items-center">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("APP", "CAL_PREV")}
            data-testid="cal-prev"
            onClick={() => url.step(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("APP", "CAL_NEXT")}
            data-testid="cal-next"
            onClick={() => url.step(1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <h2 className="text-sm font-semibold tracking-tight tabular-nums" data-testid="cal-label">
          {windowLabel(win, intlLocale)}
        </h2>
        <button
          type="button"
          data-testid="cal-zone"
          title={t("APP", "CAL_ZONE_HINT", { zone: timeZone })}
          onClick={() => setPickerOpen(true)}
          className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2 text-[11px] font-medium text-muted-foreground hover:bg-selected hover:text-foreground"
        >
          <Globe className="size-3" />
          {zoneCity(timeZone) === zoneOffset ? zoneOffset : `${zoneCity(timeZone)} · ${zoneOffset}`}
        </button>
        <Segmented<CalendarPreset>
          className="ml-auto"
          aria-label={t("APP", "CAL_PRESETS")}
          data-testid="cal-presets"
          value={preset}
          onChange={url.setPreset}
          options={opts.available_presets.map((p) => ({
            value: p,
            testId: `cal-preset-${p}`,
            label: t("APP", `CAL_PRESET_${p.toUpperCase()}`),
          }))}
        />
      </div>
      <AllRowsStatus result={q} />
      {filtered && !q.isFetching && events.length === 0 ? (
        <div className="border-b border-border">
          <EmptyState filtered onClear={onClearFilters} />
        </div>
      ) : null}
      {preset === "month" ? (
        <MonthGrid
          {...grid}
          onMoveToDay={(ev, day) => {
            const next = moveToDay(ev, day, timeZone);
            if (next.start !== ev.start) move(ev, next.start, next.end);
          }}
        />
      ) : (
        <TimeGrid {...grid} now={now} creatable={creatable} onMove={move} onCreate={create} />
      )}
      {detail && detailEvent ? (
        <EventDetail
          key={detail.id}
          ev={detailEvent}
          anchor={detail.el}
          collection={collection}
          describe={describe}
          opts={opts}
          timeZone={timeZone}
          readOnly={readOnly}
          onClose={() => setDetail(null)}
          onSave={(field, value) => save(detailEvent, field, value)}
          onDelete={() => remove(detailEvent)}
        />
      ) : null}
    </div>
  );
}
