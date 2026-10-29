import type { Row } from "@jsudc/core";

const firstRow = () => cy.get('[data-testid="row"]').first();

/** The first row as the server has it (default order: id asc, same as the table). */
function serverFirstRow() {
  return cy
    .udc("list", { collection: "companies", page: { limit: 1 } })
    .then((res) => res.rows[0] as Row);
}

describe("inline edit", () => {
  beforeEach(() => cy.reseed());

  it("edits name and the value persists after reload", () => {
    cy.intercept("POST", "/udc/mutate").as("mutate");
    cy.openCompanies();
    serverFirstRow().then((row) => {
      firstRow().should("have.attr", "data-row-id", row.__meta.id);
      firstRow().find('[data-testid="cell-name"]').dblclick();
      cy.get('[data-testid="cell-editor"] input')
        .should("have.value", row.name)
        .clear()
        .type("cypress edit doo{enter}");
      cy.wait("@mutate")
        .its("request.body")
        .should("deep.include", {
          op: "update",
          id: row.__meta.id,
          row: { name: "cypress edit doo" },
          expected_version: row.__meta.version,
        });
      cy.get('[data-testid="cell-editor"]').should("not.exist");
      firstRow().find('[data-testid="cell-name"]').should("have.text", "Cypress Edit Doo");

      cy.reload();
      firstRow().find('[data-testid="cell-name"]').should("have.text", "Cypress Edit Doo");
      cy.udc("read", { collection: "companies", id: row.__meta.id }).then(({ row: fresh }) => {
        expect(fresh.name).to.eq("cypress edit doo");
        expect(fresh.__meta.version).to.eq(row.__meta.version + 1);
      });
    });
  });

  it("a number cell saves a number; Tab moves to the next editable cell", () => {
    cy.openCompanies();
    serverFirstRow().then((row) => {
      firstRow().find('[data-testid="cell-employees"]').dblclick();
      cy.get('[data-testid="cell-editor"] input')
        .should("have.attr", "type", "number")
        .clear()
        .type("4321");
      cy.get('[data-testid="cell-editor"] input').trigger("keydown", { key: "Tab" });
      // The next editable column after employees is revenue_eur.
      firstRow()
        .find('[data-testid="cell-revenue_eur"] [data-testid="cell-editor"]')
        .should("exist");
      firstRow().find('[data-testid="cell-employees"]').should("have.text", "4,321");
      cy.get('[data-testid="cell-editor"] input').type("{esc}");
      cy.get('[data-testid="cell-editor"]').should("not.exist");
      cy.udc("read", { collection: "companies", id: row.__meta.id })
        .its("row.employees")
        .should("eq", 4321);
    });
  });

  it("a validation error stays in edit mode with the message under the cell", () => {
    cy.openCompanies();
    firstRow().find('[data-testid="cell-name"]').dblclick();
    cy.get('[data-testid="cell-editor"] input').clear().type("{enter}");
    cy.get('[data-testid="cell-error"]').should("be.visible").and("contain.text", "required");
    cy.get('[data-testid="cell-editor"]').should("exist");
    cy.get('[data-testid="cell-editor"] input').type("{esc}");
    cy.get('[data-testid="cell-editor"]').should("not.exist");
  });

  it("a version conflict shows the toast and the fresh value", () => {
    cy.openCompanies();
    serverFirstRow().then((row) => {
      firstRow().should("have.attr", "data-row-id", row.__meta.id);
      // Someone else edits the row after the table loaded it.
      cy.udc("mutate", {
        collection: "companies",
        op: "update",
        id: row.__meta.id,
        row: { name: "changed elsewhere" },
        expected_version: row.__meta.version,
      });
      firstRow().find('[data-testid="cell-name"]').dblclick();
      cy.get('[data-testid="cell-editor"] input').clear().type("mine{enter}");
      cy.get('[data-testid="toast"]')
        .should("be.visible")
        .and("contain.text", "Row was changed by someone else");
      cy.get('[data-testid="cell-editor"]').should("not.exist");
      firstRow().find('[data-testid="cell-name"]').should("have.text", "Changed Elsewhere");
      cy.udc("read", { collection: "companies", id: row.__meta.id })
        .its("row.name")
        .should("eq", "changed elsewhere");
    });
  });
});
