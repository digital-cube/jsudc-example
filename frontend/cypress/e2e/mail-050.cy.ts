import type { Row } from "@jsudc/core";

/*
 * /mail on @jsudc/* 0.5.0: what the release adds, as the example uses it —
 * selection and the bulk bar (mark read / unread by `set`, archive by a host
 * handler, "select all that match" without a total), the row menu with
 * `when`, the typed host action `mail.move_to_folder` (useUdcAction), live
 * updates (the change feed; "simulate incoming mail"), the search answered by
 * the full-text index, and the 5,000-message Newsletters folder windowed.
 * The spec changes the mailbox, so it reseeds when it is done.
 */

const rows = () => cy.get('[data-testid="mail-list"] [data-testid="row"]');
const row = (id: string) => cy.get(`[data-testid="mail-list"] [data-row-id="${id}"]`);
const pane = () => cy.get('[data-testid="mail-reading-pane"]');
const folder = (role: string) => cy.get(`[data-testid="mail-folder-${role}"]`);

/** `POST /udc/<action>` as a demo user; yields the `.ok` payload. */
function udcAs<T>(user: string, action: string, payload: unknown): Cypress.Chainable<T> {
  const answer = cy
    .request({
      method: "POST",
      url: `/udc/${action}`,
      body: payload as Cypress.RequestBody,
      headers: { "x-demo-user": user },
    })
    .then((res) => {
      expect(res.body.kind, `udc.${action} reply`).to.eq(`udc.${action}.ok`);
      return res.body.payload;
    });
  return answer as unknown as Cypress.Chainable<T>;
}

/** The example's "Select": the view's selection (multiselect, bulk_actions) switched on. */
function selectMode() {
  cy.get('[data-testid="mail-select-mode"]').click();
  cy.location("search").should("contain", "select=1");
  cy.get('[data-testid="mail-list"] [data-testid="select-page"]').should("exist");
}

/**
 * Scroll the list to its end until `n` rows are loaded (a page arrives, its rows render, again).
 * `scrollTo("bottom")` stops short by the height of the horizontal scrollbar (it measures with
 * offsetHeight), so the end is set by hand, as a wheel reaching the bottom would.
 */
function scrollUntilLoaded(n: number, tries = 30) {
  const table = '[data-testid="mail-list"] [data-testid="udc-table"]';
  cy.get('[data-testid="mail-list"] [data-testid="table-scroll"]').then(($s) => {
    const s = $s[0] as HTMLElement;
    s.scrollTop = s.scrollHeight;
  });
  cy.wait(250);
  cy.get(table)
    .invoke("attr", "aria-rowcount")
    .then((count) => {
      if (Number(count) < n && tries > 0) scrollUntilLoaded(n, tries - 1);
    });
}

function openMail(user: string, query = "") {
  cy.visit(`/mail${query}`, {
    onBeforeLoad: (win) => win.localStorage.setItem("example:demo-user", user),
  });
  cy.get('[data-testid="mail-page"]').should("have.attr", "data-user", user);
  rows().should("have.length.at.least", 5);
}

/** The ids of the rows at these positions of the list, in that order. */
function idsAt(positions: number[]): Cypress.Chainable<string[]> {
  return rows().then(($rows) =>
    positions.map((i) => String($rows.eq(i).attr("data-row-id"))),
  ) as unknown as Cypress.Chainable<string[]>;
}

/** The Inbox's unread count in the folder list. */
function inboxUnread(): Cypress.Chainable<number> {
  return folder("inbox")
    .find('[data-testid="mail-folder-unread"]')
    .invoke("text")
    .then((t) => Number(t)) as unknown as Cypress.Chainable<number>;
}

