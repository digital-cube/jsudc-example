import type { CollectionListing, SourceGroup } from "@jsudc/udc-core";

/*
 * The sidebar is the `menu` collection (backend/collections/menu/data/menu.yaml)
 * drawn as chrome; /udc/menu is the same rows drawn as data. The collections
 * branch is resolved by the server from its registry, so the expected leaves
 * come from `collections`. quakes and repos read recorded fixtures: no internet.
 */

const ROOTS = ["HOME", "COLLECTIONS", "VIEWS", "DOCS", "MENU", "ABOUT"];
const node = (code: string) => cy.get(`[data-testid="menu-${code}"]`);
const tree = () => cy.get('[data-testid="menu-tree"]');

function byGroup(): Cypress.Chainable<Record<SourceGroup, string[]>> {
  return cy.udc("collections", {}).then(({ collections }) => {
    const out: Record<SourceGroup, string[]> = { database: [], files: [], internet: [] };
    for (const c of collections as CollectionListing[]) out[c.group ?? "database"].push(c.name);
    return out;
  });
}

/** The leaves drawn right under a branch row, as `nav-<name>` test ids. */
function leavesUnder(code: string): Cypress.Chainable<string[]> {
  return node(code)
    .next('[role="group"]')
    .children()
    .children("[data-menu-row]")
    .then(($rows) => [...$rows].map((r) => r.getAttribute("data-testid") as string));
}

describe("the sidebar from the menu collection", () => {
  it("draws HOME / COLLECTIONS / VIEWS / DOCS / MENU / ABOUT, each with its icon", () => {
    cy.visit("/about");
    cy.get('[data-testid="sidebar"]').should("have.attr", "data-sidebar", "menu");
    tree()
      .children()
      .children("[data-menu-row]")
      .should(($rows) =>
        expect([...$rows].map((r) => r.getAttribute("data-code"))).to.deep.equal(ROOTS),
      );
    for (const code of ROOTS) {
      node(code)
        .find('[data-testid="menu-icon"]')
        .should("have.attr", "data-icon")
        .and("match", /^lucide:/);
    }
    node("HOME").should("contain", "Home");
    node("ABOUT").should("have.attr", "aria-current", "page");
    cy.get('[data-testid="about-page"]').should("contain", "Universal Data Collection");
  });

  it("COLLECTIONS lists the registry's collections under DATABASE / FILES / INTERNET", () => {
    cy.visit("/about");
    byGroup().then((groups) => {
      expect(groups.database).to.include.members(["companies", "tickets", "appointments"]);
      expect(groups.files).to.include.members(["files", "menu"]);
      expect(groups.internet).to.include.members(["quakes", "repos"]);
      node("COLLECTIONS").should("have.attr", "aria-expanded", "false").click();
      node("COLLECTIONS").should("have.attr", "aria-expanded", "true");
      for (const [code, group] of [
        ["DATABASE", "database"],
        ["FILES", "files"],
        ["INTERNET", "internet"],
      ] as const) {
        node(code).click().should("have.attr", "aria-expanded", "true");
        leavesUnder(code).should(
          "deep.equal",
          groups[group].map((n) => `nav-${n}`),
        );
      }
      cy.get('[data-testid="nav-quakes"]').should("contain", "Earthquakes");
      cy.get('[data-testid="nav-companies"]').click();
      cy.location("pathname").should("eq", "/udc/companies");
      cy.get('[data-testid="nav-companies"]').should("have.attr", "aria-current", "page");
    });
  });

  it("Tickets under VIEWS opens the board, that leaf is lit, and a reload keeps the expansion", () => {
    cy.visit("/about");
    node("VIEWS").click();
    node("TICKETS_KANBAN").should("contain", "Tickets").click();
    cy.location("pathname").should("eq", "/udc/tickets");
    cy.location("search").should("contain", "tab=kanban");
    cy.get('[data-testid="kanban-column"]', { timeout: 15_000 }).should("have.length.at.least", 1);
    node("TICKETS_KANBAN")
      .should("have.attr", "aria-current", "page")
      .and("have.attr", "data-active", "true");
    // The collection's own leaf matches the path too, but the Views leaf names the tab: it wins.
    node("COLLECTIONS").click();
    node("DATABASE").click();
    cy.get('[data-testid="nav-tickets"]').should("not.have.attr", "aria-current");
    node("DOCS").click();
    cy.reload();
    node("VIEWS").should("have.attr", "aria-expanded", "true");
    node("DOCS").should("have.attr", "aria-expanded", "true");
    node("DATABASE").should("have.attr", "aria-expanded", "true");
    node("TICKETS_KANBAN").should("have.attr", "aria-current", "page");
    cy.window().then((w) => {
      const open = JSON.parse(w.localStorage.getItem("udc:menu:expanded") ?? "[]") as string[];
      expect(open).to.have.length.of.at.least(4);
    });
  });

  it("switching to SR translates the labels", () => {
    cy.visit("/about");
    node("COLLECTIONS").click();
    cy.get('[data-testid="locale-sr"]').click();
    node("HOME").should("contain", "Početna");
    node("COLLECTIONS").should("contain", "Kolekcije");
    node("VIEWS").should("contain", "Prikazi");
    node("DATABASE").should("contain", "Baza");
    node("ABOUT").should("contain", "O aplikaciji");
    cy.get('[data-testid="about-page"]').should("contain", "ponovo implementira");
    cy.get('[data-testid="locale-en"]').click();
    node("HOME").should("contain", "Home");
  });
});

