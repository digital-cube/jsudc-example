import type { Row } from "@jsudc/udc-core";

/*
 * The two tree examples, seeded: `comments` (80 comments, 8 top-level, built
 * in the browser) and `org` (134 nodes, read one level at a time). Drags use
 * pointer events (dnd-kit's PointerSensor), as the kanban spec.
 */

const rows = () => cy.get('[data-testid="tree-row"]');
const rowById = (id: string) => cy.get(`[data-testid="tree-row"][data-id="${id}"]`);
const rowNamed = (name: string) =>
  cy
    .contains('[data-testid="tree-label"]', new RegExp(`^\\s*${name}\\s*$`))
    .closest('[data-testid="tree-row"]');
const topNodes = () =>
  cy.get('[data-testid="tree-root"] > [role="group"] > [data-testid="tree-node"]');

function all(collection: string): Cypress.Chainable<Row[]> {
  return cy.udc("list", { collection, page: { limit: 500 } }).then((res) => res.rows);
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

/** Drag `source` and release it over the middle of `target` (`dy` from its top when given). */
function drag(
  source: Cypress.Chainable<JQuery<HTMLElement>>,
  target: () => Cypress.Chainable<JQuery<HTMLElement>>,
  dy?: number,
) {
  source.then(($s) => {
    const r = $s[0]?.getBoundingClientRect() as DOMRect;
    const x = r.left + 60;
    const y = r.top + r.height / 2;
    cy.wrap($s).trigger("pointerdown", pointer(x, y));
    cy.document().trigger("pointermove", pointer(x + 8, y + 8));
    cy.wait(80);
    target().then(($t) => {
      const t = $t[0]?.getBoundingClientRect() as DOMRect;
      const tx = t.left + 120;
      const ty = t.top + (dy ?? t.height / 2);
      cy.document().trigger("pointermove", pointer(tx, ty - 12));
      cy.wait(60);
      cy.document().trigger("pointermove", pointer(tx, ty));
      cy.wait(150);
      cy.document().trigger("pointerup", pointer(tx, ty));
    });
  });
}

describe("tree: comments (lazy: false)", () => {
  beforeEach(() => cy.reseed());

  it("opens fully expanded with the seeded roots, as N nodes", () => {
    all("comments").then((seed) => {
      const roots = seed.filter((r) => r.parent_id == null);
      cy.visit("/udc/comments");
      topNodes().should("have.length", roots.length);
      rows().should("have.length", seed.length);
      cy.get('[data-testid="row-count"]').should("contain", `${seed.length} nodes`);
      // Every comment with replies is open (default_depth 99).
      const parents = new Set(seed.map((r) => r.parent_id).filter(Boolean));
      cy.get('[data-testid="tree-row"][data-open]').should("have.length", parents.size);
      cy.get('[data-testid="paging-toggle"]').should("not.exist");
    });
  });

  it("search highlights the matches, opens only their branches, and clearing restores", () => {
    all("comments").then((seed) => {
      const byId = new Map(seed.map((r) => [r.__meta.id, r]));
      const matches = seed.filter((r) => String(r.body).includes("Beograd"));
      const open = new Set<string>();
      for (const m of matches) {
        for (let p = m.parent_id as string | null; p; p = byId.get(p)?.parent_id as string | null) {
          open.add(p);
        }
      }
      cy.visit("/udc/comments");
      rows().should("have.length", seed.length);
      cy.get('[data-testid="search-input"]').type("Beograd");
      cy.get('[data-testid="tree-highlight"]').should("have.length", matches.length);
      cy.get('[data-testid="tree-highlight"]').first().should("have.text", "Beograd");
      cy.get('[data-testid="tree-row"][data-open]').should("have.length", open.size);
      for (const m of matches) rowById(m.__meta.id).should("be.visible");
      // The whole thread stays loaded: the search did not go to the server.
      cy.get('[data-testid="row-count"]').should("contain", `${seed.length} nodes`);

      cy.get('[data-testid="search-input"]').clear();
      cy.get('[data-testid="tree-highlight"]').should("not.exist");
      rows().should("have.length", seed.length);
    });
  });

  it("replies under a comment: the new row has parent_id and depth", () => {
    all("comments").then((seed) => {
      const parent = seed.find((r) => r.depth === 1) as Row;
      const text = `Odgovor iz Cypress-a ${Date.now()}`;
      cy.visit("/udc/comments");
      rowById(parent.__meta.id).find('[data-testid="tree-menu"]').click({ force: true });
      cy.get('[data-testid="tree-reply"]').click();
      cy.get('[data-testid="tree-reply-input"]').type(`${text}{enter}`);
      cy.contains('[data-testid="tree-row"]', text).should("be.visible");
      cy.udc("list", {
        collection: "comments",
        filter: { field: "body", op: "eq", value: text },
      }).then(({ rows: found }) => {
        expect(found).to.have.length(1);
        cy.udc("read", { collection: "comments", id: found[0]?.__meta.id as string }).then(
          ({ row }) => {
            expect(row.parent_id).to.eq(parent.__meta.id);
            expect(row.depth).to.eq(2);
            expect(row.author).to.eq("You");
            expect(row.author_initials).to.eq("YO");
          },
        );
      });
    });
  });
});

describe("tree: org (lazy: true)", () => {
  beforeEach(() => cy.reseed());

  const company = (seed: Row[]) => seed.find((r) => r.kind === "company") as Row;
  const named = (seed: Row[], name: string) => seed.find((r) => r.name === name) as Row;

  it("opens the company one level deep and reads a department's teams when it opens", () => {
    all("org").then((seed) => {
      const departments = seed.filter((r) => r.parent_id === company(seed).__meta.id);
      const eng = named(seed, "Inženjering");
      cy.visit("/udc/org");
      rows().should("have.length", 1 + departments.length);
      cy.intercept("POST", "/udc/list").as("list");
      cy.get('[data-testid="row-count"]').should("contain", `1 of ${seed.length} nodes`);
      cy.get('[data-testid="tree-expand-all"]').should("not.exist");

      rowById(eng.__meta.id).find('[data-testid="tree-toggle"]').click();
      cy.wait("@list")
        .its("request.body.filter")
        .should((f) => {
          expect(JSON.stringify(f)).to.contain(
            JSON.stringify({ field: "parent_id", op: "eq", value: eng.__meta.id }),
          );
        });
      rowNamed("Platforma").should("be.visible");
      rowById(eng.__meta.id).find('[data-testid="tree-count"]').should("have.text", "4");
    });
  });

  it("renames a team inline; it is still renamed after a reload", () => {
    all("org").then((seed) => {
      const eng = named(seed, "Inženjering");
      cy.visit("/udc/org");
      rowById(eng.__meta.id).find('[data-testid="tree-toggle"]').click();
      rowNamed("Podaci").find('[data-testid="tree-label"]').dblclick();
      cy.get('[data-testid="tree-rename-input"]').clear().type("Podaci i analitika{enter}");
      rowNamed("Podaci i analitika").should("be.visible");
      cy.reload();
      rowNamed("Podaci i analitika").should("be.visible");
      cy.udc("read", { collection: "org", id: named(seed, "Podaci").__meta.id }).then(({ row }) => {
        expect(row.name).to.eq("Podaci i analitika");
        expect(row.__meta.version).to.eq(2);
      });
    });
  });

  it("drags a team under another department; the server keeps the structure consistent", () => {
    all("org").then((seed) => {
      const eng = named(seed, "Inženjering");
      const sales = named(seed, "Prodaja");
      const team = named(seed, "Platforma");
      cy.intercept("POST", "/udc/tree.reparent").as("reparent");
      cy.visit("/udc/org");
      rowById(eng.__meta.id).find('[data-testid="tree-toggle"]').click();
      rowNamed("Platforma").should("be.visible");
      drag(rowById(team.__meta.id), () => rowById(sales.__meta.id));
      cy.wait("@reparent").its("request.body").should("deep.include", {
        id: team.__meta.id,
        parent: sales.__meta.id,
        expected_version: 1,
      });
      cy.udc("read", { collection: "org", id: team.__meta.id }).then(({ row }) => {
        expect(row.parent_id).to.eq(sales.__meta.id);
        expect(row.depth).to.eq(2);
        expect(row.ancestor_ids).to.deep.eq([company(seed).__meta.id, sales.__meta.id]);
      });
      cy.udc("read", { collection: "org", id: eng.__meta.id })
        .its("row.children_count")
        .should("eq", (eng.children_count as number) - 1);
      cy.udc("read", { collection: "org", id: sales.__meta.id })
        .its("row.children_count")
        .should("eq", (sales.children_count as number) + 1);
      // Its people moved with it: one level deeper is still under the team.
      cy.udc("list", {
        collection: "org",
        filter: { field: "parent_id", op: "eq", value: team.__meta.id },
      }).then(({ rows: people }) => {
        for (const p of people) {
          expect(p.ancestor_ids).to.deep.eq([
            company(seed).__meta.id,
            sales.__meta.id,
            team.__meta.id,
          ]);
        }
      });
      cy.reload();
      rowById(sales.__meta.id).should("have.attr", "data-open");
      rowById(sales.__meta.id)
        .closest('[data-testid="tree-node"]')
        .find(`[data-testid="tree-row"][data-id="${team.__meta.id}"]`)
        .should("be.visible");
    });
  });

  it("refuses to drop a department onto its own team, without a request", () => {
    all("org").then((seed) => {
      const eng = named(seed, "Inženjering");
      const team = named(seed, "Platforma");
      let calls = 0;
      cy.intercept("POST", "/udc/tree.reparent", () => {
        calls += 1;
      });
      cy.visit("/udc/org");
      rowById(eng.__meta.id).find('[data-testid="tree-toggle"]').click();
      rowNamed("Platforma").should("be.visible");
      // Mid-drag the team is marked as a refused target (the drag did start), then the drop.
      rowById(eng.__meta.id).then(($s) => {
        const r = $s[0]?.getBoundingClientRect() as DOMRect;
        cy.wrap($s).trigger("pointerdown", pointer(r.left + 60, r.top + r.height / 2));
        cy.document().trigger("pointermove", pointer(r.left + 70, r.top + r.height / 2 + 10));
      });
      rowById(team.__meta.id).should("have.attr", "data-drop-refused");
      rowById(named(seed, "Prodaja").__meta.id).should("not.have.attr", "data-drop-refused");
      rowById(team.__meta.id).then(($t) => {
        const t = $t[0]?.getBoundingClientRect() as DOMRect;
        cy.document().trigger("pointermove", pointer(t.left + 120, t.top + t.height / 2));
        cy.wait(150);
        cy.document().trigger("pointerup", pointer(t.left + 120, t.top + t.height / 2));
      });
      cy.wait(500).then(() => expect(calls).to.eq(0));
      cy.udc("read", { collection: "org", id: eng.__meta.id })
        .its("row.parent_id")
        .should("eq", company(seed).__meta.id);
    });
  });

  it("the person chip plus a search narrows to matching people; the table shows the same rows", () => {
    all("org").then((seed) => {
      // `contains`, case-insensitive, over name and title: "Vođa tima" and "Računovođa".
      const leads = seed.filter(
        (r) => r.kind === "person" && `${r.name} ${r.title}`.toLowerCase().includes("vođa"),
      );
      cy.visit("/udc/org");
      cy.get('[data-testid="chip-kind"]').click();
      cy.get('[data-testid="chip-option-person"]').click();
      cy.get("body").type("{esc}");
      cy.get('[data-testid="search-input"]').type("Vođa");
      rows().should("have.length", leads.length);
      cy.get('[data-testid="tree-orphan"]').should("have.length", leads.length);
      cy.get('[data-testid="tree-highlight"]').should("have.length", 0);
      cy.get('[data-testid="row-count"]').should("contain", `${leads.length} nodes`);

      cy.get('[data-testid="tab-table"]').click();
      cy.get('[data-testid="row"]').should("have.length", leads.length);
      cy.get('[data-testid="row-count"]').should("have.attr", "data-total", String(leads.length));
    });
  });
});
