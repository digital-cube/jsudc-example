import { X } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { cn } from "../lib/utils";

/** A list of short strings: Enter or comma adds the typed one, Backspace on empty drops the last. */
export function TagInput({
  id,
  value,
  onChange,
  placeholder,
  invalid,
  "data-testid": testId,
}: {
  id?: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  invalid?: boolean;
  "data-testid"?: string;
}) {
  const [text, setText] = useState("");
  const add = () => {
    const parts = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) onChange([...value, ...parts.filter((p) => !value.includes(p))]);
    setText("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-surface px-1.5 py-1 shadow-xs transition-[border-color,box-shadow]",
        "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20",
        invalid &&
          "border-sem-danger focus-within:border-sem-danger focus-within:ring-sem-danger/20",
      )}
    >
      {value.map((v) => (
        <span
          key={v}
          data-testid="tag"
          className="inline-flex h-6 items-center gap-1 rounded-md bg-selected pr-0.5 pl-2 text-xs font-medium"
        >
          {v}
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={() => onChange(value.filter((x) => x !== v))}
            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        placeholder={value.length ? undefined : placeholder}
        className="h-6 min-w-24 flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-muted-foreground/80"
      />
    </div>
  );
}
