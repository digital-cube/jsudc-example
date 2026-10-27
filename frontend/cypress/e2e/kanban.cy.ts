import type { Row } from "@jsudc/udc-core";

/*
 * The tickets board, seeded: 3 boards × 5 buckets, 60 tickets at orders 100, 200, …
 * Drags use pointer events (dnd-kit's PointerSensor), one keyboard move uses the
 * KeyboardSensor (space, arrow, space).
 */

const column = (name: string) =>
  cy.get(`[data-testid="kanban-column"][data-bucket-name="${name}"]`);
const cardsIn = (name: string) => column(name).find('[data-testid="kanban-card"]');

interface Seeded {
  boards: Row[];
  /** Every bucket of every board. */
  buckets: Row[];
  /** The first board's buckets: the board that opens by default. */
  first: Row[];
}

function seeded(): Cypress.Chainable<Seeded> {
  return cy
    .udc("list", { collection: "boards", sort: [{ field: "order" }] })
    .then(({ rows: boards }) =>
      cy
        .udc("list", { collection: "buckets", sort: [{ field: "order" }], page: { limit: 100 } })
        .then(({ rows: buckets }) => ({
          boards,
          buckets,
          first: buckets.filter((b) => b.board_id === boards[0]?.__meta.id),
        })),
    );
}

function bucketCards(bucketId: string) {
  return cy
    .udc("list", {
      collection: "tickets",
      filter: { field: "bucket_id", op: "eq", value: bucketId },
      sort: [{ field: "order" }],
      page: { limit: 200 },
    })
    .then((res) => res.rows);
}

function openBoard(query = "") {
  cy.visit(`/udc/tickets${query}`);
  cy.get('[data-testid="kanban-column"]', { timeout: 15_000 }).should("have.length.at.least", 1);
  cy.get('[data-testid="kanban-card"]').should("have.length.at.least", 1);
}

const pointer = (x: number, y: number) => ({
  eventConstructor: "PointerEvent",
  button: 0,
  buttons: 1,
  isPrimary: true,
  pointerId: 1,
  pointerType: "mouse",
  clientX: x,
  clientY: y,
  force: true,
});

/** Drag `source` and release it `dy` px from the top of `target` (dnd-kit pointer sensor). */
function drag(
  source: Cypress.Chainable<JQuery<HTMLElement>>,
  target: () => Cypress.Chainable<JQuery<HTMLElement>>,
  dy = 6,
) {
  source.then(($s) => {
    const r = $s[0]?.getBoundingClientRect() as DOMRect;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    cy.wrap($s).trigger("pointerdown", pointer(x, y));
    cy.document().trigger("pointermove", pointer(x + 8, y + 8));
    cy.wait(50);
    target().then(($t) => {
      const t = $t[0]?.getBoundingClientRect() as DOMRect;
      const tx = t.left + t.width / 2;
      const ty = t.top + dy;
      cy.document().trigger("pointermove", pointer(tx, ty - 20));
      cy.wait(50);
      cy.document().trigger("pointermove", pointer(tx, ty));
      cy.wait(150);
      cy.document().trigger("pointerup", pointer(tx, ty));
    });
  });
}

