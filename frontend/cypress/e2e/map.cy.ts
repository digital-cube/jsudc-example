import type { Row } from "@jsudc/udc-core";

const markers = () => cy.get('[data-testid="map-marker"]');
const count = () => cy.get('[data-testid="row-count"]');

/** The seeded companies of one city, straight from the backend. */
function companiesIn(city: string) {
  return cy
    .udc("list", {
      collection: "companies",
      filter: { field: "city", op: "eq", value: city },
      page: { limit: 500 },
    })
    .then((res) => res.rows as Row[]);
}

function pickCity(city: string) {
  cy.get('[data-testid="chip-city"]').click();
  cy.get(`[data-testid="chip-option-${city}"]`).click();
  cy.get("body").type("{esc}");
}

describe("map renderer", () => {
  before(() => cy.reseed());

  it("draws one circle per company over Serbia, and counts them", () => {
    cy.visit("/udc/companies");
    cy.get('[data-testid="tab-map"]').click();
    cy.location("search").should("contain", "tab=map");
    markers().should("have.length", 200);
    count().should("have.attr", "data-shown", "200").and("have.attr", "data-total", "200");
    count().should("contain", "200 on map of 200");
    // The view opens on its center / zoom, which is the Serbia region.
    cy.get('[data-testid="map"]')
      .should("have.attr", "data-zoom", "7")
      .and("have.attr", "data-region", "serbia");
    cy.get('[data-testid="map-region-serbia"]').should("have.attr", "data-state", "on");
    cy.get(".leaflet-control-attribution").should("contain", "OpenStreetMap");
    // No paging toggle on this tab.
    cy.get('[data-testid="paging-infinite"]').should("not.exist");
  });

  it("chip city = Niš leaves only the Niš markers; a marker opens its popup", () => {
    companiesIn("Niš").then((nis) => {
      expect(nis.length, "seeded Niš companies").to.be.within(5, 60);
      const ids = new Set(nis.map((r) => r.__meta.id));
      cy.visit("/udc/companies?tab=map");
      markers().should("have.length", 200);
      pickCity("Niš");
      markers().should("have.length", nis.length);
      markers().each(($m) => expect(ids.has($m.attr("data-id") as string)).to.eq(true));
      count()
        .should("have.attr", "data-shown", String(nis.length))
        .and("have.attr", "data-total", String(nis.length))
        .and("contain", `${nis.length} on map of ${nis.length}`);

      const first = nis[0] as Row;
      cy.get(`[data-testid="map-marker"][data-id="${first.__meta.id}"]`).click({ force: true });
      cy.get('[data-testid="map-popup"]').should("have.attr", "data-id", first.__meta.id);
      cy.get('[data-testid="map-popup-name"]')
        .invoke("text")
        .then((text) => expect(text.toLowerCase()).to.eq(String(first.name).toLowerCase()));
      cy.get('[data-testid="map-popup-city"]').should("contain", "Niš");
      cy.get('[data-testid="map-popup-employees"]').should("contain", "Employees");
      cy.get(`[data-testid="map-marker"][data-id="${first.__meta.id}"]`).should(
        "have.class",
        "is-selected",
      );
      cy.get(".leaflet-popup-close-button").click();
      cy.get('[data-testid="map-popup"]').should("not.exist");
      cy.get(".is-selected").should("not.exist");
    });
  });

  it("a region button flies the map there; fit all frames every marker", () => {
    cy.visit("/udc/companies?tab=map");
    markers().should("have.length", 200);
    cy.get('[data-testid="map-region-vojvodina"]').click();
    cy.get('[data-testid="map"]', { timeout: 5000 })
      .should("have.attr", "data-region", "vojvodina")
      .and("have.attr", "data-zoom", "8");
    cy.get('[data-testid="map-region-vojvodina"]').should("have.attr", "data-state", "on");
    cy.get('[data-testid="map-region-south"]').click();
    cy.get('[data-testid="map"]').should("have.attr", "data-region", "south");
    cy.get('[data-testid="map-fit-all"]').click();
    // The companies spread from Subotica to Vranje: the fit is no region's view.
    cy.get('[data-testid="map"]').should("not.have.attr", "data-region");
  });

  it("keeps the tab and the filter over a reload and when switching to the table", () => {
    companiesIn("Niš").then((nis) => {
      cy.visit("/udc/companies?tab=map");
      pickCity("Niš");
      markers().should("have.length", nis.length);
      cy.reload();
      cy.get('[data-testid="tab-map"]').should("have.attr", "data-state", "on");
      markers().should("have.length", nis.length);
      cy.get('[data-testid="tab-table"]').click();
      cy.location("search").should("contain", "tab=table").and("contain", "cf=");
      cy.get('[data-testid="row"]').should("have.length", nis.length);
      cy.get('[data-testid="cell-city"]').each(($c) => expect($c.text()).to.eq("Niš"));
      count().should("have.attr", "data-total", String(nis.length));
    });
  });

  it("shows the table's empty state when nothing matches", () => {
    cy.visit("/udc/companies?tab=map");
    markers().should("have.length", 200);
    cy.get('[data-testid="search-input"]').type("no such company anywhere");
    cy.get('[data-testid="table-empty"]').should("be.visible");
    markers().should("not.exist");
    cy.get('[data-testid="table-empty"] button').click();
    markers().should("have.length", 200);
  });
});
