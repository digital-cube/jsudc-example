import { Check, Globe } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { useI18n } from "../i18n/i18n";
import { cn } from "../lib/utils";
import { BROWSER_TZ, COMMON_ZONES, useTimezone } from "../time/timezone";
import { allZones, offsetLabel, offsetMinutes } from "../time/zoned";

/** `America/New_York` → `New York`. */
export function zoneCity(zone: string): string {
  return (zone.split("/").at(-1) ?? zone).replace(/_/g, " ");
}

interface ZoneOption {
  /** A zone name, or `BROWSER_TZ`. */
  value: string;
  zone: string;
  label: string;
  offset: string;
  group: "browser" | "common" | "all";
}

/**
 * The display zone, in the header: the active zone and its offset on the
 * button; a searchable list (the browser's zone first, then the common ones,
 * then every zone `Intl` knows) in the popover. A pick re-renders every
 * instant on screen at once.
 */
export function TimezonePicker() {
  const { t } = useI18n();
  const tz = useTimezone();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const now = Date.now();
  const label = offsetLabel(offsetMinutes(now, tz.timeZone));

  // Offsets are "now": computed while the list is open, once.
  const options = useMemo<ZoneOption[]>(() => {
    if (!tz.pickerOpen) return [];
    const at = Date.now();
    const off = (zone: string) => offsetLabel(offsetMinutes(at, zone));
    const browser: ZoneOption = {
      value: BROWSER_TZ,
      zone: tz.browserZone,
      label: t("APP", "TZ_BROWSER", { zone: tz.browserZone }),
      offset: off(tz.browserZone),
      group: "browser",
    };
    const common = COMMON_ZONES.map(
      (zone): ZoneOption => ({
        value: zone,
        zone,
        label: zone,
        offset: off(zone),
        group: "common",
      }),
    );
    const rest = allZones()
      .filter((z) => !(COMMON_ZONES as readonly string[]).includes(z))
      .map(
        (zone): ZoneOption => ({ value: zone, zone, label: zone, offset: off(zone), group: "all" }),
      );
    return [browser, ...common, ...rest];
  }, [tz.pickerOpen, tz.browserZone, t]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, "_");
    if (!q) return options;
    return options.filter(
      (o) =>
        o.zone.toLowerCase().includes(q) ||
        o.label.toLowerCase().replace(/\s+/g, "_").includes(q) ||
        o.offset.toLowerCase().replace("−", "-").includes(q.replace("−", "-")),
    );
  }, [options, query]);

  const selected = tz.followsBrowser ? BROWSER_TZ : tz.timeZone;

  useEffect(() => {
    if (!tz.pickerOpen) setQuery("");
  }, [tz.pickerOpen]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query restarts at the top
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (value: string) => {
    tz.setTimeZone(value);
    tz.setPickerOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const o = shown[active];
      if (o) pick(o.value);
    }
  };

  const groupTitle = { browser: null, common: t("APP", "TZ_COMMON"), all: t("APP", "TZ_ALL") };

  return (
    <Popover open={tz.pickerOpen} onOpenChange={tz.setPickerOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="tz-trigger"
          data-tz={tz.timeZone}
          aria-label={t("APP", "TZ_LABEL")}
          title={`${t("APP", "TZ_LABEL")}: ${tz.timeZone}`}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium",
            "text-foreground transition-colors hover:bg-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <Globe className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="max-w-32 truncate">{zoneCity(tz.timeZone)}</span>
          {label !== zoneCity(tz.timeZone) ? (
            <span className="text-muted-foreground tabular-nums" data-testid="tz-offset">
              {label}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" data-testid="tz-picker">
        <div className="border-b border-border p-2">
          <Input
            autoFocus
            data-testid="tz-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("APP", "TZ_SEARCH")}
            aria-label={t("APP", "TZ_SEARCH")}
          />
        </div>
        <div ref={listRef} role="listbox" className="scroll-thin max-h-80 overflow-y-auto p-1">
          {shown.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              {t("APP", "TZ_NONE")}
            </div>
          ) : null}
          {shown.map((o, i) => {
            const title = groupTitle[o.group];
            const first = i === 0 || shown[i - 1]?.group !== o.group;
            const isSelected = o.value === selected;
            return (
              <div key={`${o.group}:${o.value}`}>
                {first && title ? (
                  <div className="px-2 pt-2 pb-1 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {title}
                  </div>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-index={i}
                  data-testid="tz-option"
                  data-tz={o.value}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o.value)}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]",
                    i === active ? "bg-hover" : "",
                    isSelected ? "font-medium text-foreground" : "text-foreground/90",
                  )}
                >
                  <Check
                    className={cn("size-3.5 shrink-0", isSelected ? "text-primary" : "invisible")}
                  />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {o.offset}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
