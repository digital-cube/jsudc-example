import { describe, expect, it } from "vitest";
import { applyTransforms, formatDatePattern, titlecase, truncate } from "../src/table/transforms";

describe("transforms", () => {
  it("titlecase capitalises every word, Serbian letters included", () => {
    expect(applyTransforms("ORAO ELEKTRO DOO", "titlecase")).toBe("Orao Elektro Doo");
    expect(titlecase("šumadija-servis čačak")).toBe("Šumadija-Servis Čačak");
  });

  it("truncate:N clips with an ellipsis", () => {
    expect(applyTransforms("Informacione tehnologije", "truncate:11")).toBe("Informacion…");
    expect(applyTransforms("short", "truncate:11")).toBe("short");
    expect(truncate("ab cd", 3)).toBe("ab…");
    expect(applyTransforms("short", "truncate:x")).toBe("short");
  });

  it("date_format supports DD.MM.YYYY, YYYY-MM-DD and MMM YYYY", () => {
    expect(applyTransforms("2002-07-14", "date_format:DD.MM.YYYY")).toBe("14.07.2002");
    expect(applyTransforms("2002-07-14", "date_format:YYYY-MM-DD")).toBe("2002-07-14");
    expect(applyTransforms("2002-07-14", "date_format:MMM YYYY")).toBe("Jul 2002");
    expect(formatDatePattern("2026-10-18T23:30:00Z", "DD.MM.YYYY HH:mm")).toBe("18.10.2026 23:30");
  });

  it("date_format reads the calendar day literally (no time-zone shift)", () => {
    expect(applyTransforms("2002-01-01", "date_format:DD.MM.YYYY")).toBe("01.01.2002");
  });

  it("MMM follows the locale", () => {
    expect(applyTransforms("2002-08-14", "date_format:MMM YYYY", "sr-Latn-RS")).toMatch(
      /^avg 2002$/i,
    );
  });

  it("chains left to right and passes the wrong shapes through", () => {
    expect(applyTransforms("HELLO WORLD", ["titlecase", "truncate:5"])).toBe("Hello…");
    expect(applyTransforms(42, "titlecase")).toBe(42);
    expect(applyTransforms("not a date", "date_format:DD.MM.YYYY")).toBe("not a date");
    expect(applyTransforms("x", "no_such")).toBe("x");
    expect(applyTransforms("x", undefined)).toBe("x");
  });
});
