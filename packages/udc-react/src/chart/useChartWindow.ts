import type { ChartWindow, FilterNode, ViewConfig } from "@jsudc/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useTimezone } from "../time/timezone";
import { readWindow, type WindowSel, windowCondition, windowRange, writeWindow } from "./window";

export interface ChartWindowState {
  cfg: ChartWindow;
  sel: WindowSel;
  /** The URL chose the window (`?win=` / `?from=&to=`): every tab of the view applies it. */
  explicit: boolean;
  /** Instants (ms), both ends included; `null` for a side a custom range leaves open. */
  range: [number | null, number | null];
  /** The condition on `cfg.field`, in the header's zone; absent for an empty custom range. */
  cond: FilterNode | undefined;
  timeZone: string;
  setSel: (sel: WindowSel) => void;
  /** Drop the window from the URL (the chart falls back to the default preset). */
  clear: () => void;
}

/**
 * The instant a window is computed from. It is taken when the window or the
 * zone changes, and again every `everyMs` when the view polls, so the window
 * of a list key stays put between two polls instead of changing every render.
 */
function useWindowNow(key: string, everyMs: number | undefined): number {
  const [state, setState] = useState(() => ({ key, now: Date.now() }));
  let current = state;
  if (state.key !== key) {
    current = { key, now: Date.now() };
    setState(current);
  }
  useEffect(() => {
    if (!everyMs || everyMs <= 0) return;
    const id = setInterval(() => setState((s) => ({ ...s, now: Date.now() })), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return current.now;
}

/** The chart window of a view with `chart_options.window`, from the URL and the header's zone. */
export function useChartWindow(view: ViewConfig | undefined): ChartWindowState | null {
  const cfg = view?.chart_options?.window;
  const [params, setParams] = useSearchParams();
  const { timeZone } = useTimezone();
  const read = cfg ? readWindow(params, cfg) : null;
  const selKey = JSON.stringify(read?.sel ?? null);
  const explicit = read?.explicit ?? false;
  const now = useWindowNow(`${selKey}|${timeZone}`, view?.refresh_interval_ms);
  const setSel = useCallback(
    (sel: WindowSel) => setParams((prev) => writeWindow(prev, sel), { replace: true }),
    [setParams],
  );
  const clear = useCallback(
    () => setParams((prev) => writeWindow(prev, null), { replace: true }),
    [setParams],
  );
  // One object while nothing it is made of changes: renderers keep it in effect dependencies.
  return useMemo(() => {
    if (!cfg) return null;
    const sel = JSON.parse(selKey) as WindowSel;
    return {
      cfg,
      sel,
      explicit,
      range: windowRange(sel, now, timeZone),
      cond: windowCondition(cfg.field, sel, now, timeZone),
      timeZone,
      setSel,
      clear,
    };
  }, [cfg, selKey, explicit, now, timeZone, setSel, clear]);
}
