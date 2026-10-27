import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { cn } from "../lib/utils";
import { ACCENT, type CalendarEvent, type DragKind } from "./model";

/** The tinted fill and edge an event colour draws with, legible in both themes. */
export function eventTint(color: string | null, strength = 16): CSSProperties {
  const c = color ?? ACCENT;
  return {
    background: `color-mix(in srgb, ${c} ${strength}%, var(--surface))`,
    borderLeftColor: c,
  };
}

/** One timed event in a day column: title and time; edges to resize; the body to move. */
export function EventBlock({
  ev,
  style,
  timeLabel,
  startIso,
  readOnly,
  dragging,
  onPointerDown,
  onOpen,
}: {
  ev: CalendarEvent;
  style: CSSProperties;
  timeLabel: string;
  startIso: string;
  readOnly: boolean;
  dragging: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>, kind: DragKind) => void;
  /** A click (or Enter / Space): the grid drops the click that ends a drag. */
  onOpen: (el: HTMLElement) => void;
}) {
  const short = typeof style.height === "number" && style.height < 36;
  return (
    <button
      type="button"
      data-testid="cal-event"
      data-event-id={ev.id}
      data-start={startIso}
      data-color={ev.color ?? ""}
      aria-label={`${ev.title}, ${timeLabel}`}
      onPointerDown={(e) => onPointerDown(e, "move")}
      onClick={(e) => onOpen(e.currentTarget)}
      className={cn(
        "group/ev absolute z-10 block overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-foreground select-none",
        "shadow-[0_0_0_1px_var(--surface)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        readOnly ? "cursor-pointer" : "cursor-grab",
        dragging && "z-30 cursor-grabbing opacity-90 shadow-lg ring-2 ring-primary/40",
      )}
      style={{ ...eventTint(ev.color), ...style }}
    >
      {!readOnly ? (
        <div
          data-testid="cal-resize-start"
          className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
          onPointerDown={(e) => onPointerDown(e, "resize-start")}
        />
      ) : null}
      <div className={cn("flex min-w-0 gap-1.5", short ? "items-baseline" : "flex-col gap-0")}>
        <span className="truncate text-[11.5px] leading-tight font-semibold">{ev.title}</span>
        <span
          className="truncate text-[10.5px] leading-tight text-muted-foreground tabular-nums"
          data-testid="cal-event-time"
        >
          {timeLabel}
        </span>
      </div>
      {!readOnly ? (
        <div
          data-testid="cal-resize-end"
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize after:absolute after:bottom-0.5 after:left-1/2 after:h-0.5 after:w-4 after:-translate-x-1/2 after:rounded-full after:bg-foreground/25 after:opacity-0 group-hover/ev:after:opacity-100"
          onPointerDown={(e) => onPointerDown(e, "resize-end")}
        />
      ) : null}
    </button>
  );
}
