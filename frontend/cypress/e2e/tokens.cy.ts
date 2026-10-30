/*
 * The library's radius and font are runtime tokens (@jsudc/react 0.2.1): a host
 * that sets `--radius` and `--font-sans` on :root restyles every component,
 * without touching any internal `--udc-*` name and without the brand switch.
 */

/** Every element the library rounds with a `udc:rounded-*` step (not the pills). */
const rounded = (doc: Document) =>
  [...doc.querySelectorAll<HTMLElement>('[class*="udc:rounded"]')].filter(
    (el) => !/udc:rounded-full/.test(el.className),
  );

describe("the library's radius and font tokens", () => {
  it("--radius: 0 squares the corners and --font-sans: serif sets the font", () => {
    cy.openCompanies();
    cy.get("html").should("not.have.attr", "data-brand");
    cy.document().then((doc) => {
      const els = rounded(doc);
      expect(els.length, "rounded elements").to.be.greaterThan(3);
      expect(
        els.some((el) => getComputedStyle(el).borderTopLeftRadius !== "0px"),
        "rounded by default",
      ).to.eq(true);

      doc.documentElement.style.setProperty("--radius", "0");
      doc.documentElement.style.setProperty("--font-sans", "serif");
    });
    cy.document().should((doc) => {
      const square = rounded(doc).filter(
        (el) => getComputedStyle(el).borderTopLeftRadius === "0px",
      );
      expect(square.length, "square corners").to.eq(rounded(doc).length);
      // `html` takes the font from the library's own sheet, not from the shell's body rule.
      expect(getComputedStyle(doc.documentElement).fontFamily).to.eq("serif");
      expect(getComputedStyle(doc.querySelector(".udc-table") as Element).fontFamily).to.eq(
        "serif",
      );
    });
  });
});