describe("kanban", () => {
  beforeEach(() => cy.reseed());

  it("opens on the first board with its 5 columns and the seeded counts", () => {
    seeded().then(({ boards, buckets }) => {
      const first = boards[0] as Row;
      openBoard();
      cy.get('[data-testid="kanban"]').should("have.attr", "data-board-id", first.__meta.id);
      cy.get('[data-testid="board-switcher"]').should("contain.text", first.name as string);
      const own = buckets.filter((b) => b.board_id === first.__meta.id);
      cy.get('[data-testid="kanban-column"]').should("have.length", 5);
      cy.get('[data-testid="kanban-column-name"]').then(($names) => {
        expect([...$names].map((n) => n.textContent)).to.deep.eq(own.map((b) => b.name));
      });
      for (const b of own) {
        bucketCards(b.__meta.id).then((rows) => {
          column(b.name as string).should("have.attr", "data-count", String(rows.length));
          column(b.name as string)
            .find('[data-testid="kanban-column-count"]')
            .should("have.text", String(rows.length));
        });
      }
      // No paging toggle on the board; the count is cards on this board.
      cy.get('[data-testid="paging-toggle"]').should("not.exist");
      cy.get('[data-testid="row-count"]').should("have.attr", "data-total", "20");
    });
  });

  it("drags the first Backlog card to the top of In progress; reload keeps it", () => {
    cy.intercept("POST", "/udc/mutate").as("mutate");
    seeded().then(({ first }) => {
      const backlog = first.find((b) => b.name === "Backlog") as Row;
      const progress = first.find((b) => b.name === "In progress") as Row;
      openBoard();
      cardsIn("Backlog")
        .first()
        .invoke("attr", "data-card-id")
        .then((id) => {
          drag(cardsIn("Backlog").first(), () => cardsIn("In progress").first());
          cy.wait("@mutate").its("request.body").should("deep.include", { op: "update", id });
          cy.udc("read", { collection: "tickets", id: id as string }).then(({ row }) => {
            expect(row.bucket_id).to.eq(progress.__meta.id);
            expect(row.order).to.eq(0);
          });
          cardsIn("In progress").first().should("have.attr", "data-card-id", id);
          cy.reload();
          cardsIn("In progress").first().should("have.attr", "data-card-id", id);
          bucketCards(backlog.__meta.id).then((rows) => {
            expect(rows.map((r) => r.__meta.id)).not.to.include(id);
          });
        });
    });
  });

  it("dropping a card on its own slot sends nothing", () => {
    cy.intercept("POST", "/udc/mutate", cy.spy().as("mutate"));
    openBoard();
    drag(cardsIn("Backlog").first(), () => cardsIn("Backlog").first(), 4);
    cy.wait(400);
    cy.get("@mutate").should("not.have.been.called");
  });

  it("quick-adds a card at the bottom of Review with order last+100", () => {
    cy.intercept("POST", "/udc/mutate").as("mutate");
    seeded().then(({ first, boards }) => {
      const review = first.find((b) => b.name === "Review") as Row;
      bucketCards(review.__meta.id).then((before) => {
        const last = before.at(-1)?.order as number;
        openBoard();
        column("Review").find('[data-testid="kanban-add-bottom"]').click();
        column("Review")
          .find('[data-testid="kanban-add-input-bottom"]')
          .type("Cypress quick add{enter}");
        cy.wait("@mutate")
          .its("request.body")
          .should("deep.eq", {
            collection: "tickets",
            op: "insert",
            row: {
              title: "Cypress quick add",
              board_id: (boards[0] as Row).__meta.id,
              bucket_id: review.__meta.id,
              order: last + 100,
            },
          });
        cardsIn("Review").last().should("contain.text", "Cypress quick add");
        cy.get('[data-testid="kanban-pending-card"]').should("not.exist");
        bucketCards(review.__meta.id).then((after) => {
          expect(after).to.have.length(before.length + 1);
          expect(after.at(-1)).to.include({ title: "Cypress quick add", order: last + 100 });
        });
      });
    });
  });

  it("renames a bucket and adds one", () => {
    seeded().then(({ first }) => {
      const ready = first.find((b) => b.name === "Ready") as Row;
      openBoard();
      column("Ready").find('[data-testid="kanban-column-menu"]').click();
      cy.get('[data-testid="kanban-rename"]').click();
      cy.get('[data-testid="kanban-rename-input"]').clear().type("Up next{enter}");
      column("Up next").should("exist");
      cy.udc("read", { collection: "buckets", id: ready.__meta.id })
        .its("row.name")
        .should("eq", "Up next");

      cy.get('[data-testid="kanban-add-bucket"]').click();
      cy.get('[data-testid="kanban-add-bucket-input"]').type("Blocked{enter}");
      cy.get('[data-testid="kanban-column"]').should("have.length", 6);
      cy.get('[data-testid="kanban-column-name"]').last().should("have.text", "Blocked");
      cy.udc("list", {
        collection: "buckets",
        filter: { field: "name", op: "eq", value: "Blocked" },
      }).then(({ rows }) => {
        expect(rows).to.have.length(1);
        expect(rows[0]?.order).to.eq(600);
      });
    });
  });

  it("switches boards with the select and with ?board=", () => {
    seeded().then(({ boards, buckets }) => {
      const [, second, third] = boards as [Row, Row, Row];
      openBoard();
      cy.get('[data-testid="board-switcher"]').click();
      cy.get('[role="option"]')
        .contains(second.name as string)
        .click();
      cy.location("search").should("contain", `board=${second.__meta.id}`);
      cy.get('[data-testid="kanban"]').should("have.attr", "data-board-id", second.__meta.id);
      const names = (board: Row) =>
        buckets.filter((b) => b.board_id === board.__meta.id).map((b) => b.name);
      cy.get('[data-testid="kanban-column-name"]').should(($n) => {
        expect([...$n].map((n) => n.textContent)).to.deep.eq(names(second));
      });

      openBoard(`?board=${third.__meta.id}`);
      cy.get('[data-testid="board-switcher"]').should("contain.text", third.name as string);
      cy.get('[data-testid="kanban-column-name"]').should(($n) => {
        expect([...$n].map((n) => n.textContent)).to.deep.eq(names(third));
      });
    });
  });

  it("search narrows the cards on the board", () => {
    openBoard();
    cy.get('[data-testid="kanban-card"]').should("have.length", 20);
    cy.get('[data-testid="search-input"]').type("export");
    cy.get('[data-testid="kanban-card"]').should("have.length", 1);
    cy.get('[data-testid="kanban-card"]').first().should("contain.text", "Export the current view");
    cy.get('[data-testid="row-count"]').should("have.attr", "data-shown", "1");
    cy.get('[data-testid="row-count"]').should("have.attr", "data-total", "20");
  });

  it("a drop between colliding orders reindexes the bucket, then moves", () => {
    cy.intercept("POST", "/udc/reindex").as("reindex");
    cy.intercept("POST", "/udc/mutate").as("mutate");
    seeded().then(({ first }) => {
      const progress = first.find((b) => b.name === "In progress") as Row;
      bucketCards(progress.__meta.id).then((rows) => {
        const [a, b] = rows as [Row, Row];
        cy.udc("mutate", {
          collection: "tickets",
          op: "update",
          id: a.__meta.id,
          row: { order: 100 },
        });
        cy.udc("mutate", {
          collection: "tickets",
          op: "update",
          id: b.__meta.id,
          row: { order: 101 },
        });
        openBoard();
        cardsIn("Backlog")
          .first()
          .invoke("attr", "data-card-id")
          .then((id) => {
            drag(cardsIn("Backlog").first(), () => cardsIn("In progress").eq(1));
            cy.wait("@reindex")
              .its("request.body")
              .should("deep.eq", {
                collection: "tickets",
                scope: { bucket_id: progress.__meta.id },
                order_field: "order",
              });
            // The retried move: its order sits between the renumbered neighbours.
            cy.wait("@mutate")
              .its("request.body")
              .should("deep.include", { id, row: { bucket_id: progress.__meta.id, order: 150 } });
            cardsIn("In progress").eq(1).should("have.attr", "data-card-id", id);
            cy.get('[data-testid="toast"]').should("not.exist");
            bucketCards(progress.__meta.id).should((after) => {
              expect(after.map((r) => r.__meta.id).slice(0, 3)).to.deep.eq([
                a.__meta.id,
                id,
                b.__meta.id,
              ]);
              const orders = after.map((r) => r.order as number);
              expect(new Set(orders).size, "orders are distinct").to.eq(orders.length);
              expect(orders.slice(0, 3)).to.deep.eq([100, 150, 200]);
            });
          });
      });
    });
  });

  it("moves a card with the keyboard (space, arrow down, space)", () => {
    cy.intercept("POST", "/udc/mutate").as("mutate");
    openBoard();
    cardsIn("Backlog").then(($cards) => {
      const first = $cards[0]?.getAttribute("data-card-id");
      const second = $cards[1]?.getAttribute("data-card-id");
      cardsIn("Backlog").first().focus();
      // A real KeyboardEvent (dnd-kit checks), forced: the lifted card is under its own children.
      const key = (code: string, k: string) =>
        cy
          .focused()
          .trigger("keydown", { eventConstructor: "KeyboardEvent", code, key: k, force: true });
      key("Space", " ");
      cy.wait(100);
      key("ArrowDown", "ArrowDown");
      cy.wait(250);
      key("Space", " ");
      cy.wait("@mutate").its("request.body").should("deep.include", { op: "update", id: first });
      cardsIn("Backlog").eq(0).should("have.attr", "data-card-id", second);
      cardsIn("Backlog").eq(1).should("have.attr", "data-card-id", first);
      cy.udc("read", { collection: "tickets", id: first as string })
        .its("row.order")
        .should("eq", 250);
    });
  });

  it("opens a read-only detail dialog on click", () => {
    openBoard();
    cardsIn("Backlog").first().click();
    cy.get('[data-testid="kanban-detail"]')
      .should("be.visible")
      .and("contain.text", "Saved filters per user");
    cy.get('[data-testid="kanban-detail-priority"]').should("exist");
    cy.get('[data-testid="kanban-detail"] input').should("not.exist");
    cy.get("body").type("{esc}");
    cy.get('[data-testid="kanban-detail"]').should("not.exist");
  });

  it("the table and cards tabs still work on tickets; unknown names stay disabled", () => {
    openBoard();
    cy.get('[data-testid="tab-table"]').click();
    cy.get('[data-testid="row"]').should("have.length", 50);
    cy.get('[data-testid="paging-toggle"]').should("exist");
    cy.get('[data-testid="tab-cards"]').click();
    cy.get('[data-testid="card"]').should("have.length", 50);
    cy.get('[data-testid="tab-kanban"]').click();
    cy.get('[data-testid="kanban-column"]').should("have.length", 5);
  });
});
