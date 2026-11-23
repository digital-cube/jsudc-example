import type { ListResponse, Row } from "@jsudc/core";

/*
 * /mail: the mailbox example of @jsudc/* 0.4.0. Three demo users (no login):
 * the header's switcher sends one in `x-demo-user`, the server's `context`
 * reads it and its row scope holds mail_folders / mail_messages to that
 * user's rows. The message list is <UdcDataView collection="mail_messages">
 * embedded between the example's folder list and reading pane. The mailbox
 * is seeded by `npm run e2e` (scripts/generate-mail.ts, SEED_TODAY pinned).
 */

const rows = () => cy.get('[data-testid="mail-list"] [data-testid="row"]');
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

/** Every row loaded shows the unread dot (retried until the unread-only page arrived). */
function allUnread() {
  rows().should(($rows) => {
    expect($rows.length).to.be.at.least(2);
    for (const r of $rows) {
      expect(r.querySelector('[data-testid="unread-dot"]')?.getAttribute("data-unread")).to.eq(
        "true",
      );
    }
  });
}

/** Open /mail as `user` (the switcher's choice is remembered in localStorage). */
function openMail(user: string, query = "") {
  cy.visit(`/mail${query}`, {
    onBeforeLoad: (win) => win.localStorage.setItem("example:demo-user", user),
  });
  cy.get('[data-testid="mail-page"]').should("have.attr", "data-user", user);
  rows().should("have.length.at.least", 5);
}

