import type { Row } from "@jsudc/udc-core";
import { decodeParam } from "../support/e2e";

// Runs under `npm run e2e`: the backend reads quakes and repos from the recorded
// answers in backend/test/fixtures/http (UDC_HTTP_FIXTURES), so nothing here needs
// the internet. files lists backend/collections/files/sample.

const rows = () => cy.get('[data-testid="row"]');
const markers = () => cy.get('[data-testid="map-marker"]');
/** Retries until the table shows exactly these row ids, in order. */
const expectIds = (ids: string[]) =>
  rows().should(($r) =>
    expect([...$r].map((r) => r.getAttribute("data-row-id"))).to.deep.equal(ids),
  );

describe("sidebar", () => {
  it("groups the collections by where their rows live", () => {
    cy.visit("/udc/files");
    cy.get('[data-testid="nav-group-database"]').within(() => {
      cy.contains("Database");
      cy.get('[data-testid="nav-companies"]');
      cy.get('[data-testid="nav-tickets"]');
    });
    cy.get('[data-testid="nav-group-files"]').within(() => {
      cy.contains("Files");
      cy.get("a").should("have.length", 1);
      cy.get('[data-testid="nav-files"]');
    });
    cy.get('[data-testid="nav-group-internet"]').within(() => {
      cy.contains("Internet");
      cy.get('[data-testid="nav-quakes"]').should("contain", "Earthquakes");
      cy.get('[data-testid="nav-repos"]').should("contain", "Repositories");
    });
    cy.get('[data-testid="locale-sr"]').click();
    cy.get('[data-testid="nav-group-database"]').should("contain", "Baza");
    cy.get('[data-testid="nav-group-files"]').should("contain", "Fajlovi");
    cy.get('[data-testid="locale-en"]').click();
  });
});

