import type { Condition, FilterableField, FilterNode, FilterOp } from "@jsudc/core";
import { ListFilter, Plus, Trash2, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "../components/ui/button";
import { Input, NativeSelect } from "../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Select } from "../components/ui/select";
import { useI18n } from "../i18n/i18n";
import { cn } from "../lib/utils";
import { conditionsToTree, treeToConditions } from "./compose";

/** Ops that take no value: the builder hides the value input for them. */
export const NULLARY_OPS: readonly FilterOp[] = ["is_null", "is_not_null"];
const LIST_OPS: readonly FilterOp[] = ["in", "not_in"];

/** One builder row while it is being edited: values are input strings. */
export interface DraftRow {
  field: string;
  op: FilterOp;
  value: string;
  value2: string;
}

function toInput(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

export function conditionToDraft(c: Condition): DraftRow {
  if (c.op === "between" && Array.isArray(c.value)) {
    return { field: c.field, op: c.op, value: toInput(c.value[0]), value2: toInput(c.value[1]) };
  }
  if (Array.isArray(c.value)) {
    return { field: c.field, op: c.op, value: c.value.map(toInput).join(", "), value2: "" };
  }
  return { field: c.field, op: c.op, value: toInput(c.value), value2: "" };
}

function coerce(raw: string, widget: string): unknown {
  const s = raw.trim();
  if (widget === "number") return s === "" || !Number.isFinite(Number(s)) ? undefined : Number(s);
  if (widget === "bool") return s === "true" ? true : s === "false" ? false : undefined;
  return s === "" ? undefined : s;
}

/** A finished condition, or `null` while the row still lacks a value. */
export function draftToCondition(
  row: DraftRow,
  fields: readonly FilterableField[],
): Condition | null {
  const f = fields.find((x) => x.field === row.field);
  if (!f?.ops.includes(row.op)) return null;
  if (NULLARY_OPS.includes(row.op)) return { field: row.field, op: row.op };
  if (row.op === "between") {
    const lo = coerce(row.value, f.widget);
    const hi = coerce(row.value2, f.widget);
    return lo === undefined || hi === undefined
      ? null
      : { field: row.field, op: "between", value: [lo, hi] };
  }
  if (LIST_OPS.includes(row.op)) {
    const items = row.value
      .split(",")
      .map((s) => coerce(s, f.widget))
      .filter((v) => v !== undefined);
    return items.length ? { field: row.field, op: row.op, value: items } : null;
  }
  const v = coerce(row.value, f.widget);
  if (v === undefined) return null;
  const ci = f.widget === "text" && ["contains", "starts_with", "ends_with"].includes(row.op);
  return { field: row.field, op: row.op, value: v, ...(ci ? { case_insensitive: true } : {}) };
}

function emptyRow(fields: readonly FilterableField[]): DraftRow {
  const f = fields[0];
  return { field: f?.field ?? "", op: f?.default_op ?? "eq", value: "", value2: "" };
}

export function FilterBuilder({
  fields,
  tree,
  onChange,
  fieldLabel,
}: {
  fields: readonly FilterableField[];
  tree: FilterNode | null;
  onChange: (tree: FilterNode | null) => void;
  fieldLabel: (field: string) => string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DraftRow[]>([]);
  const conditions = treeToConditions(tree);
  const count = conditions === null ? 1 : conditions.length;

  const openWith = (o: boolean) => {
    if (o) {
      const current = conditions ?? [];
      setDraft(current.length ? current.map(conditionToDraft) : [emptyRow(fields)]);
    }
    setOpen(o);
  };

  const patchRow = (i: number, patch: Partial<DraftRow>) =>
    setDraft((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const apply = () => {
    const done = draft
      .map((r) => draftToCondition(r, fields))
      .filter((c): c is Condition => c !== null);
    onChange(conditionsToTree(done));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={openWith}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" data-testid="fb-open" className="h-7 rounded-full">
          <ListFilter className="size-3.5!" />
          {t("APP", "FILTER")}
          {count ? (
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[560px] max-w-[calc(100vw-2rem)] p-0" data-testid="fb-panel">
        <div className="border-b border-border px-4 py-3">
          <div className="text-sm font-semibold">{t("APP", "FILTER_TITLE")}</div>
          <div className="text-xs text-muted-foreground">{t("APP", "FILTER_HINT")}</div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <div className="flex flex-col gap-2 px-4 py-3">
            {draft.length === 0 ? (
              <div className="py-2 text-center text-xs text-muted-foreground">
                {t("APP", "FILTER_EMPTY")}
              </div>
            ) : null}
            {draft.map((row, i) => {
              const f = fields.find((x) => x.field === row.field);
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity besides position
                  key={i}
                  data-testid={`fb-row-${i}`}
                  className="grid grid-cols-[2.5rem_1fr_1fr_1.3fr_auto] items-center gap-2"
                >
                  <span className="text-right text-xs text-muted-foreground">
                    {i === 0 ? "" : t("APP", "AND")}
                  </span>
                  <Select
                    aria-label={t("APP", "FILTER_FIELD")}
                    data-testid={`fb-field-${i}`}
                    value={row.field || undefined}
                    onValueChange={(field) => {
                      const nf = fields.find((x) => x.field === field);
                      patchRow(i, {
                        field,
                        op: nf?.default_op ?? "eq",
                        value: "",
                        value2: "",
                      });
                    }}
                    options={fields.map((x) => ({ value: x.field, label: fieldLabel(x.field) }))}
                  />
                  <Select
                    aria-label={t("APP", "FILTER_OP")}
                    data-testid={`fb-op-${i}`}
                    value={row.op}
                    onValueChange={(op) => patchRow(i, { op: op as FilterOp })}
                    options={(f?.ops ?? []).map((op) => ({
                      value: op,
                      label: t("APP", `OP_${op}`),
                    }))}
                  />
                  <ValueInput row={row} index={i} field={f} onChange={(p) => patchRow(i, p)} />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("APP", "REMOVE")}
                    onClick={() => setDraft((rows) => rows.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-3.5!" />
                  </Button>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between border-t border-border bg-muted/50 px-4 py-2.5">
            <Button
              size="sm"
              variant="ghost"
              data-testid="fb-add"
              onClick={() => setDraft((rows) => [...rows, emptyRow(fields)])}
            >
              <Plus className="size-3.5!" />
              {t("APP", "FILTER_ADD")}
            </Button>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDraft([])}>
                {t("APP", "CLEAR")}
              </Button>
              <Button size="sm" variant="primary" type="submit" data-testid="fb-apply">
                {t("APP", "APPLY")}
              </Button>
            </div>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** The builder's conditions as removable pills; a tree it cannot edit is one pill. */
export function FilterPills({
  fields,
  tree,
  onChange,
  fieldLabel,
}: {
  fields: readonly FilterableField[];
  tree: FilterNode | null;
  onChange: (tree: FilterNode | null) => void;
  fieldLabel: (field: string) => string;
}) {
  const { t, intlLocale } = useI18n();
  const conditions = treeToConditions(tree);

  const formatValue = (c: Condition): string => {
    const f = fields.find((x) => x.field === c.field);
    const one = (v: unknown) =>
      typeof v === "number"
        ? new Intl.NumberFormat(intlLocale).format(v)
        : typeof v === "boolean"
          ? t("APP", v ? "YES" : "NO")
          : String(v);
    if (c.op === "between" && Array.isArray(c.value)) {
      return `${one(c.value[0])} ${t("APP", "AND")} ${one(c.value[1])}`;
    }
    if (Array.isArray(c.value)) return c.value.map(one).join(", ");
    return f?.widget === "text" ? `“${one(c.value)}”` : one(c.value);
  };

  if (conditions === null) {
    return (
      <Pill
        index={0}
        onRemove={() => onChange(null)}
        label={<span className="italic">{t("APP", "FILTER_CUSTOM")}</span>}
      />
    );
  }
  return (
    <>
      {conditions.map((c, i) => (
        <Pill
          // biome-ignore lint/suspicious/noArrayIndexKey: conditions are positional
          key={i}
          index={i}
          onRemove={() => onChange(conditionsToTree(conditions.filter((_, j) => j !== i)))}
          label={
            <>
              <span className="font-medium">{fieldLabel(c.field)}</span>
              <span className="text-muted-foreground">{t("APP", `OP_${c.op}`)}</span>
              {NULLARY_OPS.includes(c.op) ? null : (
                <span className="font-medium text-primary">{formatValue(c)}</span>
              )}
            </>
          }
        />
      ))}
    </>
  );
}

function Pill({
  index,
  label,
  onRemove,
}: {
  index: number;
  label: ReactNode;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  return (
    <span
      data-testid={`fb-pill-${index}`}
      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/8 pr-1 pl-2.5 text-xs"
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("APP", "FILTER_REMOVE")}
        data-testid={`fb-pill-remove-${index}`}
        className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-primary/15 hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

function ValueInput({
  row,
  index,
  field,
  onChange,
}: {
  row: DraftRow;
  index: number;
  field: FilterableField | undefined;
  onChange: (p: Partial<DraftRow>) => void;
}) {
  const { t } = useI18n();
  if (NULLARY_OPS.includes(row.op)) return <span />;
  const widget = field?.widget ?? "text";
  const list = LIST_OPS.includes(row.op);
  const type = list ? "text" : widget === "number" ? "number" : widget === "date" ? "date" : "text";
  const common = "h-8";

  if (widget === "bool") {
    return (
      <NativeSelect
        aria-label={t("APP", "FILTER_VALUE")}
        data-testid={`fb-value-${index}`}
        value={row.value}
        onChange={(e) => onChange({ value: e.target.value })}
      >
        <option value="" disabled>
          {t("APP", "FILTER_VALUE")}
        </option>
        <option value="true">{t("APP", "YES")}</option>
        <option value="false">{t("APP", "NO")}</option>
      </NativeSelect>
    );
  }
  if (row.op === "between") {
    return (
      <div className="flex items-center gap-1">
        <Input
          type={type}
          aria-label={t("APP", "MIN")}
          data-testid={`fb-value-${index}`}
          placeholder={t("APP", "MIN")}
          className={cn(common, "px-2")}
          value={row.value}
          onChange={(e) => onChange({ value: e.target.value })}
        />
        <Input
          type={type}
          aria-label={t("APP", "MAX")}
          data-testid={`fb-value2-${index}`}
          placeholder={t("APP", "MAX")}
          className={cn(common, "px-2")}
          value={row.value2}
          onChange={(e) => onChange({ value2: e.target.value })}
        />
      </div>
    );
  }
  return (
    <Input
      type={type}
      aria-label={t("APP", "FILTER_VALUE")}
      data-testid={`fb-value-${index}`}
      placeholder={list ? t("APP", "FILTER_LIST_HINT") : t("APP", "FILTER_VALUE")}
      className={common}
      value={row.value}
      onChange={(e) => onChange({ value: e.target.value })}
    />
  );
}