describe("/mail on @jsudc/* 0.5.0", () => {
  after(() => {
    cy.task("reseed");
  });

  it("select and archive: three ticked messages leave the Inbox in one host action", () => {
    openMail("ana");
    // Without "Select" the list is 0.4.0's: no checkboxes, the active row is aria-selected.
    cy.get('[data-testid="mail-list"] [data-testid="select-row"]').should("not.exist");
    selectMode();
    cy.intercept("POST", "/udc/mail.move_to_folder").as("move");
    idsAt([1, 2, 3]).then((ids) => {
      for (const id of ids) row(id).find('[data-testid="select-row"]').click();
      cy.get('[data-testid="bulk-bar"]').should("be.visible");
      cy.get('[data-testid="bulk-count"]').should("contain", "3");
      for (const id of ids) row(id).should("have.attr", "data-selected", "true");
      cy.get('[data-testid="bulk-action-archive"]').click();
      cy.wait("@move").then(({ request, response }) => {
        expect(request.body.ids).to.deep.eq(ids);
        expect(request.body.folder_id).to.be.a("string");
        expect(response?.body.payload).to.deep.eq({ moved: 3, failed: [] });
      });
      for (const id of ids) row(id).should("not.exist");
      cy.get('[data-testid="bulk-bar"]').should("not.exist");
      udcAs<{ row: Row }>("ana", "read", { collection: "mail_messages", id: ids[0] }).then(
        ({ row: r }) => expect(r.folder_name).to.eq("Archive"),
      );
      folder("archive").click();
      for (const id of ids) row(id).should("exist");
    });
  });

  it("select all that match, in a folder without a total: no number; the action goes by filter", () => {
    openMail("ana");
    folder("archive").click();
    rows().first().find('[data-testid="cell-folder_name"]').should("contain", "Archive");
    selectMode();
    cy.get('[data-testid="mail-list"] [data-testid="select-page"]').click();
    cy.get('[data-testid="select-all-matching"]')
      .should("be.visible")
      .invoke("text")
      .should("not.match", /\d/);
    cy.get('[data-testid="select-all-matching"]').click();
    cy.get('[data-testid="bulk-count"]').invoke("text").should("not.match", /\d/);
    cy.intercept("POST", "/udc/mutate_many").as("many");
    cy.get('[data-testid="bulk-action-mark_unread"]').click();
    cy.wait("@many").then(({ request, response }) => {
      expect(request.body.ids).to.eq(undefined);
      expect(JSON.stringify(request.body.filter)).to.contain('"folder_id"');
      expect(request.body.row).to.deep.eq({ seen: false });
      // The Archive's 60, and the three the test before moved there.
      expect(response?.body.payload.updated).to.be.at.least(60);
    });
    rows().should(($rows) => {
      for (const r of $rows) {
        expect(r.querySelector('[data-testid="unread-dot"]')?.getAttribute("data-unread")).to.eq(
          "true",
        );
      }
    });
  });

  it("a row's menu offers only what its `when` allows; Mark read is a `set`", () => {
    openMail("ana");
    folder("inbox").click();
    cy.get('[data-testid="mail-unread-only"]').click();
    // Wait for the unread-only page to replace the full one before picking a row.
    rows().should(($rows) => {
      expect($rows.length).to.be.at.least(3);
      for (const r of $rows) {
        expect(r.querySelector('[data-testid="unread-dot"]')?.getAttribute("data-unread")).to.eq(
          "true",
        );
      }
    });
    idsAt([1]).then(([id = ""]) => {
      row(id).find('[data-testid="row-actions-more"]').click();
      cy.get('[data-testid="row-actions-menu"]').within(() => {
        cy.get('[data-testid="row-action-item-mark_read"]').should("exist");
        cy.get('[data-testid="row-action-item-mark_unread"]').should("not.exist");
        cy.get('[data-testid="row-action-item-archive"]').should("exist");
        cy.get('[data-testid="row-action-item-mark_read"]').click();
      });
      udcAs<{ row: Row }>("ana", "read", { collection: "mail_messages", id }).then(({ row: r }) =>
        expect(r.seen).to.eq(true),
      );
      // Off "unread only", the same row now offers Mark unread and no Mark read.
      cy.get('[data-testid="mail-unread-only"]').click();
      row(id).find('[data-testid="unread-dot"]').should("have.attr", "data-unread", "false");
      row(id).find('[data-testid="cell-subject"]').rightclick();
      cy.get('[data-testid="row-actions-menu"]').within(() => {
        cy.get('[data-testid="row-action-item-mark_unread"]').should("exist");
        cy.get('[data-testid="row-action-item-mark_read"]').should("not.exist");
      });
    });
  });

  it("move to folder: the typed host action, from the reading pane", () => {
    openMail("ana");
    cy.intercept("POST", "/udc/mail.move_to_folder").as("move");
    idsAt([4]).then(([id = ""]) => {
      row(id).find('[data-testid="cell-subject"]').click({ scrollBehavior: "center" });
      pane().should("have.attr", "data-message-id", id);
      cy.get('[data-testid="mail-folder-name"]').should("contain", "Inbox");
      cy.get('[data-testid="mail-move"]').click();
      cy.get('[data-testid="mail-move-menu"]').should("not.contain", "Inbox");
      cy.get('[data-testid="mail-move-to-custom"]').click();
      cy.wait("@move").then(({ request, response }) => {
        expect(request.body.ids).to.deep.eq([id]);
        expect(response?.body.payload).to.deep.eq({ moved: 1, failed: [] });
      });
      cy.get('[data-testid="mail-folder-name"]').should("contain", "Projects");
      row(id).should("not.exist");
      folder("custom").click();
      row(id).should("exist");
    });
  });

  it("incoming mail appears by itself in the owner's list, never in the other user's", () => {
    openMail("ana");
    cy.get('[data-testid="mail-list"] [data-testid="feed-status"]').should("exist");
    inboxUnread().then((before) => {
      // Marko gets mail: Ana's screen does not change.
      udcAs<{ id: string; subject: string }>("marko", "mail.simulate_incoming", {}).then(
        (markos) => {
          cy.wait(1500);
          row(markos.id).should("not.exist");
          inboxUnread().should("eq", before);
        },
      );
      // Ana gets mail: it shows up at the top, unread, and the Inbox count follows. No reload.
      cy.intercept("POST", "/udc/mail.simulate_incoming").as("simulate");
      cy.window().then((win) => {
        (win as unknown as { __notReloaded: boolean }).__notReloaded = true;
      });
      cy.get('[data-testid="mail-simulate-incoming"]').click();
      cy.wait("@simulate").then(({ response }) => {
        const id = String(response?.body.payload.id);
        rows().first().should("have.attr", "data-row-id", id);
        row(id).find('[data-testid="unread-dot"]').should("have.attr", "data-unread", "true");
        inboxUnread().should("eq", before + 1);
        cy.window().its("__notReloaded").should("eq", true);
      });
    });
  });

  it("the search box is answered by the source: `search` in the request, best match first", () => {
    openMail("ana");
    // The newest message before the search (an earlier test may have delivered a newer one).
    rows().first().find('[data-testid="cell-subject"]').invoke("text").as("newest");
    // The text as `search`, and no sort: the view's `default_sort` steps aside for a search the
    // source answers (the data view does it; the page writes no sort).
    cy.intercept("POST", "/udc/list", (req) => {
      const b = req.body;
      if (b.collection === "mail_messages" && b.search && !b.sort?.length) req.alias = "search";
    });
    cy.get('[data-testid="mail-list"] [data-testid="search-input"]').type("invoices");
    cy.wait("@search").then(({ request }) => {
      expect(request.body.search).to.eq("invoices");
      // No `contains` composed for the box, and no sort: the server orders by rank.
      expect(JSON.stringify(request.body.filter ?? {})).not.to.contain("contains");
      expect(request.body.sort ?? []).to.deep.eq([]);
    });
    cy.location("search").should("not.contain", "list.sort");
    rows().should(($rows) => {
      expect($rows.length).to.be.at.least(1);
      for (const r of $rows) {
        expect(r.querySelector('[data-testid="cell-subject"]')?.textContent).to.match(/invoice/i);
      }
    });
    cy.get('[data-testid="mail-list"] [data-testid="th-received_at"]').should(
      "not.have.attr",
      "aria-sort",
    );
    // Cleared, the newest-first default comes back, still without a `list.sort` in the URL.
    cy.get('[data-testid="mail-list"] [data-testid="search-input"]').clear();
    cy.get('[data-testid="mail-list"] [data-testid="th-received_at"]').should(
      "have.attr",
      "aria-sort",
      "descending",
    );
    cy.get<string>("@newest").then((newest) => {
      rows().first().find('[data-testid="cell-subject"]').should("have.text", newest);
    });
    cy.location("search").should("not.contain", "list.sort");
  });

  it("the long folder: 5,000 newsletters, a window of rows mounted however far it scrolls", () => {
    openMail("ana");
    folder("newsletters").click();
    rows().first().should("contain", "#5000");
    const scroller = () => cy.get('[data-testid="mail-list"] [data-testid="table-scroll"]');
    cy.get('[data-testid="mail-list"] [data-testid="udc-table"]').should(
      "have.attr",
      "aria-rowcount",
      "50",
    );
    // Five pages further down: 300 rows loaded, still only a window of them in the page.
    scrollUntilLoaded(300);
    cy.get('[data-testid="mail-list"] [data-testid="udc-table"]')
      .invoke("attr", "aria-rowcount")
      .then(Number)
      .should("be.at.least", 300);
    rows().its("length").should("be.lessThan", 100);
    cy.get('[data-testid="mail-list"] [data-testid="row-spacer"]').should("exist");
    // The mounted rows are the ones at the end of what is loaded, not the first ones.
    rows().last().invoke("attr", "aria-rowindex").then(Number).should("be.at.least", 250);
    // Row 10 is not in the page any more (row 1 is: it holds the list's tab stop, which the
    // window keeps mounted wherever it is). Back at the top, row 10 is mounted again.
    cy.get('[data-testid="mail-list"] [data-testid="row"][aria-rowindex="10"]').should("not.exist");
    scroller().scrollTo("top", { ensureScrollable: false });
    cy.get('[data-testid="mail-list"] [data-testid="row"][aria-rowindex="10"]').should("exist");
  });
});
