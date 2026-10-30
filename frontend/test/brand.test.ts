import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyBrand, BRAND_KEY, loadBrand, setBrand } from "../src/shell/brand";

const css = readFileSync(join(import.meta.dirname, "..", "src", "brand.css"), "utf8");

/** Every `selector { declarations }` of a flat stylesheet, comments removed. */
function rules(source: string): { selector: string; declarations: string[] }[] {
  const flat = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: (selector as string).trim(),
    declarations: (body as string)
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean),
  }));
}

describe("src/brand.css", () => {
  it("is nothing but custom-property declarations under [data-brand=acme]", () => {
    const all = rules(css);
    expect(all.length).toBeGreaterThan(0);
    // Nothing outside a rule (no @import, no @layer, no stray text) and no nesting.
    expect(
      css
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/[^{}]+\{[^{}]*\}/g, "")
        .trim(),
    ).toBe("");
    for (const { selector, declarations } of all) {
      expect(selector).toMatch(/^html\[data-brand="acme"\](\.dark)?$/);
      for (const d of declarations) expect(d).toMatch(/^--[a-z0-9-]+\s*:/);
    }
  });

  it("redefines the tokens the ticket names", () => {
    const names = new Set(
      rules(css).flatMap((r) => r.declarations.map((d) => d.slice(0, d.indexOf(":")).trim())),
    );
    for (const n of ["--background", "--foreground", "--primary", "--radius", "--font-sans"]) {
      expect(names).toContain(n);
    }
    expect([...names].some((n) => n.startsWith("--sem-"))).toBe(true);
    expect([...names].filter((n) => n.startsWith("--chart-"))).toHaveLength(8);
  });
});

describe("the brand switch's state", () => {
  it("puts data-brand on <html>, stores it, and default removes it", () => {
    expect(loadBrand()).toBe("default");
    setBrand("acme");
    expect(document.documentElement.getAttribute("data-brand")).toBe("acme");
    expect(localStorage.getItem(BRAND_KEY)).toBe("acme");
    expect(loadBrand()).toBe("acme");
    setBrand("default");
    expect(document.documentElement.hasAttribute("data-brand")).toBe(false);
    expect(loadBrand()).toBe("default");
  });

  it("ignores a stored value that is no brand", () => {
    localStorage.setItem(BRAND_KEY, "nope");
    expect(loadBrand()).toBe("default");
    applyBrand(loadBrand());
    expect(document.documentElement.hasAttribute("data-brand")).toBe(false);
  });
});
