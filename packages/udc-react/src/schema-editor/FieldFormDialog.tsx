import { type FieldType, isUdcError, type SchemaDoc, type SchemaPosition } from "@jsudc/core";
import { AlertTriangle, Lock } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { DialogBody, DialogContent, DialogFooter } from "../components/ui/dialog";
import { Input, NativeSelect } from "../components/ui/input";
import { Spinner } from "../components/ui/misc";
import { useI18n } from "../i18n/i18n";
import { cn } from "../lib/utils";
import { useUdcSchema } from "../udc/hooks";
import {
  type DraftErrors,
  draftFromDef,
  draftToFieldDef,
  emptyDraft,
  type FieldDraft,
  FORM_TYPES,
  nameProblem,
  suggestName,
  typeControls,
  validateDraft,
} from "./fieldForm";
import { TagInput } from "./TagInput";

export type FieldFormTarget =
  | { mode: "add"; position: SchemaPosition }
  | { mode: "edit"; field: string };

/**
 * The add / edit column form, inside an open `<Dialog>`. Client-side
 * validation runs before anything is sent; what the server still refuses
 * (`validation_error`, `unsupported_op`) is shown inline, and the dialog
 * stays open.
 */
export function FieldFormDialog({
  collection,
  schema,
  target,
  fieldLabel,
  onSaved,
  onCancel,
}: {
  collection: string;
  schema: SchemaDoc;
  target: FieldFormTarget;
  fieldLabel: (field: string) => string;
  onSaved: (name: string, label: string) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const { addField, updateField } = useUdcSchema(collection);
  const mode = target.mode;
  const current = mode === "edit" ? schema.fields[target.field] : undefined;

  const [draft, setDraft] = useState<FieldDraft>(() =>
    target.mode === "edit" && current ? draftFromDef(target.field, current) : emptyDraft(),
  );
  const [nameTouched, setNameTouched] = useState(mode === "edit");
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<{ code: string; message: string } | null>(null);
  const pending = addField.isPending || updateField.isPending;

  const set = <K extends keyof FieldDraft>(key: K, v: FieldDraft[K]) => {
    setServerError(null);
    setDraft((d) => {
      const next = { ...d, [key]: v };
      if (key === "labelEn" && !nameTouched && mode === "add") next.name = suggestName(String(v));
      return next;
    });
  };

  const errors: DraftErrors = attempted ? validateDraft(draft, mode, schema) : {};
  // The name is checked live, as the user types; an empty one only after a submit.
  const liveName = draft.name ? nameProblem(draft.name, mode, schema) : null;
  const nameError = errors.name ?? liveName;
  const controls = typeControls(draft.type);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    const problems = validateDraft(draft, mode, schema);
    if (Object.keys(problems).length) {
      const first = Object.keys(problems)[0];
      document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    setServerError(null);
    const fielddef = draftToFieldDef(draft, current);
    try {
      if (target.mode === "add") {
        await addField.mutateAsync({ name: draft.name, fielddef, position: target.position });
      } else {
        await updateField.mutateAsync({ name: target.field, fielddef });
      }
      const label =
        (locale === "sr" ? draft.labelSr : draft.labelEn).trim() || draft.labelEn.trim();
      onSaved(draft.name, label || fieldLabel(draft.name));
    } catch (err) {
      setServerError(
        isUdcError(err)
          ? { code: err.code, message: err.message }
          : { code: "internal", message: err instanceof Error ? err.message : String(err) },
      );
    }
  };

  const position = target.mode === "add" ? target.position : null;
  const positionNote = position
    ? position.where === "end" || !position.anchor
      ? t("APP", "FORM_POS_END")
      : t("APP", position.where === "before" ? "FORM_POS_BEFORE" : "FORM_POS_AFTER", {
          label: fieldLabel(position.anchor),
        })
    : null;

  return (
    <DialogContent
      data-testid="field-form"
      data-mode={mode}
      title={
        mode === "add"
          ? t("APP", "FORM_ADD_TITLE")
          : t("APP", "FORM_EDIT_TITLE", { label: fieldLabel(draft.name) })
      }
      description={positionNote ?? t("APP", "FORM_EDIT_BODY")}
      onEscapeKeyDown={(e) => pending && e.preventDefault()}
      onInteractOutside={(e) => pending && e.preventDefault()}
    >
      <form noValidate onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-col">
        <DialogBody className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field
              id={`${id}-name`}
              label={t("APP", "FORM_NAME")}
              error={nameError ? t("APP", nameError) : null}
              hint={mode === "add" ? t("APP", "FORM_NAME_HINT") : null}
            >
              <Input
                id={`${id}-name`}
                data-testid="field-name"
                value={draft.name}
                readOnly={mode === "edit"}
                autoFocus={mode === "add"}
                autoComplete="off"
                spellCheck={false}
                placeholder="website"
                aria-invalid={nameError ? true : undefined}
                onChange={(e) => {
                  setNameTouched(true);
                  set("name", e.target.value);
                }}
                className={cn(
                  "font-mono text-[12.5px]",
                  mode === "edit" && "bg-muted text-muted-foreground",
                  nameError &&
                    "border-sem-danger focus-visible:border-sem-danger focus-visible:ring-sem-danger/20",
                )}
              />
            </Field>
            <Field id={`${id}-type`} label={t("APP", "FORM_TYPE")}>
              <NativeSelect
                id={`${id}-type`}
                data-testid="field-type"
                value={draft.type}
                disabled={mode === "edit"}
                onChange={(e) => set("type", e.target.value as FieldType)}
              >
                {(FORM_TYPES.includes(draft.type) ? FORM_TYPES : [draft.type, ...FORM_TYPES]).map(
                  (type) => (
                    <option key={type} value={type}>
                      {t("APP", `TYPE_${type}`)}
                    </option>
                  ),
                )}
              </NativeSelect>
            </Field>
          </div>
          {mode === "edit" ? (
            <p
              data-testid="type-locked"
              className="-mt-2 flex items-start gap-1.5 text-xs text-muted-foreground"
            >
              <Lock className="mt-px size-3 shrink-0" />
              {t("APP", "FORM_TYPE_LOCKED")}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field id={`${id}-label-en`} label={t("APP", "FORM_LABEL_EN")} badge="EN">
              <Input
                id={`${id}-label-en`}
                data-testid="field-label-en"
                value={draft.labelEn}
                placeholder="Website"
                onChange={(e) => set("labelEn", e.target.value)}
              />
            </Field>
            <Field id={`${id}-label-sr`} label={t("APP", "FORM_LABEL_SR")} badge="SR">
              <Input
                id={`${id}-label-sr`}
                data-testid="field-label-sr"
                value={draft.labelSr}
                placeholder="Veb sajt"
                onChange={(e) => set("labelSr", e.target.value)}
              />
            </Field>
          </div>

          {controls.length ? (
            <Field
              id={`${id}-length`}
              label={t("APP", "FORM_LENGTH")}
              hint={t("APP", "FORM_LENGTH_HINT")}
              error={errors.length ? t("APP", errors.length) : null}
            >
              <Input
                id={`${id}-length`}
                data-testid="field-length"
                type="number"
                min={1}
                inputMode="numeric"
                value={draft.length}
                onChange={(e) => set("length", e.target.value)}
                className="w-32 tabular-nums"
              />
            </Field>
          ) : null}
          {controls.range ? (
            <div className="grid grid-cols-2 gap-3">
              {(["min", "max"] as const).map((k) => (
                <Field
                  key={k}
                  id={`${id}-${k}`}
                  label={t("APP", k === "min" ? "FORM_MIN" : "FORM_MAX")}
                  error={errors[k] ? t("APP", errors[k]) : null}
                >
                  <Input
                    id={`${id}-${k}`}
                    data-testid={`field-${k}`}
                    type="number"
                    step={draft.type === "decimal" ? "any" : 1}
                    value={draft[k]}
                    placeholder={t("APP", "FORM_NO_LIMIT")}
                    onChange={(e) => set(k, e.target.value)}
                    className="tabular-nums"
                  />
                </Field>
              ))}
            </div>
          ) : null}
          {controls.values ? (
            <Field
              id={`${id}-values`}
              label={t("APP", "FORM_VALUES")}
              hint={t("APP", "FORM_VALUES_HINT")}
              error={errors.values ? t("APP", errors.values) : null}
            >
              <TagInput
                id={`${id}-values`}
                data-testid="field-values"
                value={draft.values}
                invalid={!!errors.values}
                onChange={(v) => set("values", v)}
              />
            </Field>
          ) : null}

          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/40 p-3">
            <Toggle
              id={`${id}-required`}
              testId="field-required"
              checked={draft.required}
              onChange={(v) => set("required", v)}
              label={t("APP", "FORM_REQUIRED")}
              hint={t("APP", "FORM_REQUIRED_HINT")}
            />
            <Toggle
              id={`${id}-index`}
              testId="field-index"
              checked={draft.index}
              onChange={(v) => set("index", v)}
              label={t("APP", "FORM_INDEX")}
              hint={t("APP", "FORM_INDEX_HINT")}
            />
          </div>

          {serverError ? (
            <div
              role="alert"
              data-testid="field-form-error"
              data-code={serverError.code}
              className="flex items-start gap-2 rounded-lg border border-sem-danger/30 bg-sem-danger-bg px-3 py-2.5 text-[13px] text-sem-danger"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">{t("APP", "FORM_SERVER_ERROR")}</div>
                <div className="mt-0.5 text-xs break-words opacity-90">{serverError.message}</div>
              </div>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            {t("APP", "CANCEL")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            data-testid="field-form-submit"
            disabled={pending}
          >
            {pending ? <Spinner /> : null}
            {mode === "add" ? t("APP", "FORM_ADD_SUBMIT") : t("APP", "SAVE")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  badge,
  children,
}: {
  id: string;
  label: string;
  hint?: string | null;
  error?: string | null;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-medium">
        {label}
        {badge ? (
          <span className="rounded border border-border px-1 font-mono text-[9.5px] leading-3.5 text-muted-foreground">
            {badge}
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p data-testid="field-error" data-for={id} className="text-xs text-sem-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function Toggle({
  id,
  testId,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  testId: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox
        id={id}
        data-testid={testId}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <label htmlFor={id} className="min-w-0 cursor-pointer select-none">
        <span className="block text-[13px] leading-5 font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </label>
    </div>
  );
}
