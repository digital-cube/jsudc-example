/*
 * The brand restyle (src/brand.css): the header switch sets `data-brand` on
 * <html>, the library's table repaints from the redefined variables, the
 * choice survives a reload, and /examples links pick a brand on arrival.
 */

const table = () => cy.get(".udc-table");
const css = (prop: string) =>
  table().then(($t) => getComputedStyle($t[0] as Element)[prop as "color"]);

describe("the brand restyle", () => {
  it("Acme repaints .udc-table and survives a reload; Default puts it back", () => {
    cy.openCompanies();
    cy.get("html").should("not.have.attr", "data-brand");
    css("color").then((defaultColor) => {
      css("fontFamily").then((defaultFont) => {
        cy.get('[data-testid="brand-acme"]').click();
        cy.get("html").should("have.attr", "data-brand", "acme");
        table().should(($t) => {
          const style = getComputedStyle($t[0] as Element);
          expect(style.color, "color under Acme").not.to.eq(defaultColor);
          expect(style.fontFamily, "font under Acme").not.to.eq(defaultFont);
        });

        cy.reload();
        cy.get('[data-testid="row"]', { timeout: 15_000 }).should("have.length.at.least", 1);
        cy.get("html").should("have.attr", "data-brand", "acme");
        cy.get('[data-testid="brand-acme"]').should("have.attr", "data-state", "on");
        css("color").should("not.eq", defaultColor);

        cy.get('[data-testid="brand-default"]').click();
        cy.get("html").should("not.have.attr", "data-brand");
        css("color").should("eq", defaultColor);
      });
    });
  });

  it("/examples explains both layers and its links pick the brand", () => {
    cy.visit("/examples");
    cy.get('[data-testid="menu-EXAMPLES"]').should("have.attr", "aria-current", "page");
    cy.get('[data-testid="examples-kit"]').should("contain", "UdcProvider");
    cy.get('[data-testid="examples-brand"]').should("contain", "brand.css");

    cy.get('[data-testid="examples-link-acme"]').click();
    cy.location("pathname").should("eq", "/udc/companies");
    cy.location("search").should("not.contain", "brand=");
    cy.get("html").should("have.attr", "data-brand", "acme");
    table().should("exist");

    cy.visit("/examples");
    cy.get('[data-testid="examples-link-default"]').click();
    cy.location("pathname").should("eq", "/udc/companies");
    cy.get("html").should("not.have.attr", "data-brand");
  });

  it("?brand=acme on a direct load selects the brand", () => {
    cy.visit("/udc/companies?brand=acme");
    cy.get("html").should("have.attr", "data-brand", "acme");
    cy.location("search").should("not.contain", "brand=");
    cy.window().then((win) => expect(win.localStorage.getItem("example:brand")).to.eq("acme"));
  });
});