describe("/udc/menu: the same rows as data", () => {
  it("opens on the tree tab with the menu's nodes", () => {
    cy.visit("/udc/menu");
    cy.location("pathname").should("eq", "/udc/menu");
    cy.get('[data-testid="tab-tree"]').should("have.attr", "data-state", "on");
    node("MENU").should("have.attr", "aria-current", "page");
    for (const label of ["Home", "Collections", "Views", "Docs", "Menu", "About"]) {
      cy.contains('[data-testid="tree-label"]', new RegExp(`^\\s*${label}\\s*$`));
    }
    // default_depth 2: the second level is open, the collection leaves are one level further.
    cy.contains('[data-testid="tree-label"]', /^\s*Database\s*$/);
    cy.contains('[data-testid="tree-label"]', /^\s*Tickets board\s*$/);
  });

  it("the table tab ticks is_dynamic on the rows the registry added", () => {
    cy.visit("/udc/menu?tab=table");
    cy.udc("list", { collection: "menu", page: { limit: 500 } }).then(({ rows }) => {
      const dynamic = rows.filter((r) => r.is_dynamic === true);
      const written = rows.filter((r) => r.is_dynamic === false);
      expect(dynamic.length).to.be.greaterThan(5);
      for (const r of [dynamic[0], dynamic.at(-1)]) {
        cy.get(`[data-testid="row"][data-row-id="${r?.__meta.id}"]`)
          .find('[data-testid="cell-is_dynamic"] [data-bool="true"]')
          .should("exist");
      }
      cy.get(`[data-testid="row"][data-row-id="${written[0]?.__meta.id}"]`)
        .find('[data-testid="cell-is_dynamic"] [data-bool="false"]')
        .should("exist");
      cy.get('[data-testid="icon-value"]').first().should("have.attr", "data-icon", "lucide:house");
    });
  });

  it("the Source tab shows the YAML as written", () => {
    cy.visit("/udc/menu");
    cy.get('[data-testid="tab-source"]').click();
    cy.location("search").should("contain", "tab=source");
    cy.get('[data-testid="source-path"]').should("have.text", "menu/data/menu.yaml");
    cy.get('[data-testid="source-mtime"]').should("have.attr", "data-mtime");
    cy.get('[data-testid="source-text"]')
      .should("contain", 'children: "udc:collections?group=database"')
      .and("contain", "code: HOME");
    cy.get('[data-testid="toolbar"]').should("have.class", "hidden");
  });
});
