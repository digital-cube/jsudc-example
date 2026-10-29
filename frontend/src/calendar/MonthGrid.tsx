import type { CalendarOptions } from "@jsudc/core";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { useI18n } from "../i18n/i18n";
import { cn } from "../lib/utils";
import { type CivilDay, dayKey, formatDay, formatTime, sameDay } from "../time/zoned";
import { eventTint } from "./EventBlock";
import { type CalendarEvent, type CalendarWindow, eventsOnDay } from "./model";

const DRAG_TYPE = "application/x-udc-event";

/**
 * A cell per day of the weeks the month touches: up to
 * `month_max_chips_per_day` chips, then "+N more" for the rest. A chip drags
 * to another day (keeping its time and length); the day number opens that day.
 */
export function MonthGrid({
  win,
  events,
  opts,
  timeZone,
  today,
  readOnly,
  onMoveToDay,
  onOpen,
  onDay,
}: {
  win: CalendarWindow;
  events: CalendarEvent[];
  opts: CalendarOptions;
  timeZone: string;
  today: CivilDay;
  readOnly: boolean;
  onMoveToDay: (ev: CalendarEvent, day: CivilDay) => void;
  onOpen: (ev: CalendarEvent, el: HTMLElement) => void;
  onDay: (day: CivilDay) => void;
}) {
  const { t, intlLocale } = useI18n();
  const [over, setOver] = useState<string | null>(null);
  const weekdays = win.days.slice(0, 7);
  const byId = new Map(events.map((e) => [e.id, e]));
  const max = opts.month_max_chips_per_day;

  const chip = (ev: CalendarEvent, inPopover = false) => (
    <button
      key={ev.id}
      type="button"
      draggable={!readOnly}
      data-testid="cal-chip"
      data-event-id={ev.id}
      data-color={ev.color ?? ""}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, ev.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => onOpen(ev, e.currentTarget)}
      className={cn(
        "flex w-full min-w-0 items-center gap-1 rounded border-l-[3px] px-1 py-px text-left text-[11px] leading-4 text-foreground",
        !readOnly && "cursor-grab",
        inPopover && "py-0.5",
      )}
      style={eventTint(ev.color, 14)}
    >
      <span className="shrink-0 text-muted-foreground tabular-nums">
        {formatTime(ev.start, intlLocale, timeZone)}
      </span>
      <span className="truncate font-medium">{ev.title}</span>
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="cal-month">
      <div className="grid grid-cols-7 border-b border-border bg-surface">
        {weekdays.map((d) => (
          <div
            key={dayKey(d)}
            className="border-l border-border py-1.5 text-center text-[11px] font-medium text-muted-foreground uppercase first:border-l-0"
          >
            {formatDay(d, intlLocale, { weekday: "short" })}
          </div>
        ))}
      </div>
      <div
        className="grid min-h-0 flex-1 grid-cols-7 overflow-y-auto"
        style={{ gridAutoRows: "minmax(7rem, 1fr)" }}
      >
        {win.days.map((day) => {
          const key = dayKey(day);
          const list = eventsOnDay(events, day, timeZone);
          const outside = day.m !== win.anchor.m;
          const hidden = list.length - max;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: a drop target for chips; the day button is the keyboard way in
            <div
              key={key}
              data-testid="cal-month-cell"
              data-day={key}
              data-count={list.length}
              onDragOver={(e) => {
                if (readOnly || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                setOver(key);
              }}
              onDragLeave={() => setOver((o) => (o === key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const ev = byId.get(e.dataTransfer.getData(DRAG_TYPE));
                if (ev && !readOnly) onMoveToDay(ev, day);
              }}
              className={cn(
                "flex min-w-0 flex-col gap-0.5 border-b border-l border-border p-1 [&:nth-child(7n+1)]:border-l-0",
                outside && "bg-muted/40",
                over === key && "bg-selected",
              )}
            >
              <button
                type="button"
                data-testid="cal-month-day"
                onClick={() => onDay(day)}
                className={cn(
                  "mb-0.5 grid h-6 min-w-6 place-items-center self-start rounded-full px-1 text-xs font-semibold tabular-nums hover:bg-hover",
                  outside && "text-muted-foreground",
                  sameDay(day, today) && "bg-primary text-primary-foreground hover:bg-primary",
                )}
              >
                {day.d === 1
                  ? formatDay(day, intlLocale, { day: "numeric", month: "short" })
                  : day.d}
              </button>
              {list.slice(0, max).map((ev) => chip(ev))}
              {hidden > 0 ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      data-testid="cal-more"
                      className="self-start rounded px-1 text-[11px] font-medium text-muted-foreground hover:bg-hover hover:text-foreground"
                    >
                      {t("APP", "CAL_MORE", { n: hidden })}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2" data-testid="cal-more-popover">
                    <div className="mb-1.5 px-1 text-xs font-semibold">
                      {formatDay(day, intlLocale, {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })}
                    </div>
                    <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
                      {list.map((ev) => chip(ev, true))}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