describe("/mail: a mailbox per demo user", () => {
  it("opens the user's Inbox newest first; the folders filter the embedded list", () => {
    // Every list request of the messages (no search typed in this test).
    const lists: Array<{ sort?: unknown }> = [];
    cy.intercept("POST", "/udc/list", (req) => {
      if (req.body.collection === "mail_messages") lists.push(req.body);
    });
    openMail("ana");
    cy.get(`[data-testid="user-ana"]`).should("have.attr", "data-state", "on");
    folder("inbox").should("have.attr", "aria-current", "true");
    folder("inbox").find('[data-testid="mail-folder-unread"]').should("exist");
    // Newest first is the view's `default_sort` (0.6.0): the very first request already carries
    // it (no unsorted request thrown away), the header shows it, and the URL stays clean.
    cy.wrap(lists).should((ls) => {
      expect(ls.length).to.be.at.least(1);
      for (const body of ls) expect(body.sort).to.deep.eq([{ field: "received_at", dir: "desc" }]);
    });
    cy.get('[data-testid="mail-list"] [data-testid="th-received_at"]').should(
      "have.attr",
      "aria-sort",
      "descending",
    );
    cy.location("search").should("not.contain", "list.sort");
    // The fields the reading pane shows are `hidden: true` in view.yaml (0.6.0): no column for
    // them, the last listed column is the size.
    cy.get('[data-testid="mail-list"] [data-testid="th-size_bytes"]').should("exist");
    for (const f of ["sender_email", "preview", "folder_id", "body"]) {
      cy.get(`[data-testid="mail-list"] [data-testid="th-${f}"]`).should("not.exist");
    }
    rows().first().should("contain", "Welcome to the jsudc mailbox, Ana");
    rows().first().find('[data-testid="unread-dot"]').should("have.attr", "data-unread", "true");
    // Embedded: no title, no tabs, no frame.
    cy.get('[data-testid="mail-list"] [data-testid="data-view-frame"]').should(
      "have.attr",
      "data-framed",
      "false",
    );
    cy.get('[data-testid="mail-list"] [data-testid="tab-table"]').should("not.exist");

    for (const [role, name] of [
      ["sent", "Sent"],
      ["custom", "Projects"],
      ["archive", "Archive"],
    ] as const) {
      folder(role).click();
      cy.location("search").should("contain", "folder=");
      // Every row loaded is of that folder (retried until the folder's page replaced the last one).
      rows().should(($rows) => {
        expect($rows.length).to.be.at.least(5);
        for (const r of $rows) {
          expect(r.querySelector('[data-testid="cell-folder_name"]')?.textContent).to.contain(name);
        }
      });
    }
    // The toolbar's own control: unread only, ANDed into the host's filter.
    folder("inbox").click();
    cy.get('[data-testid="mail-unread-only"]').click();
    cy.location("search").should("contain", "unread=1");
    allUnread();
  });

  it("the keys walk the list and the reading pane follows; Enter and a click open", () => {
    openMail("ana");
    folder("archive").click();
    rows().first().find('[data-testid="cell-folder_name"]').should("contain", "Archive");
    rows().eq(0).find('[data-testid="cell-subject"]').click({ scrollBehavior: "center" });
    rows().eq(0).should("have.attr", "data-active", "true");
    rows()
      .eq(0)
      .invoke("attr", "data-row-id")
      .then((first) => {
        pane().should("have.attr", "data-message-id", first);
        cy.location("search").should("contain", `m=${first}`);
      });
    cy.focused().type("j");
    rows()
      .eq(1)
      .should("have.attr", "data-active", "true")
      .and("have.attr", "aria-selected", "true");
    rows()
      .eq(1)
      .invoke("attr", "data-row-id")
      .then((second) => pane().should("have.attr", "data-message-id", second));
    cy.focused().type("j{downArrow}");
    rows().eq(3).should("have.attr", "data-active", "true");
    cy.focused().type("k");
    rows().eq(2).should("have.attr", "data-active", "true");
    rows()
      .eq(2)
      .invoke("attr", "data-row-id")
      .then((third) => pane().should("have.attr", "data-message-id", third));
    cy.focused().type("{enter}");
    cy.get('[data-testid="mail-subject"]').should("not.be.empty");
    cy.get('[data-testid="mail-body"]').should("not.be.empty");
    // The keys are the list's only while it has the focus: typing in the search box types.
    cy.get('[data-testid="mail-list"] [data-testid="search-input"]')
      .type("jk")
      .should("have.value", "jk");
  });

  it("opening an unread message marks it seen; the server keeps it, the audit trail shows it", () => {
    openMail("ana");
    cy.get('[data-testid="mail-unread-only"]').click();
    allUnread();
    rows()
      .eq(1)
      .invoke("attr", "data-row-id")
      .then((id) => {
        const messageId = String(id);
        rows().eq(1).find('[data-testid="cell-subject"]').click({ scrollBehavior: "center" });
        pane().should("have.attr", "data-message-id", messageId);
        cy.get('[data-testid="mail-toggle-seen"]').should("have.attr", "data-seen", "true");
        cy.get('[data-testid="mail-audit-row"]')
          .first()
          .should("have.attr", "data-op", "update")
          .and("contain", '"seen":true');
        udcAs<{ row: Row }>("ana", "read", { collection: "mail_messages", id: messageId }).then(
          ({ row }) => expect(row.seen).to.eq(true),
        );
        // A reload reads it again from the server: still seen, gone from "unread only".
        cy.reload();
        pane().should("have.attr", "data-message-id", messageId);
        cy.get('[data-testid="mail-toggle-seen"]').should("have.attr", "data-seen", "true");
        cy.get(`[data-testid="mail-list"] [data-row-id="${messageId}"]`).should("not.exist");
        // And back: unread again, a second audit row.
        cy.get('[data-testid="mail-toggle-seen"]').click();
        cy.get('[data-testid="mail-toggle-seen"]').should("have.attr", "data-seen", "false");
        cy.get('[data-testid="mail-audit-row"]').should("have.length", 2);
        cy.get(`[data-testid="mail-list"] [data-row-id="${messageId}"]`)
          .find('[data-testid="unread-dot"]')
          .should("have.attr", "data-unread", "true");
      });
  });

  it("the other user's rows are not there: switching changes them, their id is not found", () => {
    udcAs<ListResponse>("marko", "list", {
      collection: "mail_messages",
      sort: [{ field: "received_at", dir: "desc" }],
      page: { limit: 1 },
    }).then(({ rows: [marko] }) => {
      const id = String(marko?.__meta.id);
      expect(marko?.subject).to.eq("Welcome to the jsudc mailbox, Marko");

      openMail("ana");
      rows().first().should("contain", "Ana");
      cy.contains('[data-testid="mail-list"]', "Welcome to the jsudc mailbox, Marko").should(
        "not.exist",
      );
      cy.get('[data-testid="mail-folders"]')
        .should("contain", "Projects")
        .and("not.contain", "Travel");

      // A link to Marko's message, opened as Ana: the scope answers as for a missing id.
      openMail("ana", `?m=${id}`);
      cy.get('[data-testid="mail-not-found"]').should("be.visible");
      cy.get(`[data-testid="mail-list"] [data-row-id="${id}"]`).should("not.exist");

      // Switch to Marko in the header: his folders, his rows, and the same link now opens.
      cy.get('[data-testid="user-marko"]').click();
      cy.get('[data-testid="mail-page"]').should("have.attr", "data-user", "marko");
      cy.get('[data-testid="mail-folders"]')
        .should("contain", "Travel")
        .and("not.contain", "Projects");
      rows().first().should("contain", "Welcome to the jsudc mailbox, Marko");
      pane().should("have.attr", "data-message-id", id);
      cy.get('[data-testid="mail-subject"]').should("contain", "Marko");
    });
  });

  it("nobody picked: the mailbox is signed out, the other collections still answer", () => {
    openMail("ana");
    cy.get('[data-testid="user-none"]').click();
    cy.get('[data-testid="signed-out"]').should("be.visible");
    cy.get('[data-testid="demo-user"]').should("have.attr", "data-signed-out", "true");
    cy.request({
      method: "POST",
      url: "/udc/list",
      body: { collection: "mail_messages", page: { limit: 1 } },
    }).then((res) => {
      expect(res.body.kind).to.eq("udc.list.err");
      expect(res.body.payload).to.deep.include({ code: "forbidden" });
      expect(res.body.payload.details).to.deep.eq({ reason: "unauthenticated" });
    });
    cy.visit("/udc/companies");
    cy.get('[data-testid="row"]', { timeout: 15_000 }).should("have.length.at.least", 1);
    cy.get('[data-testid="user-ana"]').click();
    cy.visit("/mail");
    rows().should("have.length.at.least", 5);
  });
});
