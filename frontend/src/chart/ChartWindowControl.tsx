import { parseWindowPreset } from "@jsudc/core";
import { X } from "lucide-react";
import { Button } from "../components/ui/button";
import { inputClass } from "../components/ui/input";
import { Segmented } from "../components/ui/segmented";
import { useI18n } from "../i18n/i18n";
import { cn } from "../lib/utils";
import type { ChartWindowState } from "./useChartWindow";
import { wallOf } from "./window";

const CUSTOM = "custom";

/** `24h` → "24h" / "24 č", `7d` → "7d" / "7 d". */
export function presetLabel(preset: string, t: ReturnType<typeof useI18n>["t"]): string {
  const p = parseWindowPreset(preset);
  if (!p) return preset;
  return t("APP", p.unit === "h" ? "CHART_PRESET_H" : "CHART_PRESET_D", { n: p.n });
}

/**
 * The window of a chart, in the toolbar row: the presets, "Custom" with a
 * from / to pair of wall times in the header's zone, and (on a tab other than
 * the chart, where the window came along from the URL) a button that drops it.
 */
export function ChartWindowControl({
  win,
  clearable,
}: {
  win: ChartWindowState;
  clearable: boolean;
}) {
  const { t } = useI18n();
  const { cfg, sel, range, timeZone } = win;
  const value = sel.kind === "custom" ? CUSTOM : sel.preset;
  const options = [
    ...cfg.presets.map((p) => ({
      value: p,
      testId: `chart-win-${p}`,
      label: presetLabel(p, t),
      tooltip: t(
        "APP",
        parseWindowPreset(p)?.unit === "h" ? "CHART_LAST_HOURS" : "CHART_LAST_DAYS",
        {
          n: parseWindowPreset(p)?.n ?? 0,
        },
      ),
    })),
    ...(cfg.allow_custom
      ? [{ value: CUSTOM, testId: "chart-win-custom", label: t("APP", "CHART_CUSTOM") }]
      : []),
  ];
  const wall = (t: number | null) => (t === null ? "" : wallOf(t, timeZone));

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="chart-window">
      <Segmented<string>
        aria-label={t("APP", "CHART_WINDOW")}
        data-testid="chart-presets"
        value={value}
        onChange={(v) =>
          win.setSel(
            v === CUSTOM
              ? { kind: "custom", from: wall(range[0]) || null, to: wall(range[1]) || null }
              : { kind: "preset", preset: v },
          )
        }
        options={options}
      />
      {sel.kind === "custom" ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <label className="flex items-center gap-1">
            {t("APP", "CHART_FROM")}
            <input
              type="datetime-local"
              data-testid="chart-from"
              className={cn(inputClass, "h-8 w-auto px-2 text-xs")}
              value={sel.from ?? ""}
              max={sel.to ?? undefined}
              onChange={(e) => win.setSel({ ...sel, from: e.target.value || null })}
            />
          </label>
          <label className="flex items-center gap-1">
            {t("APP", "CHART_TO")}
            <input
              type="datetime-local"
              data-testid="chart-to"
              className={cn(inputClass, "h-8 w-auto px-2 text-xs")}
              value={sel.to ?? ""}
              min={sel.from ?? undefined}
              onChange={(e) => win.setSel({ ...sel, to: e.target.value || null })}
            />
          </label>
        </div>
      ) : null}
      {clearable ? (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("APP", "CHART_CLEAR_WINDOW")}
          data-testid="chart-win-clear"
          onClick={win.clear}
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}
