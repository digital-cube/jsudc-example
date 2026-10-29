import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { storage } from "../lib/utils";
import { browserZone, isValidZone } from "./zoned";

/** The zone this browser shows instants in: a preference, not URL state. */
export const TZ_STORAGE_KEY = "udc-tz";
/** Stored when the user picks "Browser": follow the browser's zone wherever it is. */
export const BROWSER_TZ = "browser";

/** The zones the picker lists first. */
export const COMMON_ZONES = [
  "UTC",
  "Europe/Belgrade",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

export interface TimezoneState {
  /** The IANA zone every instant on screen is drawn in. */
  timeZone: string;
  browserZone: string;
  /** The user follows the browser's zone (nothing else picked). */
  followsBrowser: boolean;
  /** A zone name, or `BROWSER_TZ`. */
  setTimeZone: (zone: string) => void;
  /** The header picker, opened from elsewhere too (the calendar's zone label). */
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
}

function stored(): string {
  const v = storage.get(TZ_STORAGE_KEY);
  return v && (v === BROWSER_TZ || isValidZone(v)) ? v : BROWSER_TZ;
}

const fallback: TimezoneState = {
  timeZone: browserZone(),
  browserZone: browserZone(),
  followsBrowser: true,
  setTimeZone: () => {},
  pickerOpen: false,
  setPickerOpen: () => {},
};

const TimezoneContext = createContext<TimezoneState | null>(null);

export function TimezoneProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState(stored);
  const [pickerOpen, setPickerOpen] = useState(false);
  const browser = useMemo(browserZone, []);

  const setTimeZone = useCallback((zone: string) => {
    const next = zone === BROWSER_TZ || isValidZone(zone) ? zone : BROWSER_TZ;
    storage.set(TZ_STORAGE_KEY, next);
    setChoice(next);
  }, []);

  const value = useMemo<TimezoneState>(
    () => ({
      timeZone: choice === BROWSER_TZ ? browser : choice,
      browserZone: browser,
      followsBrowser: choice === BROWSER_TZ,
      setTimeZone,
      pickerOpen,
      setPickerOpen,
    }),
    [choice, browser, setTimeZone, pickerOpen],
  );
  return <TimezoneContext.Provider value={value}>{children}</TimezoneContext.Provider>;
}

/**
 * The display zone. Without a provider (a component rendered on its own in a
 * test) it is the browser's, so nothing that formats an instant needs one.
 */
export function useTimezone(): TimezoneState {
  return useContext(TimezoneContext) ?? fallback;
}