describe("files: a folder on disk", () => {
  it("lists the sample root, folders first, sizes in bytes, read-only", () => {
    cy.visit("/udc/files");
    expectIds([
      "data",
      "docs",
      "images",
      "budget.csv",
      "CHANGELOG.txt",
      "contacts.json",
      "logo.png",
      "notes.md",
      "README.md",
      "todo.md",
    ]);
    cy.get('[data-testid="folder-bar"]').should("have.attr", "data-folder", "");
    cy.get('[data-row-id="budget.csv"] [data-testid="cell-size"]').should("have.text", "167 B");
    cy.get('[data-row-id="docs"] [data-testid="cell-size"]').should("contain", "—");
    // No inline edit, no schema editor, no + column.
    cy.get("[data-editable]").should("not.exist");
    cy.get('[data-testid="col-add-end"]').should("not.exist");
  });

  it("enters a subfolder on click, keeps it on reload, and .. returns", () => {
    cy.visit("/udc/files");
    cy.get('[data-testid="folder-link"][data-path="images"]').click();
    cy.location("search").then((search) =>
      expect(decodeParam(search, "f")).to.deep.equal({ field: "path", op: "eq", value: "images" }),
    );
    expectIds([
      "..",
      "images/checker.png",
      "images/gradient.png",
      "images/green.png",
      "images/red.png",
    ]);
    cy.get('[data-row-id="images/gradient.png"] [data-testid="cell-size"]').should(
      "have.text",
      "29.6 KB",
    );
    cy.get('[data-testid="folder-bar"]').should("have.attr", "data-folder", "images");
    // A folder is a condition of the filter, not a pill.
    cy.get('[data-testid="filter-pills"]').should("not.exist");

    cy.reload();
    rows().first().should("have.attr", "data-row-id", "..");
    cy.get('[data-testid="crumb-images"]').should("exist");

    cy.get('[data-testid="folder-link"][data-path=""]').click();
    rows().first().should("have.attr", "data-row-id", "data");
    cy.location("search").should("not.contain", "f=");
  });

  it("goes two levels down and back up by the breadcrumb", () => {
    cy.visit("/udc/files");
    cy.get('[data-testid="folder-link"][data-path="docs"]').click();
    cy.get('[data-testid="folder-link"][data-path="docs/archive"]').click();
    expectIds(["..", "docs/archive/2025-notes.md"]);
    cy.get('[data-testid="crumb-docs"]').click();
    expectIds([
      "..",
      "docs/archive",
      "docs/api.json",
      "docs/filters.md",
      "docs/getting-started.md",
    ]);
    cy.get('[data-testid="crumb-root"]').click();
    rows().should("have.length", 10);
  });

  it("applies search and the ext chip inside the open folder", () => {
    cy.visit("/udc/files");
    cy.get('[data-testid="folder-link"][data-path="data"]').click();
    rows().should("have.length", 5);
    cy.get('[data-testid="chip-ext"]').click();
    cy.get('[data-testid="chip-option-csv"]').click();
    cy.get("body").type("{esc}");
    expectIds(["..", "data/cities.csv", "data/sales-2026.csv"]);
    cy.get('[data-testid="search-input"]').type("sales");
    expectIds(["..", "data/sales-2026.csv"]);
    cy.get('[data-testid="folder-bar"]').should("have.attr", "data-folder", "data");
  });

  it("previews a text file and an image", () => {
    cy.visit("/udc/files");
    cy.get('[data-testid="file-link"][data-path="notes.md"]').click();
    cy.get('[data-testid="preview-text"]').should(
      "contain",
      "The filesystem source lists one folder",
    );
    cy.get("body").type("{esc}");
    cy.get('[data-testid="file-link"][data-path="logo.png"]').click();
    cy.get('[data-testid="preview-image"]')
      .should("have.attr", "src")
      .and("contain", "/udc/files/blob?collection=files&path=logo.png");
    cy.get('[data-testid="preview-image"]').should(($img) =>
      expect(($img[0] as HTMLImageElement).naturalWidth).to.eq(48),
    );
  });

  it("shows the folders as cards too", () => {
    cy.visit("/udc/files?tab=cards");
    cy.get('[data-testid="card"]').should("have.length", 10);
    cy.get('[data-testid="card"][data-row-id="docs"] [data-testid="folder-link"]').click();
    cy.get('[data-testid="card"]').first().should("have.attr", "data-row-id", "..");
  });
});

