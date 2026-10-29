import type { FilterNode } from "@jsudc/core";
import { decodeParam } from "../support/e2e";

const rows = () => cy.get('[data-testid="row"]');
const totalShown = () => cy.get('[data-testid="row-count"]');

/** The server's total for a filter, straight from `/udc/list`. */
function serverTotal(filter?: FilterNode) {
  return cy
    .udc("list", { collection: "companies", ...(filter ? { filter } : {}), page: { limit: 1 } })
    .then((res) => res.total as number);
}

describe("companies table", () => {
  before(() => cy.reseed());

  it("renders the view's columns with translated headers", () => {
    cy.udc("describe", { collection: "companies" }).then(({ view }) => {
      cy.openCompanies();
      cy.get("thead th[data-testid^='th-']")
        .then(($th) => [...$th].map((th) => th.dataset.testid?.slice(3)))
        .should(
          "deep.equal",
          view.columns.map((c) => c.field),
        );
    });
    cy.get('[data-testid="th-name"]').should("have.text", "Name");
    cy.get('[data-testid="th-revenue_eur"]').should("have.text", "Revenue (EUR)");
    cy.get('[data-testid="th-mb"]').should("have.text", "Reg. no.");
    rows().should("have.length", 50);
    totalShown().should("have.attr", "data-total", "200");
  });

  it("sorts by employees: asc, then desc with the maximum first", () => {
    cy.udc("list", {
      collection: "companies",
      sort: [{ field: "employees", dir: "desc" }],
      page: { limit: 1 },
    }).then(({ rows: [top] }) => {
      const max = Number(top?.employees).toLocaleString("en-US");
      cy.openCompanies();
      cy.get('[data-testid="sort-employees"]').click();
      cy.location("search").should("contain", "sort=employees%3Aasc");
      cy.get('[data-testid="th-employees"]').should("have.attr", "aria-sort", "ascending");
      cy.get('[data-testid="sort-employees"]').click();
      cy.location("search").should("contain", "sort=employees%3Adesc");
      cy.get('[data-testid="th-employees"]').should("have.attr", "aria-sort", "descending");
      rows().first().find('[data-testid="cell-employees"]').should("have.text", max);
    });
  });

  it("search narrows the rows and the count matches /udc/list", () => {
    cy.udc("describe", { collection: "companies" }).then(({ view }) => {
      const fields = view.search?.fields ?? [];
      const filter: FilterNode = {
        or: fields.map((field) => ({
          field,
          op: "contains" as const,
          value: "Beograd",
          case_insensitive: true,
        })),
      };
      serverTotal(filter).then((total) => {
        expect(total).to.be.within(1, 199);
        cy.openCompanies();
        cy.get('[data-testid="search-input"]').type("Beograd");
        cy.location("search").should("contain", "q=Beograd");
        totalShown().should("have.attr", "data-total", String(total));
        rows().should("have.length", Math.min(total, 50));
        cy.get('[data-testid="cell-city"]').each(($c) => expect($c.text()).to.eq("Beograd"));
      });
    });
  });

  it("chip active = false filters", () => {
    serverTotal({ field: "active", op: "eq", value: false }).then((total) => {
      cy.openCompanies();
      cy.get('[data-testid="chip-active"]').click();
      cy.get('[data-testid="chip-option-false"]').click();
      cy.location("search").should((s) =>
        expect(decodeParam(s, "cf")).to.deep.eq({ active: { kind: "bool", value: false } }),
      );
      totalShown().should("have.attr", "data-total", String(total));
      cy.get('[data-testid="cell-active"] [data-bool="true"]').should("not.exist");
      cy.get('[data-testid="cell-active"] [data-bool="false"]').should(
        "have.length",
        Math.min(total, 50),
      );
      cy.get('[data-testid="chip-clear-active"]').click();
      totalShown().should("have.attr", "data-total", "200");
    });
  });

  it("filter builder: employees between 100 and 200 is encoded in ?f= and survives a reload", () => {
    const expected: FilterNode = {
      and: [{ field: "employees", op: "between", value: [100, 200] }],
    };
    serverTotal(expected).then((total) => {
      cy.openCompanies();
      cy.get('[data-testid="fb-open"]').click();
      cy.get('[data-testid="fb-field-0"]').click();
      cy.contains('[role="option"]', "Employees").click();
      cy.get('[data-testid="fb-op-0"]').click();
      cy.contains('[role="option"]', "between").click();
      cy.get('[data-testid="fb-value-0"]').type("100");
      cy.get('[data-testid="fb-value2-0"]').type("200");
      cy.get('[data-testid="fb-apply"]').click();

      cy.location("search").should((s) => expect(decodeParam(s, "f")).to.deep.eq(expected));
      totalShown().should("have.attr", "data-total", String(total));

      cy.reload();
      cy.location("search").should((s) => expect(decodeParam(s, "f")).to.deep.eq(expected));
      cy.get('[data-testid="fb-pill-0"]')
        .should("contain.text", "Employees")
        .and("contain.text", "between")
        .and("contain.text", "100 and 200");
      totalShown().should("have.attr", "data-total", String(total));
      cy.get('[data-testid="cell-employees"]').each(($c) => {
        const n = Number($c.text().replace(/,/g, ""));
        expect(n).to.be.within(100, 200);
      });
      cy.get('[data-testid="fb-pill-remove-0"]').click();
      cy.location("search").should("not.contain", "f=");
      totalShown().should("have.attr", "data-total", "200");
    });
  });

  it("pages mode: page 3 in the URL; back to infinite, scrolling loads more", () => {
    cy.openCompanies();
    cy.get('[data-testid="paging-pages"]').click();
    cy.location("search").should("contain", "mode=pages");
    cy.get('[data-testid="pager"]').should("be.visible");
    cy.get('[data-testid="pager-page-3"]').click();
    cy.location("search").should("contain", "p=3");
    cy.get('[data-testid="pager-status"]').should("have.text", "Page 3 of 4");
    cy.get('[data-testid="pager-page-3"]').should("have.attr", "aria-current", "page");
    rows().should("have.length", 50);
    totalShown().should("contain.text", "Showing 50 of 200");

    // The choice is remembered for the collection.
    cy.window().then((w) => expect(w.localStorage.getItem("udc:paging:companies")).to.eq("pages"));
    cy.openCompanies();
    cy.get('[data-testid="pager"]').should("be.visible");

    cy.get('[data-testid="paging-infinite"]').click();
    cy.location("search").should("contain", "mode=infinite").and("not.contain", "p=");
    cy.get('[data-testid="pager"]').should("not.exist");
    rows().should("have.length", 50);
    cy.get('[data-testid="table-scroll"]').scrollTo("bottom");
    rows().should("have.length", 100);
    cy.get('[data-testid="table-scroll"]').scrollTo("bottom");
    rows().should("have.length", 150);
    cy.get('[data-testid="table-scroll"]').scrollTo("bottom");
    rows().should("have.length", 200);
    cy.get('[data-testid="infinite-footer"]').should("contain.text", "All 200 rows loaded");
  });

  it("locale switch to sr changes the headers and persists", () => {
    cy.openCompanies();
    cy.get('[data-testid="locale-sr"]').click();
    cy.get('[data-testid="th-name"]').should("have.text", "Naziv");
    cy.get('[data-testid="th-city"]').should("have.text", "Grad");
    cy.get('[data-testid="th-revenue_eur"]').should("have.text", "Prihod (EUR)");
    cy.get('[data-testid="row-count"]').should("contain.text", "Prikazano");
    cy.reload();
    cy.get('[data-testid="th-name"]').should("have.text", "Naziv");
    cy.get('[data-testid="locale-en"]').click();
    cy.get('[data-testid="th-name"]').should("have.text", "Name");
  });

  it("dark mode toggle persists", () => {
    cy.openCompanies();
    cy.get("html").should("not.have.class", "dark");
    cy.get('[data-testid="theme-toggle"]').click();
    cy.get("html").should("have.class", "dark");
    cy.reload();
    cy.get("html").should("have.class", "dark");
    cy.get('[data-testid="theme-toggle"]').click();
    cy.get("html").should("not.have.class", "dark");
  });

  it("/ redirects to the first collection", () => {
    cy.udc("collections", {}).then(({ collections }) => {
      const first = collections[0]?.name as string;
      cy.visit("/");
      cy.location("pathname").should("eq", `/udc/${first}`);
      cy.get(`[data-testid="nav-${first}"]`).should("have.attr", "aria-current", "page");
    });
  });
});
