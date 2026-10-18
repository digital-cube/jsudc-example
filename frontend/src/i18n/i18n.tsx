import type { SchemaDoc } from "@jsudc/udc-core";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { humanize, storage } from "../lib/utils";
import { LOCALES, type Locale, type Term, TRANSLATIONS, type Translations } from "./translations";

export const LOCALE_STORAGE_KEY = "udc-locale";

/** The BCP 47 tag `Intl` formats numbers and dates with. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", sr: "sr-Latn-RS" };

export type Vars = Record<string, string | number>;

function fill(s: string, vars: Vars | undefined): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => String(vars[k] ?? m)) : s;
}

/** Terms learnt at runtime (field labels from the schema); a locale may be missing. */
export type Overlay = Record<string, Record<string, Partial<Term>>>;

/**
 * The translation of `SECTION.TERM`, or `null` when neither the locale nor
 * `en` has one. An `overlay` entry wins over the static map, locale by locale.
 */
export function lookup(
  translations: Translations,
  locale: Locale,
  section: string,
  term: string,
  overlay?: Overlay,
): string | null {
  const s = section.toUpperCase();
  const k = term.toUpperCase();
  const extra = overlay?.[s]?.[k];
  const entry = translations[s]?.[k];
  return extra?.[locale] || entry?.[locale] || extra?.en || entry?.en || null;
}

/** `t` for a fixed locale; a missing term falls back to the humanised term (`revenue_eur` → `Revenue eur`). */
export function makeT(
  locale: Locale,
  translations: Translations = TRANSLATIONS,
  overlay?: Overlay,
) {
  return (section: string, term: string, vars?: Vars): string =>
    fill(lookup(translations, locale, section, term, overlay) ?? humanize(term), vars);
}

/**
 * The labels a schema's fields carry, as overlay terms. `fielddef.label` is
 * `{en, sr}` (what the field form writes) or a plain string for every locale.
 */
export function schemaLabelTerms(schema: SchemaDoc): Record<string, Partial<Term>> {
  const out: Record<string, Partial<Term>> = {};
  for (const [name, def] of Object.entries(schema.fields)) {
    const label = (def as { label?: unknown }).label;
    const term: Partial<Term> = {};
    if (typeof label === "string" && label.trim()) {
      for (const l of LOCALES) term[l] = label.trim();
    } else if (label && typeof label === "object") {
      for (const l of LOCALES) {
        const v = (label as Record<string, unknown>)[l];
        if (typeof v === "string" && v.trim()) term[l] = v.trim();
      }
    }
    if (Object.keys(term).length) out[name.toUpperCase()] = term;
  }
  return out;
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
  /** Replace the runtime terms of one section (the field labels of a collection's schema). */
  setSectionTerms: (section: string, terms: Record<string, Partial<Term>>) => void;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [overlay, setOverlay] = useState<Overlay>({});

  const setLocale = useCallback((l: Locale) => {
    storage.set(LOCALE_STORAGE_KEY, l);
    setLocaleState(l);
  }, []);

  const setSectionTerms = useCallback(
    (section: string, terms: Record<string, Partial<Term>>) =>
      setOverlay((prev) => {
        const key = section.toUpperCase();
        if (JSON.stringify(prev[key] ?? {}) === JSON.stringify(terms)) return prev;
        return { ...prev, [key]: terms };
      }),
    [],
  );

  const value = useMemo<I18n>(() => {
    document.documentElement.lang = locale;
    return {
      locale,
      intlLocale: INTL_LOCALE[locale],
      setLocale,
      t: makeT(locale, TRANSLATIONS, overlay),
      tMaybe: (section, term, vars) => {
        const s = lookup(TRANSLATIONS, locale, section, term, overlay);
        return s === null ? null : fill(s, vars);
      },
      setSectionTerms,
    };
  }, [locale, setLocale, overlay, setSectionTerms]);

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
