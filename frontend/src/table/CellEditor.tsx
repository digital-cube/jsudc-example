import type { FieldDef } from "@jsudc/core";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Spinner } from "../components/ui/misc";
import { cn } from "../lib/utils";

export type CommitReason = "enter" | "tab" | "shift-tab" | "blur";

export type EditorKind = "text" | "number" | "checkbox" | "date" | "datetime" | "select";

export function editorKind(def: FieldDef | undefined): EditorKind {
  switch (def?.type) {
    case "integer":
    case "decimal":
    case "year":
    case "rating":
      return "number";
    case "bool":
      return "checkbox";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "enum":
      return "select";
    default:
      return "text";
  }
}

/** What the editor's input shows for a stored value. */
export function toEditorValue(v: unknown, kind: EditorKind): string | boolean {
  if (kind === "checkbox") return v === true;
  if (v === null || v === undefined) return "";
  if (kind === "datetime" && typeof v === "string") return v.slice(0, 16);
  return String(v);
}

/**
 * The stored value for the editor's input, or `{error}` when the input
 * cannot be one (the server validates the rest: range, required, length).
 */
export function fromEditorValue(
  raw: string | boolean,
  kind: EditorKind,
  def: FieldDef | undefined,
): { value: unknown } | { error: string } {
  if (kind === "checkbox") return { value: raw === true };
  const s = String(raw);
  if (s.trim() === "") return { value: null };
  if (kind === "number") {
    const n = Number(s);
    if (!Number.isFinite(n)) return { error: "must be a number" };
    if ((def?.type === "integer" || def?.type === "year") && !Number.isInteger(n)) {
      return { error: "must be a whole number" };
    }
    return { value: n };
  }
  if (kind === "datetime") return { value: new Date(s).toISOString() };
  return { value: s };
}

export function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === undefined || v === "" ? null : v);
  return norm(a) === norm(b);
}

/**
 * The input that replaces a cell while it is edited. Enter / blur commit,
 * Tab / Shift+Tab commit and move, Escape cancels.
 */
export function CellEditor({
  def,
  initial,
  saving,
  error,
  errorSeq = 0,
  align,
  onCommit,
  onCancel,
}: {
  def: FieldDef | undefined;
  initial: unknown;
  saving: boolean;
  error: string | null;
  /** Bumped on every failed save, so the same message twice still re-arms the editor. */
  errorSeq?: number;
  align?: "left" | "right" | "center" | undefined;
  onCommit: (raw: string | boolean, reason: CommitReason) => void;
  onCancel: () => void;
}) {
  const kind = editorKind(def);
  const [raw, setRaw] = useState<string | boolean>(() => toEditorValue(initial, kind));
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement && (kind === "text" || kind === "number")) el.select();
  }, [kind]);

  // A failed save re-arms the editor so the next Enter / blur commits again.
  useEffect(() => {
    if (error && errorSeq >= 0) done.current = false;
  }, [error, errorSeq]);

  const commit = (reason: CommitReason, value: string | boolean = raw) => {
    if (done.current || saving) return;
    done.current = true;
    onCommit(value, reason);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit("enter");
    } else if (e.key === "Escape") {
      e.preventDefault();
      done.current = true;
      onCancel();
    } else if (e.key === "Tab") {
      e.preventDefault();
      commit(e.shiftKey ? "shift-tab" : "tab");
    }
  };

  const shell = cn(
    "absolute inset-0 z-20 flex items-center bg-surface px-1.5",
    "ring-2 ring-inset",
    error ? "ring-sem-danger" : "ring-ring",
  );
  const field = cn(
    "h-full w-full min-w-0 bg-transparent text-[13px] text-foreground outline-none",
    align === "right" && "text-right tabular-nums",
    align === "center" && "text-center",
  );

  return (
    <div className={shell} data-testid="cell-editor">
      {kind === "checkbox" ? (
        <label className="flex h-full w-full cursor-pointer items-center justify-center">
          <input
            ref={ref}
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={raw === true}
            disabled={saving}
            onChange={(e) => setRaw(e.target.checked)}
            onKeyDown={onKeyDown}
            onBlur={() => commit("blur")}
          />
        </label>
      ) : kind === "select" ? (
        <select
          ref={ref}
          className={cn(field, "bg-surface")}
          value={String(raw)}
          disabled={saving}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => commit("blur")}
        >
          <option value="">—</option>
          {(def?.values ?? []).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : (
        <input
          ref={ref}
          type={
            kind === "number"
              ? "number"
              : kind === "date"
                ? "date"
                : kind === "datetime"
                  ? "datetime-local"
                  : "text"
          }
          className={cn(field, "[&::-webkit-inner-spin-button]:hidden")}
          value={String(raw)}
          readOnly={saving}
          maxLength={kind === "text" ? def?.length : undefined}
          min={def?.min}
          max={def?.max}
          onChange={(e) => {
            if (error) done.current = false;
            setRaw(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => commit("blur")}
        />
      )}
      {saving ? <Spinner className="ml-1 shrink-0 text-muted-foreground" /> : null}
      {error ? (
        <div
          role="alert"
          data-testid="cell-error"
          className="absolute top-full left-0 z-30 mt-1 w-max max-w-72 rounded-md border border-sem-danger/40 bg-sem-danger-bg px-2 py-1 text-xs font-medium text-sem-danger shadow-md"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
