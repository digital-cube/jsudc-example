import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { storage } from "./utils";

export type Theme = "light" | "dark";

/** Read by the inline script in index.html too, before the first paint. */
export const THEME_STORAGE_KEY = "udc-theme";

function initialTheme(): Theme {
  return storage.get(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = initialTheme();
    apply(t);
    return t;
  });

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      storage.set(THEME_STORAGE_KEY, next);
      apply(next);
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme needs a <ThemeProvider> above it");
  return ctx;
}
