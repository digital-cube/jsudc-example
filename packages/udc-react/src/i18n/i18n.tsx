import type { SchemaDoc } from "@jsudc/core";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { humanize, storage } from "../lib/utils";
import { type BuiltinLocale, LOCALES, type Locale, type Term, TRANSLATIONS } from "./translations";

export const LOCALE_STORAGE_KEY = "udc-locale";

/** The BCP 47 tag `Intl` formats numbers and dates with, per built-in locale. */
export const INTL_LOCALE: Record<BuiltinLocale, string> = { en: "en-US", sr: "sr-Latn-RS" };

/** `Intl`'s tag for a locale: the built-in ones are mapped, any other is used as it is. */
export function intlLocaleOf(locale: Locale): string {
  return (INTL_LOCALE as Record<string, string>)[locale] ?? locale;
}

export type Vars = Record<string, string | number>;

function fill(s: string, vars: Vars | undefined): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => String(vars[k] ?? m)) : s;
}

/** Sections of terms where a locale may be missing: runtime terms (field labels from the schema), a host's messages. */
export type Overlay = Record<string, Record<string, Partial<Term>>>;

/**
 * What a host passes to `<UdcI18nProvider messages>`: its own sections
 * (`COLLECTIONS`, `TBL_<COLLECTION>`, its chrome), overrides of library terms
 * (`APP.RETRY.en`), and strings in locales the library does not ship (`de`).
 */
export type Messages = Overlay;

/** `base` with `layers` over it, term by term and locale by locale: the later layer wins. */
export function mergeMessages(base: Overlay, ...layers: (Overlay | undefined)[]): Overlay {
  const out: Overlay = { ...base };
  for (const layer of layers) {
    if (!layer) continue;
    for (const [section, terms] of Object.entries(layer)) {
      const s = section.toUpperCase();
      const merged = { ...out[s] };
      for (const [term, entry] of Object.entries(terms)) {
        const k = term.toUpperCase();
        merged[k] = { ...merged[k], ...entry };
      }
      out[s] = merged;
    }
  }
  return out;
}

/** Every locale a dictionary has at least one string in. */
export function messageLocales(messages: Overlay): Locale[] {
  const found = new Set<string>();
  for (const terms of Object.values(messages))
    for (const entry of Object.values(terms)) for (const l of Object.keys(entry)) found.add(l);
  return [...found];
}

/**
 * The translation of `SECTION.TERM`, or `null` when neither the locale nor
 * `en` has one. An `overlay` entry wins over the static map, locale by locale.
 */
export function lookup(
  translations: Overlay,
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
export function makeT(locale: Locale, translations: Overlay = TRANSLATIONS, overlay?: Overlay) {
  return (section: string, term: string, vars?: Vars): string =>
    fill(lookup(translations, locale, section, term, overlay) ?? humanize(term), vars);
}

/**
 * The labels a schema's fields carry, as overlay terms. `fielddef.label` is
 * `{en, sr}` (what the field form writes) or a plain string for every locale.
 */
export function schemaLabelTerms(
  schema: SchemaDoc,
  locales: readonly Locale[] = LOCALES,
): Record<string, Partial<Term>> {
  const out: Record<string, Partial<Term>> = {};
  for (const [name, def] of Object.entries(schema.fields)) {
    const label = (def as { label?: unknown }).label;
    const term: Partial<Term> = {};
    if (typeof label === "string" && label.trim()) {
      for (const l of locales) term[l] = label.trim();
    } else if (label && typeof label === "object") {
      for (const l of locales) {
        const v = (label as Record<string, unknown>)[l];
        if (typeof v === "string" && v.trim()) term[l] = v.trim();
      }
    }
    if (Object.keys(term).length) out[name.toUpperCase()] = term;
  }
  return out;
}

export function isLocale(v: unknown, locales: readonly Locale[] = LOCALES): v is Locale {
  return (locales as readonly unknown[]).includes(v);
}

function initialLocale(locales: readonly Locale[]): Locale {
  const stored = storage.get(LOCALE_STORAGE_KEY);
  return isLocale(stored, locales) ? stored : "en";
}

interface I18n {
  locale: Locale;
  intlLocale: string;
  /** The locales on offer: the built-in ones and those the host's messages add. */
  locales: readonly Locale[];
  setLocale: (l: Locale) => void;
  t: (section: string, term: string, vars?: Vars) => string;
  /** The translation, or `null` when there is none (so a caller can use its own fallback). */
  tMaybe: (section: string, term: string, vars?: Vars) => string | null;
  /** Replace the runtime terms of one section (the field labels of a collection's schema). */
  setSectionTerms: (section: string, terms: Record<string, Partial<Term>>) => void;
}

const I18nContext = createContext<I18n | null>(null);

export interface UdcI18nProviderProps {
  children: ReactNode;
  /**
   * The locale to show. Leave it out and the provider keeps the locale
   * itself, remembered in localStorage (`udc-locale`).
   */
  locale?: Locale;
  /** Called with every locale `setLocale` is asked for; a host that passes `locale` stores it here. */
  onLocaleChange?: (locale: Locale) => void;
  /** Layered over the library's dictionary: the host's own sections, overrides, other locales. */
  messages?: Messages;
  /** The locales on offer. Default: `en`, `sr` and every locale `messages` has a string in. */
  locales?: readonly Locale[];
}

/**
 * Strings for everything under it. `t(section, term)` looks in the runtime
 * terms (a schema's field labels), then `messages`, then the library's
 * dictionary, in the current locale and then in `en`; a term found nowhere
 * is humanised (`revenue_eur` → `Revenue eur`).
 */
export function UdcI18nProvider({
  children,
  locale: controlled,
  onLocaleChange,
  messages,
  locales: localesProp,
}: UdcI18nProviderProps) {
  const dictionary = useMemo(() => mergeMessages(TRANSLATIONS, messages), [messages]);
  const locales = useMemo<readonly Locale[]>(
    () => localesProp ?? [...new Set<Locale>([...LOCALES, ...messageLocales(messages ?? {})])],
    [localesProp, messages],
  );
  const [own, setOwn] = useState<Locale>(() => initialLocale(locales));
  const [overlay, setOverlay] = useState<Overlay>({});
  const locale = controlled ?? own;

  const setLocale = useCallback(
    (l: Locale) => {
      if (controlled === undefined) {
        storage.set(LOCALE_STORAGE_KEY, l);
        setOwn(l);
      }
      onLocaleChange?.(l);
    },
    [controlled, onLocaleChange],
  );

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
      intlLocale: intlLocaleOf(locale),
      locales,
      setLocale,
      t: makeT(locale, dictionary, overlay),
      tMaybe: (section, term, vars) => {
        const s = lookup(dictionary, locale, section, term, overlay);
        return s === null ? null : fill(s, vars);
      },
      setSectionTerms,
    };
  }, [locale, locales, setLocale, dictionary, overlay, setSectionTerms]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n needs a <UdcI18nProvider> above it");
  return ctx;
}

/** The translation section of a collection's own strings: `companies` → `TBL_COMPANIES`. */
export function tableSection(collection: string): string {
  return `TBL_${collection.toUpperCase()}`;
}