describe("quakes: USGS earthquakes on the map", () => {
  let all: Row[] = [];
  before(() => {
    cy.udc("list", { collection: "quakes", page: { limit: 1000 } }).then((res) => {
      all = res.rows as Row[];
    });
  });

  it("opens on the map with the fixture's markers, sized by magnitude", () => {
    expect(all, "recorded features").to.have.length(100);
    cy.visit("/udc/quakes");
    cy.get('[data-testid="tab-map"]').should("have.attr", "data-state", "on");
    markers().should("have.length", 100);
    cy.get('[data-testid="row-count"]').should("contain", "100 on map of 100");
    cy.get('[data-testid="map"]').should("have.attr", "data-region", "world");
    cy.get('[data-testid="updated-ago"]').should("contain", "updated");

    const byMag = [...all].sort((a, b) => Number(a.mag) - Number(b.mag));
    const small = byMag[0] as Row;
    const big = byMag[byMag.length - 1] as Row;
    const width = (id: string) =>
      cy
        .get(`[data-testid="map-marker"][data-id="${id}"]`)
        .then(($p) => ($p[0] as unknown as SVGGraphicsElement).getBBox().width);
    width(small.__meta.id).then((w1) =>
      width(big.__meta.id).then((w2) => expect(w2).to.be.greaterThan(w1 + 4)),
    );
  });

  it("a region button flies to Europe", () => {
    cy.visit("/udc/quakes");
    markers().should("have.length", 100);
    cy.get('[data-testid="map-region-europe"]').click();
    cy.get('[data-testid="map"]', { timeout: 5000 })
      .should("have.attr", "data-region", "europe")
      .and("have.attr", "data-zoom", "4");
  });

  it("the mag range chip drops the small ones; the table keeps the filter, with alert badges", () => {
    const strong = all.filter((r) => Number(r.mag) >= 6);
    expect(strong.length, "M6+ in the fixture").to.be.within(5, 40);
    cy.visit("/udc/quakes");
    markers().should("have.length", 100);
    cy.get('[data-testid="chip-mag"]').click();
    cy.get('[data-testid="chip-min-mag"]').clear().type("6");
    cy.get('[data-testid="chip-apply"]').click();
    markers().should("have.length", strong.length);

    cy.get('[data-testid="tab-table"]').click();
    rows().should("have.length", strong.length);
    cy.get('[data-testid="cell-mag"]').each(($c) => expect(Number($c.text())).to.be.at.least(6));
    const orange = strong.find((r) => r.alert === "orange");
    if (orange) {
      cy.get(`[data-row-id="${orange.__meta.id}"] [data-testid="badge"]`)
        .first()
        .should("have.text", "orange")
        .and("have.attr", "data-tone", "warning");
    }
    cy.get('[data-testid="updated-ago"]').should("be.visible");
    cy.get('[data-testid="stale-pill"]').should("not.exist");

    cy.get('[data-testid="tab-map"]').click();
    markers().should("have.length", strong.length);
    cy.location("search").should("contain", "cf=");
  });

  it("marks a stale copy", () => {
    cy.intercept("POST", "/udc/list", (req) => {
      req.continue((res) => {
        res.body.payload.stale = true;
        res.body.payload.fetched_at = new Date(Date.now() - 125_000).toISOString();
      });
    });
    cy.visit("/udc/quakes?tab=table");
    cy.get('[data-testid="stale-pill"]').should("contain", "stale");
    cy.get('[data-testid="updated-ago"]').should("contain", "2 min");
  });

  it("the Doc tab renders the README, in the chosen language", () => {
    cy.visit("/udc/quakes");
    cy.get('[data-testid="tab-doc"]').click();
    cy.location("search").should("contain", "tab=doc");
    cy.get('[data-testid="doc-tab"] h1').should("have.text", "Earthquakes");
    cy.get('[data-testid="doc-tab"] li').should("have.length", 3);
    cy.get('[data-testid="doc-tab"] code').should("contain", "geometry.coordinates");
    cy.get('[data-testid="toolbar"]').should("not.be.visible");
    cy.get('[data-testid="locale-sr"]').click();
    cy.get('[data-testid="doc-tab"] h1').should("have.text", "Zemljotresi");
    cy.get('[data-testid="locale-en"]').click();
  });
});

describe("repos: GitHub repositories", () => {
  it("draws cards with the owner's avatar and the topics", () => {
    cy.visit("/udc/repos");
    cy.get('[data-testid="tab-cards"]').should("have.attr", "data-state", "on");
    cy.get('[data-testid="card"]').should("have.length", 45);
    cy.get('[data-testid="card"][data-row-id="preview-hello"]').within(() => {
      cy.get('[data-testid="card-image-avatar"]')
        .should("have.attr", "src")
        .and("match", /^https:\/\/avatars\.githubusercontent\.com\//);
      cy.get('[data-testid="card-meta-topics"] [data-testid="badge"]').then(($b) =>
        expect([...$b].map((b) => b.textContent)).to.deep.equal(["udc", "typescript", "data-grid"]),
      );
    });
  });

  it("filters by the language chip and the search box", () => {
    cy.visit("/udc/repos");
    cy.get('[data-testid="card"]').should("have.length", 45);
    cy.get('[data-testid="chip-language"]').click();
    cy.get('[data-testid="chip-option-TypeScript"]').click();
    cy.get("body").type("{esc}");
    cy.get('[data-testid="card-subtitle"]').should(($s) => {
      expect($s.length).to.be.within(2, 44);
      for (const el of $s) expect(el.textContent).to.contain("TypeScript");
    });
    cy.get('[data-testid="search-input"]').type("hackaton");
    cy.get('[data-testid="card"]').should("have.length", 1);
  });
});
