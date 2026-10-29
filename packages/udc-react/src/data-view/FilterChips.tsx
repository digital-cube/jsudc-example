import type { FilterChipConfig } from "@jsudc/core";
import { Check, ChevronDown, PlusCircle, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { useI18n } from "../i18n/i18n";
import { cn, humanize } from "../lib/utils";
import { type ChipState, type ChipValue, isEmptyChip } from "./urlState";

type Label = (cfg: FilterChipConfig) => string;

/** The chip bar: one popover per `view.filters` entry. */
export function FilterChips({
  configs,
  state,
  onChange,
  label,
}: {
  configs: readonly FilterChipConfig[];
  state: ChipState;
  onChange: (next: ChipState) => void;
  label: Label;
}) {
  const set = (field: string, v: ChipValue | null) => {
    const next = { ...state };
    if (v === null || isEmptyChip(v)) delete next[field];
    else next[field] = v;
    onChange(next);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="filter-chips">
      {configs.map((cfg) => {
        const v = state[cfg.field];
        const value = v && v.kind === cfg.kind ? v : undefined;
        const props = { cfg, label: label(cfg), onClear: () => set(cfg.field, null) };
        if (cfg.kind === "select") {
          return (
            <SelectChip
              key={cfg.field}
              {...props}
              value={value as Extract<ChipValue, { kind: "select" }> | undefined}
              onChange={(values) => set(cfg.field, { kind: "select", values })}
            />
          );
        }
        if (cfg.kind === "range") {
          return (
            <RangeChip
              key={cfg.field}
              {...props}
              value={value as Extract<ChipValue, { kind: "range" }> | undefined}
              onChange={(min, max) => set(cfg.field, { kind: "range", min, max })}
            />
          );
        }
        return (
          <BoolChip
            key={cfg.field}
            {...props}
            value={value as Extract<ChipValue, { kind: "bool" }> | undefined}
            onChange={(b) => set(cfg.field, b === null ? null : { kind: "bool", value: b })}
          />
        );
      })}
    </div>
  );
}

function ChipTrigger({
  field,
  label,
  summary,
  onClear,
}: {
  field: string;
  label: string;
  summary: string | null;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const active = summary !== null;
  return (
    <div
      className={cn(
        "inline-flex h-7 items-center rounded-full border text-xs font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/8 text-foreground"
          : "border-dashed border-border-strong text-muted-foreground hover:border-solid hover:bg-hover hover:text-foreground",
      )}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`chip-${field}`}
          data-active={active || undefined}
          className={cn(
            "inline-flex h-full items-center gap-1.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active ? "pr-1 pl-2.5" : "px-2.5",
          )}
        >
          {active ? null : <PlusCircle className="size-3.5" />}
          <span>{label}</span>
          {active ? (
            <>
              <span className="h-3.5 w-px bg-primary/30" />
              <span className="max-w-40 truncate text-primary">{summary}</span>
            </>
          ) : (
            <ChevronDown className="size-3 opacity-60" />
          )}
        </button>
      </PopoverTrigger>
      {active ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={`${t("APP", "CLEAR")} ${label}`}
          data-testid={`chip-clear-${field}`}
          className="mr-1 grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-primary/15 hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

function ChipPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </div>
      {children}
    </>
  );
}

function SelectChip({
  cfg,
  label,
  value,
  onChange,
  onClear,
}: {
  cfg: FilterChipConfig;
  label: string;
  value: { values: string[] } | undefined;
  onChange: (values: string[]) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const [needle, setNeedle] = useState("");
  const selected = value?.values ?? [];
  const options = (cfg.options ?? []).map(String);
  const shown = needle
    ? options.filter((o) => o.toLocaleLowerCase().includes(needle.toLocaleLowerCase()))
    : options;
  const summary =
    selected.length === 0
      ? null
      : selected.length === 1
        ? (selected[0] as string)
        : `${selected[0]} +${selected.length - 1}`;

  const toggle = (o: string) =>
    onChange(selected.includes(o) ? selected.filter((s) => s !== o) : [...selected, o]);

  return (
    <Popover onOpenChange={(open) => !open && setNeedle("")}>
      <ChipTrigger field={cfg.field} label={label} summary={summary} onClear={onClear} />
      <PopoverContent className="w-60 p-2" data-testid={`chip-panel-${cfg.field}`}>
        {options.length > 8 ? (
          <Input
            autoFocus
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            placeholder={t("APP", "OPTIONS_FILTER")}
            className="mb-2 h-7 text-xs"
          />
        ) : null}
        <div className="scroll-thin -mx-1 max-h-64 overflow-y-auto px-1">
          {shown.map((o) => (
            // biome-ignore lint/a11y/noLabelWithoutControl: the Radix checkbox inside is the control
            <label
              key={o}
              data-testid={`chip-option-${o}`}
              className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 text-[13px] hover:bg-hover"
            >
              <Checkbox checked={selected.includes(o)} onCheckedChange={() => toggle(o)} />
              <span className="truncate">{o}</span>
            </label>
          ))}
        </div>
        {selected.length ? (
          <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
            <span>{t("APP", "SELECTED_N", { n: selected.length })}</span>
            <Button size="sm" variant="ghost" onClick={onClear}>
              {t("APP", "CLEAR")}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function RangeChip({
  cfg,
  label,
  value,
  onChange,
  onClear,
}: {
  cfg: FilterChipConfig;
  label: string;
  value: { min: number | null; max: number | null } | undefined;
  onChange: (min: number | null, max: number | null) => void;
  onClear: () => void;
}) {
  const { t, intlLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const [lo, setLo] = useState("");
  const [hi, setHi] = useState("");

  useEffect(() => {
    if (open) {
      setLo(value?.min == null ? "" : String(value.min));
      setHi(value?.max == null ? "" : String(value.max));
    }
  }, [open, value?.min, value?.max]);

  const fmt = (n: number) => new Intl.NumberFormat(intlLocale).format(n);
  const summary = !value
    ? null
    : value.min !== null && value.max !== null
      ? `${fmt(value.min)}–${fmt(value.max)}`
      : value.min !== null
        ? `≥ ${fmt(value.min)}`
        : `≤ ${fmt(value.max ?? 0)}`;

  const num = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));
  const apply = () => {
    onChange(num(lo), num(hi));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ChipTrigger field={cfg.field} label={label} summary={summary} onClear={onClear} />
      <PopoverContent className="w-64" data-testid={`chip-panel-${cfg.field}`}>
        <ChipPanel title={label}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                autoFocus
                aria-label={t("APP", "MIN")}
                data-testid={`chip-min-${cfg.field}`}
                placeholder={cfg.min === undefined ? t("APP", "MIN") : String(cfg.min)}
                min={cfg.min}
                max={cfg.max}
                step={cfg.step}
                value={lo}
                onChange={(e) => setLo(e.target.value)}
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="number"
                aria-label={t("APP", "MAX")}
                data-testid={`chip-max-${cfg.field}`}
                placeholder={cfg.max === undefined ? t("APP", "MAX") : String(cfg.max)}
                min={cfg.min}
                max={cfg.max}
                step={cfg.step}
                value={hi}
                onChange={(e) => setHi(e.target.value)}
              />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
              >
                {t("APP", "CLEAR")}
              </Button>
              <Button size="sm" variant="primary" type="submit" data-testid="chip-apply">
                {t("APP", "APPLY")}
              </Button>
            </div>
          </form>
        </ChipPanel>
      </PopoverContent>
    </Popover>
  );
}

function BoolChip({
  cfg,
  label,
  value,
  onChange,
  onClear,
}: {
  cfg: FilterChipConfig;
  label: string;
  value: { value: boolean } | undefined;
  onChange: (v: boolean | null) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const current = value === undefined ? null : value.value;
  const choices: { v: boolean | null; label: string; id: string }[] = [
    { v: null, label: t("APP", "ANY"), id: "any" },
    { v: true, label: t("APP", "YES"), id: "true" },
    { v: false, label: t("APP", "NO"), id: "false" },
  ];
  const summary = current === null ? null : current ? t("APP", "YES") : t("APP", "NO");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ChipTrigger field={cfg.field} label={label} summary={summary} onClear={onClear} />
      <PopoverContent className="w-44 p-1" data-testid={`chip-panel-${cfg.field}`}>
        <div>
          {choices.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={current === c.v}
              data-testid={`chip-option-${c.id}`}
              onClick={() => {
                onChange(c.v);
                setOpen(false);
              }}
              className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-hover focus-visible:bg-hover"
            >
              <span className="grid size-4 place-items-center">
                {current === c.v ? <Check className="size-3.5 text-primary" /> : null}
              </span>
              {c.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function defaultChipLabel(cfg: FilterChipConfig): string {
  return cfg.label ?? humanize(cfg.field);
}
