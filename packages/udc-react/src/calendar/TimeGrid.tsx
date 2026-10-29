import type { CalendarOptions } from "@jsudc/core";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Input } from "../components/ui/input";
import { useI18n } from "../i18n/i18n";
import { cn } from "../lib/utils";
import {
  addDays,
  type CivilDay,
  dayKey,
  formatDay,
  formatTime,
  isoInZone,
  minuteOfDay,
  sameDay,
  startOfDay,
  zonedFormat,
} from "../time/zoned";
import { EventBlock } from "./EventBlock";
import {
  type CalendarEvent,
  type CalendarWindow,
  type DragKind,
  dragResult,
  eventsOnDay,
  instantAt,
  isAllDay,
  layoutLanes,
  verticalSpan,
} from "./model";

/** Pixels the pointer travels before a press becomes a drag (below it, a click). */
const DRAG_THRESHOLD = 4;
const GUTTER = "w-16";

interface Drag {
  id: string;
  kind: DragKind;
  x: number;
  y: number;
  col: number;
  moved: boolean;
}

export interface TimeGridProps {
  win: CalendarWindow;
  events: CalendarEvent[];
  opts: CalendarOptions;
  timeZone: string;
  today: CivilDay;
  now: number;
  readOnly: boolean;
  creatable: boolean;
  onMove: (ev: CalendarEvent, start: number, end: number) => void;
  onOpen: (ev: CalendarEvent, el: HTMLElement) => void;
  onCreate: (title: string, start: number) => void;
  onDay: (day: CivilDay) => void;
}

/**
 * Day / work week / week (/ two weeks): a column per day, an hour row per
 * hour of the zone's clock, events as blocks in overlap lanes. Drag a block
 * to move it (across days too), its top or bottom edge to resize it; Escape
 * cancels. A click on a block opens it, a click on empty time adds one.
 */
