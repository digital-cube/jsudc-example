const cards = () => cy.get('[data-testid="card"]');
const rows = () => cy.get('[data-testid="row"]');

describe("cards renderer", () => {
  before(() => cy.reseed());

  it("renders 50 cards: title is the name as the table shows it, plus the five meta fields", () => {
    cy.udc("describe", { collection: "companies" }).then(({ view, schema }) => {
      // The view also lists `website`, which the seeded schema does not have yet.
      const meta = (view.card_options?.meta_fields ?? []).filter((f) => f in schema.fields);
      expect(meta, "live meta_fields of the view").to.have.length(5);
      cy.openCompanies();
      rows()
        .first()
        .then(($row) => {
          const id = $row.attr("data-row-id");
          const name = $row.find('[data-testid="cell-name"]').text();
          cy.get('[data-testid="tab-cards"]').click();
          cy.location("search").should("contain", "tab=cards");
          cards().should("have.length", 50);
          cards().first().should("have.attr", "data-row-id", id);
          cards().first().find('[data-testid="card-title"]').should("have.text", name);
          cards()
            .first()
            .find('[data-testid="card-subtitle"]')
            .should("contain.text", $row.find('[data-testid="cell-pib"]').text());
        });
      cards()
        .first()
        .find('[data-testid^="card-meta-"]')
        .then(($m) => [...$m].map((el) => el.dataset.testid?.slice("card-meta-".length)))
        .should("deep.equal", meta);
      // Formatted through the same cell renderers as the table.
      cards()
        .first()
        .find('[data-testid="card-meta-revenue_eur"] dd')
        .invoke("text")
        .should("match", /^\d{1,3}(,\d{3})*$/);
      cards().first().find('[data-testid="card-meta-active"] [data-bool]').should("exist");
      cards()
        .first()
        .find('[data-testid="card-avatar"]')
        .invoke("text")
        .should("match", /^\S{1,2}$/);
    });
  });

  it("keeps the search when switching table ↔ cards", () => {
    cy.openCompanies();
    cy.get('[data-testid="search-input"]').type("Beograd");
    cy.location("search").should("contain", "q=Beograd");
    // Retried until the debounced search has answered with a narrower total.
    cy.get('[data-testid="row-count"]')
      .should(($el) => expect(Number($el.attr("data-total"))).to.be.within(1, 199))
      .invoke("attr", "data-total")
      .then((total) => {
        const n = Math.min(Number(total), 50);
        cy.get('[data-testid="tab-cards"]').click();
        cy.location("search").should("contain", "q=Beograd").and("contain", "tab=cards");
        cy.get('[data-testid="search-input"]').should("have.value", "Beograd");
        cards().should("have.length", n);
        cy.get('[data-testid="row-count"]').should("have.attr", "data-total", total);
        cy.get('[data-testid="tab-table"]').click();
        cy.location("search").should("contain", "q=Beograd").and("contain", "tab=table");
        rows().should("have.length", n);
      });
  });

  it("shows the pager under the grid in pages mode and loads more cards in infinite mode", () => {
    cy.visit("/udc/companies?tab=cards&mode=pages");
    cards().should("have.length", 50);
    cy.get('[data-testid="pager"]').should("be.visible");
    cy.get('[data-testid="pager-page-2"]').click();
    cy.location("search").should("contain", "p=2");
    cy.intercept("POST", "/udc/list").as("list");
    cy.get('[data-testid="paging-infinite"]').click();
    // The switch scrolls back to the top; scroll once the first infinite page is in.
    cy.wait("@list");
    cards().should("have.length", 50);
    cy.get('[data-testid="infinite-footer"]').should("exist");
    cy.get('[data-testid="cards-scroll"]').scrollTo("bottom");
    cards().should("have.length", 100);
  });
});
