import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { inputClass } from "../components/ui/input";
import { useI18n } from "../i18n/i18n";
import { cn } from "../lib/utils";

export const SEARCH_DEBOUNCE_MS = 300;

/** The search input; reports the text upwards 300 ms after the last keystroke. */
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (q: string) => void;
  placeholder: string;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(value);
  const emitted = useRef(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // The URL changed from elsewhere (clear filters, a pasted link): follow it.
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    if (text === emitted.current) return;
    const timer = setTimeout(() => {
      emitted.current = text;
      onChange(text);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, onChange]);

  const clear = () => {
    setText("");
    emitted.current = "";
    onChange("");
    inputRef.current?.focus();
  };

  return (
    <div className="relative w-72 shrink-0">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        type="search"
        data-testid="search-input"
        aria-label={t("APP", "SEARCH")}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            e.preventDefault();
            clear();
          }
        }}
        className={cn(inputClass, "pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden")}
      />
      {text ? (
        <button
          type="button"
          onClick={clear}
          aria-label={t("APP", "SEARCH_CLEAR")}
          className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
