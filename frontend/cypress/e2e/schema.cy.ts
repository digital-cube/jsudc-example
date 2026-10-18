import type { Row, SchemaDoc } from "@jsudc/udc-core";

const firstRow = () => cy.get('[data-testid="row"]').first();
const headerFields = () =>
  cy
    .get("thead th[data-testid^='th-']")
    .then(($th) => [...$th].map((th) => th.dataset.testid?.slice(3)));

/** Open a column's kebab menu and pick an item. */
function columnMenu(field: string, item: "add-before" | "add-after" | "edit" | "delete") {
  cy.get(`[data-testid="col-menu-${field}"]`).click();
  cy.get(`[data-testid="col-menu-${item}"]`).click();
}

/** `website` (string, en/sr labels) right after `name`, through the API. */
function addWebsite() {
  return cy.udc("schema.add_field", {
    collection: "companies",
    name: "website",
    fielddef: { type: "string", length: 255, label: { en: "Website", sr: "Veb sajt" } },
    position: { where: "after", anchor: "name" },
  });
}

describe("schema editor", () => {
  beforeEach(() => cy.reseed());

  it("adds website after name, fills it inline, and the value survives a reload", () => {
    cy.intercept("POST", "/udc/schema.add_field").as("add");
    cy.intercept("POST", "/udc/mutate").as("mutate");
    cy.openCompanies();
    columnMenu("name", "add-after");
    cy.get('[data-testid="field-form"]').should("have.attr", "data-mode", "add");
    cy.get('[data-testid="field-name"]').type("website");
    cy.get('[data-testid="field-type"]').should("have.value", "string");
    cy.get('[data-testid="field-label-en"]').type("Website");
    cy.get('[data-testid="field-label-sr"]').type("Veb sajt");
    cy.get('[data-testid="field-form-submit"]').click();
    cy.wait("@add")
      .its("request.body")
      .should("deep.include", {
        name: "website",
        position: { where: "after", anchor: "name" },
      })
      .its("fielddef.label")
      .should("deep.equal", { en: "Website", sr: "Veb sajt" });
    cy.get('[data-testid="field-form"]').should("not.exist");

    // The column is there at once, right after Name, with the English label.
    headerFields().then((fields) => {
      expect(fields[fields.indexOf("name") + 1]).to.eq("website");
    });
    cy.get('[data-testid="th-website"]').should("have.text", "Website");

    firstRow().then(($row) => {
      const id = $row.attr("data-row-id") as string;
      firstRow().find('[data-testid="cell-website"]').dblclick();
      cy.get('[data-testid="cell-editor"] input').type("https://orao.rs{enter}");
      cy.wait("@mutate")
        .its("request.body.row")
        .should("deep.equal", { website: "https://orao.rs" });
      cy.get('[data-testid="cell-editor"]').should("not.exist");

      cy.reload();
      cy.get(`[data-row-id="${id}"] [data-testid="cell-website"]`).should(
        "have.text",
        "https://orao.rs",
      );
      cy.udc("read", { collection: "companies", id })
        .its("row.website")
        .should("eq", "https://orao.rs");

      // The view lists `website` in card_options.meta_fields: now that it exists, the cards show it.
      cy.get('[data-testid="tab-cards"]').click();
      cy.get(`[data-testid="card"][data-row-id="${id}"] [data-testid="card-meta-website"]`).should(
        "contain.text",
        "https://orao.rs",
      );
    });
  });

  it("edits a column: name and type are locked, required shows a marker", () => {
    addWebsite();
    cy.intercept("POST", "/udc/schema.update_field").as("update");
    cy.openCompanies();
    cy.get('[data-testid="th-website"] [data-testid="required-marker"]').should("not.exist");
    columnMenu("website", "edit");
    cy.get('[data-testid="field-form"]').should("have.attr", "data-mode", "edit");
    cy.get('[data-testid="field-name"]')
      .should("have.value", "website")
      .and("have.attr", "readonly");
    cy.get('[data-testid="field-type"]').should("be.disabled");
    cy.get('[data-testid="type-locked"]').should("be.visible");
    cy.get('[data-testid="field-label-sr"]').should("have.value", "Veb sajt");
    cy.get('[data-testid="field-required"]').click();
    cy.get('[data-testid="field-form-submit"]').click();
    cy.wait("@update")
      .its("request.body.fielddef")
      .should("deep.include", {
        type: "string",
        required: true,
        label: { en: "Website", sr: "Veb sajt" },
      });
    cy.get('[data-testid="field-form"]').should("not.exist");
    cy.get('[data-testid="th-website"] [data-testid="required-marker"]').should("exist");
    cy.get('[data-testid="th-website"]').should("have.text", "Website");
    cy.udc("describe", { collection: "companies" })
      .its("schema.fields.website.required")
      .should("eq", true);
  });

  it("deletes a column after a confirmation: gone from the table, flagged deleted, data kept", () => {
    addWebsite();
    cy.udc("list", { collection: "companies", page: { limit: 1 } }).then(({ rows }) => {
      const id = (rows[0] as Row).__meta.id;
      cy.udc("mutate", {
        collection: "companies",
        op: "update",
        id,
        row: { website: "https://kept.rs" },
      });
    });
    cy.intercept("POST", "/udc/schema.soft_delete_field").as("delete");
    cy.openCompanies();
    cy.get('[data-testid="th-website"]').should("exist");
    columnMenu("website", "delete");
    cy.get('[data-testid="delete-field"]').should("contain.text", "Website");
    cy.get('[data-testid="delete-field-body"]').should("contain.text", "The data is kept");
    cy.get('[data-testid="delete-field-confirm"]').click();
    cy.wait("@delete").then(({ request, response }) => {
      expect(request.body).to.deep.equal({ collection: "companies", field: "website" });
      const schema = response?.body.payload.schema as SchemaDoc;
      expect(schema.fields.website).to.deep.include({ type: "string", deleted: true });
    });
    cy.get('[data-testid="delete-field"]').should("not.exist");
    cy.get('[data-testid="th-website"]').should("not.exist");

    // describe serves the active schema without soft-deleted fields (backend contract,
    // ticket 3/5): the field is gone from the schema, the columns and the filter builder.
    cy.request("POST", "/udc/describe", { collection: "companies" }).then(({ body }) => {
      expect(body.kind).to.eq("udc.describe.ok");
      expect(body.payload.schema.fields).not.to.have.property("website");
      expect(body.payload.view.columns.map((c: { field: string }) => c.field)).not.to.include(
        "website",
      );
      expect(body.payload.filterable.fields.map((f: { field: string }) => f.field)).not.to.include(
        "website",
      );
    });
  });

  it("an invalid name shows the inline error and never reaches the server", () => {
    cy.intercept("POST", "/udc/schema.add_field", cy.spy().as("add"));
    cy.openCompanies();
    cy.get('[data-testid="col-add-end"]').click();
    cy.get('[data-testid="field-form"]').should("contain.text", "The new column goes at the end.");
    cy.get('[data-testid="field-name"]').type("Web Site");
    cy.get('[data-testid="field-error"]').should("contain.text", "lowercase letters");
    cy.get('[data-testid="field-form-submit"]').click();
    cy.get('[data-testid="field-form"]').should("be.visible");
    cy.get('[data-testid="field-name"]').should("be.focused");
    cy.get('[data-testid="field-name"]').clear().type("name");
    cy.get('[data-testid="field-error"]').should("contain.text", "already exists");
    cy.get('[data-testid="field-form-submit"]').click();
    cy.get("@add").should("not.have.been.called");
  });

  it("shows the server's refusal inline and keeps the dialog open", () => {
    addWebsite();
    cy.udc("schema.soft_delete_field", { collection: "companies", field: "website" });
    cy.openCompanies();
    cy.get('[data-testid="col-add-end"]').click();
    // A soft-deleted name is unknown to describe, so only the server can refuse it.
    cy.get('[data-testid="field-name"]').type("website");
    cy.get('[data-testid="field-error"]').should("not.exist");
    cy.get('[data-testid="field-form-submit"]').click();
    cy.get('[data-testid="field-form-error"]')
      .should("have.attr", "data-code", "validation_error")
      .and("contain.text", "already exists");
    cy.get('[data-testid="field-form"]').should("be.visible");
  });

  it("locale sr shows the sr label of the new column", () => {
    addWebsite();
    cy.visit("/udc/companies", {
      onBeforeLoad: (win) => win.localStorage.setItem("udc-locale", "sr"),
    });
    cy.get('[data-testid="th-website"]').should("have.text", "Veb sajt");
    cy.get('[data-testid="th-name"]').should("have.text", "Naziv");
    cy.get('[data-testid="locale-en"]').click();
    cy.get('[data-testid="th-website"]').should("have.text", "Website");
  });
});
