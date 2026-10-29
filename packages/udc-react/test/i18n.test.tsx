import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  intlLocaleOf,
  LOCALE_STORAGE_KEY,
  mergeMessages,
  messageLocales,
  UdcI18nProvider,
  useI18n,
} from "../src/i18n/i18n";
import { TRANSLATIONS } from "../src/i18n/translations";

let api: ReturnType<typeof useI18n> | undefined;

function Probe({ section = "APP", term = "RETRY" }: { section?: string; term?: string }) {
  api = useI18n();
  return (
    <span data-testid="out">
      {api.locale}|{api.t(section, term)}
    </span>
  );
}

const out = () => screen.getByTestId("out").textContent;

describe("mergeMessages", () => {
  it("layers term by term and locale by locale, sections and terms case-insensitive", () => {
    const merged = mergeMessages(
      TRANSLATIONS,
      { app: { retry: { en: "Again" } }, TBL_X: { NAME: { en: "Name", sr: "Naziv" } } },
      { APP: { RETRY: { de: "Nochmal" } } },
    );
    expect(merged.APP?.RETRY).toEqual({ en: "Again", sr: "Pokušaj ponovo", de: "Nochmal" });
    expect(merged.TBL_X?.NAME).toEqual({ en: "Name", sr: "Naziv" });
    // The base is not touched.
    expect(TRANSLATIONS.APP?.RETRY?.en).toBe("Try again");
    expect(messageLocales({ A: { B: { en: "x", de: "y" } } })).toEqual(["en", "de"]);
  });
});

describe("<UdcI18nProvider>", () => {
  it("keeps the locale itself by default, remembered in localStorage", () => {
    render(
      <UdcI18nProvider>
        <Probe />
      </UdcI18nProvider>,
    );
    expect(out()).toBe("en|Try again");
    act(() => api?.setLocale("sr"));
    expect(out()).toBe("sr|Pokušaj ponovo");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("sr");
    expect(document.documentElement.lang).toBe("sr");
  });

  it("follows a controlled locale and reports changes through onLocaleChange", () => {
    const onLocaleChange = vi.fn();
    const { rerender } = render(
      <UdcI18nProvider locale="sr" onLocaleChange={onLocaleChange}>
        <Probe />
      </UdcI18nProvider>,
    );
    expect(out()).toBe("sr|Pokušaj ponovo");
    act(() => api?.setLocale("en"));
    expect(onLocaleChange).toHaveBeenCalledWith("en");
    // Controlled: nothing changes until the host passes the new locale.
    expect(out()).toBe("sr|Pokušaj ponovo");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    rerender(
      <UdcI18nProvider locale="en" onLocaleChange={onLocaleChange}>
        <Probe />
      </UdcI18nProvider>,
    );
    expect(out()).toBe("en|Try again");
  });

  it("takes a host's sections, overrides and extra locales through messages", () => {
    const messages = {
      APP: { RETRY: { en: "Reload", de: "Neu laden" } },
      TBL_BOOKS: { TITLE: { en: "Title", sr: "Naslov" } },
    };
    const { rerender } = render(
      <UdcI18nProvider messages={messages}>
        <Probe />
      </UdcI18nProvider>,
    );
    expect(out()).toBe("en|Reload");
    expect(api?.locales).toEqual(["en", "sr", "de"]);
    act(() => api?.setLocale("de"));
    expect(out()).toBe("de|Neu laden");
    expect(api?.intlLocale).toBe("de");
    // A term the extra locale lacks falls back to en.
    rerender(
      <UdcI18nProvider messages={messages}>
        <Probe term="SEARCH" />
      </UdcI18nProvider>,
    );
    expect(out()).toBe("de|Search");
    rerender(
      <UdcI18nProvider messages={messages}>
        <Probe section="TBL_BOOKS" term="title" />
      </UdcI18nProvider>,
    );
    act(() => api?.setLocale("sr"));
    expect(out()).toBe("sr|Naslov");
  });

  it("maps the built-in locales to Intl tags and passes others through", () => {
    expect(intlLocaleOf("en")).toBe("en-US");
    expect(intlLocaleOf("sr")).toBe("sr-Latn-RS");
    expect(intlLocaleOf("de-AT")).toBe("de-AT");
  });
});
