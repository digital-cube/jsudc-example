import type { Row } from "@jsudc/core";
import { decodeParam } from "../support/e2e";

const ticketsTable = (query = "") => {
  cy.visit(`/udc/tickets?tab=table${query}`);
  cy.get('[data-testid="row"]', { timeout: 15_000 }).should("have.length.at.least", 1);
};

/** A ticket on the table's first page (default order: id asc) with at least two assignees. */
function firstTicket() {
  return cy
    .udc("list", { collection: "tickets", page: { limit: 20 } })
    .then((res) => res.rows.find((r) => (r.assignees as string[]).length > 1) as Row);
}

const rowOf = (ticket: Row) => cy.get(`[data-row-id="${ticket.__meta.id}"]`);

describe("lookups: labels, links, chips, inline edit", () => {
  beforeEach(() => cy.reseed());

  it("shows the board and the assignees by name, not by id", () => {
    cy.intercept("POST", "/udc/list").as("list");
    ticketsTable();
    firstTicket().then((ticket) => {
      cy.udc("read", { collection: "boards", id: ticket.board_id as string }).then(({ row }) => {
        rowOf(ticket)
          .find('[data-testid="cell-board_id"] [data-testid="lookup-link"]')
          .should("have.text", row.name as string)
          .and("have.attr", "data-resolved", "true");
      });
      const people = ticket.assignees as string[];
      cy.udc("list", {
        collection: "org",
        filter: { field: "id", op: "in", value: people },
        page: { limit: 10 },
      }).then(({ rows }) => {
        rowOf(ticket)
          .find('[data-testid="cell-assignees"] [data-testid="lookup-link"]')
          .should("have.length", people.length)
          .each(($a) => {
            const key = $a.attr("data-key");
            const person = rows.find((r) => r.__meta.id === key);
            expect($a.text()).to.eq(person?.name);
          });
      });
    });
    // No cell shows a raw uuid.
    cy.get('[data-testid="cell-board_id"]').each(($c) =>
      expect($c.text()).not.to.match(/[0-9a-f]{8}-[0-9a-f]{4}-/),
    );
    // One batch per lookup field for the page, not one per cell.
    cy.get("@list.all").then((calls) => {
      const byId = (
        calls as unknown as {
          request: { body: { collection: string; filter?: { field?: string } } };
        }[]
      )
        .map((c) => c.request.body)
        .filter((b) => b.filter?.field === "id");
      expect(byId.filter((b) => b.collection === "boards")).to.have.length(1);
      expect(byId.filter((b) => b.collection === "org")).to.have.length(1);
    });
  });

  it("a lookup link opens the target collection filtered by the key", () => {
    ticketsTable();
    firstTicket().then((ticket) => {
      rowOf(ticket).find('[data-testid="cell-board_id"] [data-testid="lookup-link"]').click();
      cy.location("pathname").should("eq", "/udc/boards");
      cy.location("search").then((search) => {
        expect(decodeParam(search, "f")).to.deep.eq({
          field: "id",
          op: "eq",
          value: ticket.board_id,
        });
      });
      cy.get('[data-testid="row"]').should("have.length", 1);
      cy.get('[data-testid="row"]').should("have.attr", "data-row-id", ticket.board_id as string);
      // The pill names the filter by its field and value as written: the row id.
      cy.get('[data-testid="fb-pill-0"]').should("contain.text", ticket.board_id as string);
    });
  });

  it("the board chip offers board names and filters tickets by board id", () => {
    cy.udc("list", { collection: "boards", sort: [{ field: "name" }] }).then(({ rows }) => {
      const board = rows[0] as Row;
      ticketsTable();
      cy.get('[data-testid="chip-board_id"]').click();
      cy.get('[data-testid="chip-panel-board_id"] label').should("have.length", rows.length);
      cy.get('[data-testid="chip-panel-board_id"] label')
        .first()
        .should("have.text", board.name as string);
      cy.get(`[data-testid="chip-option-${board.__meta.id}"]`).click();
      cy.get('[data-testid="chip-board_id"]').should("contain.text", board.name as string);
      cy.location("search").then((search) => {
        expect(decodeParam(search, "cf")).to.deep.eq({
          board_id: { kind: "select", values: [board.__meta.id] },
        });
      });
      cy.udc("list", {
        collection: "tickets",
        filter: { field: "board_id", op: "eq", value: board.__meta.id },
      }).then(({ total }) => {
        cy.get('[data-testid="row-count"]').should("contain.text", String(total));
      });
    });
  });

  it("the assignee chip searches people by name (org has more than 50)", () => {
    ticketsTable();
    cy.get('[data-testid="chip-assignees"]').click();
    cy.get('[data-testid="chip-search-assignees"]').should("be.visible");
    firstTicket().then((ticket) => {
      const person = (ticket.assignees as string[])[0] as string;
      cy.udc("read", { collection: "org", id: person }).then(({ row }) => {
        cy.get('[data-testid="chip-search-assignees"]').type(row.name as string);
        cy.get(`[data-testid="chip-option-${person}"]`)
          .should("have.text", row.name as string)
          .click();
        cy.get('[data-testid="chip-assignees"]').should("contain.text", row.name as string);
        cy.get('[data-testid="row"]').should("have.length.at.least", 1);
        cy.get('[data-testid="row"]')
          .first()
          .find('[data-testid="cell-assignees"]')
          .should("contain.text", row.name as string);
      });
    });
  });

  it("edits the assignees with the combobox; the ids are saved", () => {
    cy.intercept("POST", "/udc/mutate").as("mutate");
    ticketsTable();
    firstTicket().then((ticket) => {
      const before = ticket.assignees as string[];
      cy.udc("list", {
        collection: "org",
        filter: { field: "kind", op: "eq", value: "person" },
        sort: [{ field: "name" }],
        page: { limit: 100 },
      }).then(({ rows }) => {
        const extra = rows.find((r) => !before.includes(r.__meta.id)) as Row;
        // A double-click on a label in an editable cell edits; it does not follow the link.
        rowOf(ticket).find('[data-testid="cell-assignees"]').dblclick();
        cy.get('[data-testid="lookup-picked"]').should("have.length", before.length);
        cy.get('[data-testid="lookup-search"]').type(extra.name as string);
        cy.get(`[data-testid="lookup-option-${extra.__meta.id}"]`).click();
        cy.get('[data-testid="lookup-search"]').type("{enter}");
        cy.wait("@mutate")
          .its("request.body.row")
          .should("deep.eq", { assignees: [...before, extra.__meta.id] });
        rowOf(ticket)
          .find('[data-testid="cell-assignees"]')
          .should("contain.text", extra.name as string);
        cy.udc("read", { collection: "tickets", id: ticket.__meta.id }).then(({ row }) => {
          expect(row.assignees).to.deep.eq([...before, extra.__meta.id]);
        });
      });
    });
  });
});

describe("row_link: boards → tickets", () => {
  it("a click on a board row opens that board's tickets", () => {
    cy.udc("list", { collection: "boards", page: { limit: 1 } }).then(({ rows }) => {
      const board = rows[0] as Row;
      cy.visit("/udc/boards");
      cy.get('[data-testid="row"]').first().should("have.class", "udc:cursor-pointer");
      cy.get('[data-testid="row"]').first().find('[data-testid="cell-key"]').click();
      cy.location("pathname").should("eq", "/udc/tickets");
      cy.location("search").then((search) => {
        expect(decodeParam(search, "f")).to.deep.eq({
          field: "board_id",
          op: "eq",
          value: board.__meta.id,
        });
      });
      cy.get('[data-testid="tab-table"]').click();
      cy.get('[data-testid="row"]').should("have.length.at.least", 1);
      cy.get('[data-testid="cell-board_id"] [data-resolved="true"]').should("exist");
      cy.get('[data-testid="cell-board_id"]').each(($c) => expect($c.text()).to.eq(board.name));
      // The pill reads the board's name, not its id.
      cy.get('[data-testid="fb-pill-0"]').should("contain.text", board.name as string);
    });
  });
});
