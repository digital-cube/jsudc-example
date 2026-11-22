/*
 * The toolbar's row count of a source that does not count, on @jsudc/react 0.5.1.
 *
 * mail_messages reports `capabilities.total_count: false` (a mailbox can be large), so
 * every `list` answers `total: null`. Up to 0.5.0 the data view read that as "still
 * loading" and `[data-testid="row-count"]` stayed a skeleton forever (TCKXTDJURQ).
 * From 0.5.1 the skeleton stands only until the first page has answered; then the count
 * says what is loaded: "Showing 50+" while a full page says there may be more, "Showing
 * 12" once the list has all of it. The view pages `infinite` by 50.
 */

const PAGE = 50;

/** Once the rows are in: the count is text, not a skeleton, and agrees with `data-shown`. */
function countIsShown(scope = "") {
  const count = () => cy.get(`${scope} [data-testid="row-count"]`.trim());
  count().should("not.have.attr", "data-loading");
  count().find(".udc-skeleton").should("not.exist");
  // No total to show: the server did not count.
  count().should("not.have.attr", "data-total");
  count().should(($c) => {
    const shown = Number($c.attr("data-shown"));
    expect(shown, "rows loaded").to.be.at.least(1);
    const more = shown % PAGE === 0;
    expect($c.text().trim()).to.eq(`Showing ${shown}${more ? "+" : ""}`);
  });
}

function asUser(user: string) {
  return {
    onBeforeLoad: (win: Window) => win.localStorage.setItem("example:demo-user", user),
  };
}

describe("@jsudc/react 0.5.1: the row count without a total (total_count: false)", () => {
  it("/udc/mail_messages: the count is shown once the rows have loaded", () => {
    cy.visit("/udc/mail_messages", asUser("ana"));
    cy.get('[data-testid="row"]', { timeout: 15_000 }).should("have.length.at.least", 5);
    countIsShown();
  });

  it("/mail: the embedded list's count is shown, in a full folder and in a short one", () => {
    cy.visit("/mail", asUser("ana"));
    cy.get('[data-testid="mail-page"]').should("have.attr", "data-user", "ana");
    cy.get('[data-testid="mail-list"] [data-testid="row"]').should("have.length.at.least", 5);
    countIsShown('[data-testid="mail-list"]');

    // A folder shorter than a page: everything is loaded, so no "+".
    cy.get('[data-testid="mail-folder-custom"]').click();
    cy.location("search").should("contain", "folder=");
    cy.get('[data-testid="mail-list"] [data-testid="row"]').should("have.length.at.least", 5);
    countIsShown('[data-testid="mail-list"]');
  });
});
