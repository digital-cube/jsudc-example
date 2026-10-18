import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { humanize, storage } from "../lib/utils";
import { LOCALES, type Locale, TRANSLATIONS, type Translations } from "./translations";

export const LOCALE_STORAGE_KEY = "udc-locale";

/** The BCP 47 tag `Intl` formats numbers and dates with. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", sr: "sr-Latn-RS" };

export type Vars = Record<string, string | number>;

function fill(s: string, vars: Vars | undefined): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => String(vars[k] ?? m)) : s;
}

/** The translation of `SECTION.TERM`, or `null` when neither the locale nor `en` has one. */
export function lookup(
  translations: Translations,
  locale: Locale,
  section: string,
  term: string,
): string | null {
  const entry = translations[section.toUpperCase()]?.[term.toUpperCase()];
  return entry?.[locale] ?? entry?.en ?? null;
}

/** `t` for a fixed locale; a missing term falls back to the humanised term (`revenue_eur` → `Revenue eur`). */
export function makeT(locale: Locale, translations: Translations = TRANSLATIONS) {
  return (section: string, term: string, vars?: Vars): string =>
    fill(lookup(translations, locale, section, term) ?? humanize(term), vars);
}

export function isLocale(v: unknown): v is Locale {
  return (LOCALES as readonly unknown[]).includes(v);
}

function initialLocale(): Locale {
  const stored = storage.get(LOCALE_STORAGE_KEY);
  return isLocale(stored) ? stored : "en";
}

interface I18n {
  locale: Locale;
  intlLocale: string;
  setLocale: (l: Locale) => void;
  t: (section: string, term: string, vars?: Vars) => string;
  /** The translation, or `null` when there is none (so a caller can use its own fallback). */
  tMaybe: (section: string, term: string, vars?: Vars) => string | null;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((l: Locale) => {
    storage.set(LOCALE_STORAGE_KEY, l);
    setLocaleState(l);
  }, []);

  const value = useMemo<I18n>(() => {
    document.documentElement.lang = locale;
    return {
      locale,
      intlLocale: INTL_LOCALE[locale],
      setLocale,
      t: makeT(locale),
      tMaybe: (section, term, vars) => {
        const s = lookup(TRANSLATIONS, locale, section, term);
        return s === null ? null : fill(s, vars);
      },
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n needs an <I18nProvider> above it");
  return ctx;
}

/** The translation section of a collection's own strings: `companies` → `TBL_COMPANIES`. */
export function tableSection(collection: string): string {
  return `TBL_${collection.toUpperCase()}`;
}