export function TimeGrid(props: TimeGridProps) {
  const { win, opts, timeZone, today, now, readOnly, creatable } = props;
  const { t, intlLocale } = useI18n();
  const hh = opts.hour_height_px;
  const scrollRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<{ id: string; start: number; end: number } | null>(null);
  const [draft, setDraft] = useState<{ day: CivilDay; minutes: number } | null>(null);
  const n = win.days.length;

  // Open where the day starts to matter.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, (opts.scroll_to_hour ?? opts.business_hours[0]) * hh - 8);
  }, [opts.scroll_to_hour, opts.business_hours, hh]);

  const shown = useMemo(
    () =>
      preview
        ? props.events.map((e) => (e.id === preview.id ? { ...e, ...preview } : e))
        : props.events,
    [props.events, preview],
  );
  const allDay = shown.filter((e) => isAllDay(e, timeZone));
  const timed = shown.filter((e) => !isAllDay(e, timeZone));

  // --- drag ------------------------------------------------------------------------------
  const colAt = (x: number) => {
    const rect = colsRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(n - 1, Math.max(0, Math.floor(((x - rect.left) / rect.width) * n)));
  };

  const startDrag = (e: ReactPointerEvent<HTMLElement>, ev: CalendarEvent, kind: DragKind) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setDraft(null);
    setDrag({
      id: ev.id,
      kind,
      x: e.clientX,
      y: e.clientY,
      col: colAt(e.clientX),
      moved: false,
    });
  };

  // The latest props for the document listeners, without re-binding them on every render.
  const live = useRef({ props, drag, preview });
  const dropClick = useRef(false);
  live.current = { props, drag, preview };

  // biome-ignore lint/correctness/useExhaustiveDependencies: bound once per drag; `live` has the rest
  useEffect(() => {
    if (!drag) return;
    const ev = live.current.props.events.find((x) => x.id === drag.id);
    if (!ev) return;
    const where = (x: number, y: number) =>
      dragResult(
        ev,
        drag.kind,
        ((y - drag.y) / hh) * 60,
        drag.kind === "move" ? colAt(x) - drag.col : 0,
        opts,
        timeZone,
      );
    const onMove = (e: PointerEvent) => {
      const far = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) >= DRAG_THRESHOLD;
      if (!far && !live.current.drag?.moved) return;
      if (readOnly) return;
      if (!live.current.drag?.moved) setDrag((d) => (d ? { ...d, moved: true } : d));
      setPreview({ id: ev.id, ...where(e.clientX, e.clientY) });
    };
    const finish = (e: PointerEvent) => {
      const { drag: d, preview: p } = live.current;
      setDrag(null);
      setPreview(null);
      // A press without a drag is a click: the block's own click opens it.
      if (!d?.moved) return;
      // The click the browser sends after this pointerup is the end of a drag, not a click.
      dropClick.current = true;
      setTimeout(() => {
        dropClick.current = false;
      }, 0);
      const next = p ?? { id: ev.id, ...where(e.clientX, e.clientY) };
      if (next.start !== ev.start || next.end !== ev.end) {
        live.current.props.onMove(ev, next.start, next.end);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDrag(null);
      setPreview(null);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", finish);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("keydown", onKey);
    };
  }, [drag?.id, drag?.kind]);

  // --- create ------------------------------------------------------------------------------
  const onEmptyClick = (e: React.MouseEvent<HTMLDivElement>, day: CivilDay) => {
    if (!creatable || readOnly || e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = ((e.clientY - rect.top) / hh) * 60;
    setDraft({ day, minutes: Math.floor(minutes / opts.snap_minutes) * opts.snap_minutes });
  };

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const hourLabel = (h: number) =>
    zonedFormat(intlLocale, "UTC", { hour: "numeric", minute: "2-digit" }).format(
      Date.UTC(2000, 0, 1, h),
    );
  const [bizFrom, bizTo] = opts.business_hours;
  const cols = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="cal-timegrid">
      {/* Day headers */}
      <div className="flex border-b border-border bg-surface">
        <div className={cn(GUTTER, "shrink-0")} />
        <div className="grid flex-1" style={cols}>
          {win.days.map((day) => {
            const isToday = sameDay(day, today);
            return (
              <button
                key={dayKey(day)}
                type="button"
                data-testid="cal-day-header"
                data-day={dayKey(day)}
                onClick={() => props.onDay(day)}
                className="flex items-baseline justify-center gap-1.5 border-l border-border py-2 text-xs text-muted-foreground hover:bg-hover"
              >
                <span className="font-medium uppercase">
                  {formatDay(day, intlLocale, { weekday: "short" })}
                </span>
                <span
                  className={cn(
                    "grid h-6 min-w-6 place-items-center rounded-full px-1 text-[13px] font-semibold text-foreground tabular-nums",
                    isToday && "bg-primary text-primary-foreground",
                  )}
                >
                  {day.d}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {allDay.length > 0 ? (
        <AllDayRow
          win={win}
          events={allDay}
          timeZone={timeZone}
          label={t("APP", "CAL_ALL_DAY")}
          onOpen={props.onOpen}
        />
      ) : null}

      <div ref={scrollRef} className="scroll-thin relative min-h-0 flex-1 overflow-y-auto">
        <div className="flex" style={{ height: 24 * hh }}>
          <div className={cn(GUTTER, "relative shrink-0")}>
            {hours.map((h) =>
              h === 0 ? null : (
                <div
                  key={h}
                  className="absolute right-2 -translate-y-1/2 text-[10.5px] whitespace-nowrap text-muted-foreground tabular-nums"
                  style={{ top: h * hh }}
                  data-testid="cal-hour-label"
                >
                  {hourLabel(h)}
                </div>
              ),
            )}
          </div>
          <div ref={colsRef} className="relative grid flex-1" style={cols}>
            {win.days.map((day) => {
              const dayEvents = eventsOnDay(timed, day, timeZone);
              const lanes = layoutLanes(dayEvents);
              const from = startOfDay(day, timeZone);
              const nowHere =
                opts.show_now_line && now >= from && now < startOfDay(addDays(day, 1), timeZone);
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: a click on empty time adds an event; the form is keyboard reachable
                // biome-ignore lint/a11y/useKeyWithClickEvents: as above
                <div
                  key={dayKey(day)}
                  data-testid="cal-day-column"
                  data-day={dayKey(day)}
                  onClick={(e) => onEmptyClick(e, day)}
                  className={cn(
                    "relative border-l border-border",
                    creatable && !readOnly && "cursor-cell",
                  )}
                  style={{
                    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${hh - 1}px, var(--border) ${hh - 1}px, var(--border) ${hh}px)`,
                  }}
                >
                  {/* Outside business hours: shaded. */}
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 bg-muted/55"
                    style={{ height: bizFrom * hh }}
                  />
                  <div
                    className="pointer-events-none absolute inset-x-0 bottom-0 bg-muted/55"
                    style={{ height: (24 - bizTo) * hh }}
                  />
                  {dayEvents.map((ev) => {
                    const span = verticalSpan(ev, day, timeZone);
                    const lane = lanes.get(ev.id) ?? { lane: 0, lanes: 1 };
                    const dragging = drag?.id === ev.id && drag.moved;
                    return (
                      <EventBlock
                        key={ev.id}
                        ev={ev}
                        readOnly={readOnly}
                        dragging={dragging}
                        timeLabel={`${formatTime(ev.start, intlLocale, timeZone)} – ${formatTime(ev.end, intlLocale, timeZone)}`}
                        startIso={isoInZone(ev.start, timeZone)}
                        style={{
                          top: (span.top / 60) * hh,
                          height: Math.max(((span.bottom - span.top) / 60) * hh, 18),
                          left: `calc(${(lane.lane / lane.lanes) * 100}% + 2px)`,
                          width: `calc(${100 / lane.lanes}% - 4px)`,
                        }}
                        onPointerDown={(e, kind) => startDrag(e, ev, kind)}
                        onOpen={(el) => !dropClick.current && props.onOpen(ev, el)}
                      />
                    );
                  })}
                  {nowHere ? (
                    <div
                      data-testid="cal-now-line"
                      className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-sem-danger"
                      style={{ top: (minuteOfDay(now, timeZone) / 60) * hh }}
                    >
                      <div className="absolute -top-[3px] -left-1 size-2 rounded-full bg-sem-danger" />
                    </div>
                  ) : null}
                  {draft && sameDay(draft.day, day) ? (
                    <CreateForm
                      top={(draft.minutes / 60) * hh}
                      label={formatTime(
                        instantAt(day, draft.minutes, timeZone),
                        intlLocale,
                        timeZone,
                      )}
                      placeholder={t("APP", "CAL_NEW_PLACEHOLDER")}
                      onCancel={() => setDraft(null)}
                      onSubmit={(title) => {
                        setDraft(null);
                        props.onCreate(title, instantAt(day, draft.minutes, timeZone));
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateForm({
  top,
  label,
  placeholder,
  onSubmit,
  onCancel,
}: {
  top: number;
  label: string;
  placeholder: string;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  return (
    <form
      data-testid="cal-create"
      className="absolute inset-x-1 z-30 rounded-md border border-primary/50 bg-surface-raised p-1.5 shadow-lg"
      style={{ top }}
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) onSubmit(title.trim());
      }}
    >
      <div className="mb-1 px-0.5 text-[10.5px] font-medium text-muted-foreground tabular-nums">
        {label}
      </div>
      <Input
        autoFocus
        data-testid="cal-create-title"
        value={title}
        placeholder={placeholder}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        onBlur={() => !title.trim() && onCancel()}
        className="h-7 text-xs"
      />
    </form>
  );
}

/** Events a day or longer, as bars across the day columns they cover. */
function AllDayRow({
  win,
  events,
  timeZone,
  label,
  onOpen,
}: {
  win: CalendarWindow;
  events: CalendarEvent[];
  timeZone: string;
  label: string;
  onOpen: (ev: CalendarEvent, el: HTMLElement) => void;
}) {
  const n = win.days.length;
  const colOf = (instant: number) => {
    const i = win.days.findIndex((d) => instant < startOfDay(addDays(d, 1), timeZone));
    return i < 0 ? n - 1 : i;
  };
  // Greedy rows: a bar takes the first row where it does not overlap.
  const rows: number[][] = [];
  const placed = events.map((ev) => {
    const a = ev.start < win.from ? 0 : colOf(ev.start);
    const b = ev.end > win.to ? n - 1 : colOf(ev.end - 1);
    let r = rows.findIndex((cols) => cols.every((c) => c < a || c > b));
    if (r < 0) r = rows.push([]) - 1;
    for (let c = a; c <= b; c++) rows[r]?.push(c);
    return { ev, a, b, r };
  });
  return (
    <div className="flex border-b border-border bg-surface" data-testid="cal-all-day">
      <div
        className={cn(
          GUTTER,
          "shrink-0 px-1 py-1.5 text-right text-[10px] leading-tight text-muted-foreground",
        )}
      >
        {label}
      </div>
      <div
        className="grid flex-1 gap-y-0.5 py-1"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {placed.map(({ ev, a, b, r }) => (
          <button
            key={ev.id}
            type="button"
            data-testid="cal-all-day-event"
            data-event-id={ev.id}
            onClick={(e) => onOpen(ev, e.currentTarget)}
            className="mx-0.5 truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-foreground"
            style={{
              gridColumn: `${a + 1} / ${b + 2}`,
              gridRow: r + 1,
              background: `color-mix(in srgb, ${ev.color ?? "var(--primary)"} 20%, var(--surface))`,
              borderLeft: `3px solid ${ev.color ?? "var(--primary)"}`,
            }}
          >
            {ev.title}
          </button>
        ))}
      </div>
    </div>
  );
}
