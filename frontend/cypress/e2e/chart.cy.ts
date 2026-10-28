import type { FilterNode, Row } from "@jsudc/udc-core";

/*
 * The chart tab: metrics (seeded to end at noon of SEED_TODAY in Belgrade,
 * 2026-10-27T11:00Z), the repos pie and the quakes bars over the recorded
 * fixtures. The browser's clock is frozen at that noon (Date only, timers
 * run), and the display zone is set in localStorage before each visit, so a
 * run does not depend on the day or the machine's zone.
 */

const BG = "Europe/Belgrade";
const TOKYO = "Asia/Tokyo";
const NOW = Date.parse("2026-10-27T11:00:00Z");

type Body = { collection?: string; filter?: FilterNode };

/** The `between` on `field` inside a filter, if any. */
function betweenOf(node: FilterNode | undefined, field: string): unknown {
  if (!node) return undefined;
  if ("and" in node) {
    for (const n of node.and) {
      const found = betweenOf(n, field);
      if (found) return found;
    }
    return undefined;
  }
  if ("field" in node && node.field === field && node.op === "between") return node.value;
  return undefined;
}

let sent: Body[] = [];

function record() {
  sent = [];
  cy.intercept("POST", "/udc/list", (req) => {
    sent.push(req.body as Body);
  });
}

/** The last `list` of `collection` that carried a window on `field` asked for `value`. */
function lastWindow(collection: string, field: string, value: [string, string]) {
  cy.wrap(null).should(() => {
    const windows = sent
      .filter((b) => b.collection === collection)
      .map((b) => betweenOf(b.filter, field))
      .filter(Boolean);
    expect(windows.at(-1), `${collection} window on ${field}`).to.deep.eq(value);
  });
}

function visit(path: string, zone = BG) {
  cy.clock(NOW, ["Date"]);
  cy.visit(path, {
    onBeforeLoad(win) {
      win.localStorage.setItem("udc-tz", zone);
    },
  });
  cy.get('[data-testid="chart"]', { timeout: 15_000 }).should("exist");
}

const ticks = () =>
  cy
    .get('[data-testid="chart"] .recharts-xAxis-tick-labels text')
    .then(($t) => [...$t].map((e) => e.textContent ?? ""));

/** Hover the plot's right edge: the tooltip of the last point. */
function hoverLastPoint() {
  cy.get('[data-testid="chart"] .recharts-surface').then(($svg) => {
    const svg = $svg[0] as unknown as SVGSVGElement;
    const grid = svg.querySelector(".recharts-cartesian-grid")?.getBoundingClientRect();
    const box = svg.getBoundingClientRect();
    if (!grid) throw new Error("no grid");
    cy.wrap($svg).trigger(
      "mousemove",
      grid.right - box.left - 2,
      grid.top - box.top + grid.height / 2,
    );
  });
}

describe("metrics: a line chart over a time window", () => {
  beforeEach(record);

  it("opens on 24h: two lines on the left axis, one on the right, a between on ts", () => {
    visit("/udc/metrics");
    cy.get('[data-testid="tab-chart"]').should("have.attr", "data-state", "on");
    cy.get('[data-testid="chart-win-24h"]').should("have.attr", "data-state", "on");
    lastWindow("metrics", "ts", ["2026-10-26T12:00:00.000+01:00", "2026-10-27T12:00:00.000+01:00"]);
    cy.get('[data-testid="chart"]')
      .should("have.attr", "data-type", "line")
      .and("have.attr", "data-points", "97")
      .and("have.attr", "data-left-domain")
      .and("match", /^0,(80|100)$/);
    cy.get('[data-testid="chart"] .recharts-line-curve').should("have.length", 3);
    cy.get('[data-testid="chart"] .recharts-yAxis').should("have.length", 2);
    cy.get('[data-testid="chart-legend-item"][data-axis="left"]').should("have.length", 2);
    cy.get('[data-testid="chart-legend-item"][data-axis="right"]')
      .should("have.length", 1)
      .and("have.attr", "data-field", "load");
    cy.get('[data-testid="row-count"]').should("have.text", "291 points in window of 8,640");
    ticks().should("deep.equal", [
      "12:00",
      "15:00",
      "18:00",
      "21:00",
      "Oct 27",
      "03:00",
      "06:00",
      "09:00",
      "12:00",
    ]);
  });

  it("7d changes the request, the x axis and the URL; the legend hides a series", () => {
    visit("/udc/metrics");
    cy.get('[data-testid="chart"]').should("have.attr", "data-points", "97");
    cy.get('[data-testid="chart-win-7d"]').click();
    cy.location("search").should("contain", "win=7d");
    lastWindow("metrics", "ts", ["2026-10-21T00:00:00.000+02:00", "2026-10-27T23:59:59.999+01:00"]);
    ticks().should("deep.equal", [
      "Oct 21",
      "Oct 22",
      "Oct 23",
      "Oct 24",
      "Oct 25",
      "Oct 26",
      "Oct 27",
    ]);
    cy.get('[data-testid="chart"]').should("not.have.attr", "data-points", "97");
    cy.get('[data-testid="chart-legend-item"][data-field="mem"]').click();
    cy.get('[data-testid="chart-legend-item"][data-field="mem"]').should(
      "have.attr",
      "data-hidden",
      "true",
    );
    cy.get('[data-testid="chart"] .recharts-line-curve').should("have.length", 2);
  });

  it("the host = db-1 chip leaves db-1's values: the tooltip shows its last sample", () => {
    visit("/udc/metrics");
    cy.get('[data-testid="chip-host"]').click();
    cy.get('[data-testid="chip-option-db-1"]').click();
    cy.get("body").type("{esc}");
    // The rows ask for the chip and the window; the "of M" count asks for the chip alone.
    cy.wrap(null).should(() => {
      const withHost = sent
        .filter(
          (b) => b.collection === "metrics" && (JSON.stringify(b.filter) ?? "").includes('"db-1"'),
        )
        .map((b) => betweenOf(b.filter, "ts"));
      expect(withHost).to.deep.include([
        "2026-10-26T12:00:00.000+01:00",
        "2026-10-27T12:00:00.000+01:00",
      ]);
      expect(withHost).to.include(undefined);
    });
    cy.get('[data-testid="chart"]').should("have.attr", "data-points", "97");
    cy.udc("list", {
      collection: "metrics",
      filter: {
        and: [
          { field: "host", op: "eq", value: "db-1" },
          {
            field: "ts",
            op: "between",
            value: ["2026-10-27T11:00:00.000Z", "2026-10-27T11:00:00.000Z"],
          },
        ],
      },
      page: { limit: 5 },
    }).then((res) => {
      expect(res.rows).to.have.length(1);
      const sample = res.rows[0] as Row;
      hoverLastPoint();
      cy.get('[data-testid="chart-tooltip-x"]').should("contain.text", "27.10.2026 12:00");
      cy.get(
        '[data-testid="chart-tooltip-row"][data-field="cpu"] [data-testid="chart-tooltip-value"]',
      ).should("have.text", (sample.cpu as number).toFixed(1));
      cy.get(
        '[data-testid="chart-tooltip-row"][data-field="load"] [data-testid="chart-tooltip-value"]',
      ).should("have.text", (sample.load as number).toFixed(2));
      // One host: a point is one row, nothing merged.
      cy.get('[data-testid="chart-tooltip"]').should("not.contain.text", "rows");
    });
  });

  it("Asia/Tokyo moves the window and the ticks; a reload keeps the zone and the preset", () => {
    visit("/udc/metrics");
    cy.get('[data-testid="chart-win-6h"]').click();
    lastWindow("metrics", "ts", ["2026-10-27T06:00:00.000+01:00", "2026-10-27T12:00:00.000+01:00"]);
    ticks().should("deep.equal", ["06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00"]);
    cy.get('[data-testid="tz-trigger"]').click();
    cy.get('[data-testid="tz-search"]').type("tokyo");
    cy.get(`[data-testid="tz-option"][data-tz="${TOKYO}"]`).click();
    cy.get('[data-testid="chart"]').should("have.attr", "data-tz", TOKYO);
    lastWindow("metrics", "ts", ["2026-10-27T14:00:00.000+09:00", "2026-10-27T20:00:00.000+09:00"]);
    ticks().should("deep.equal", ["14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"]);
    // The 7d window: here the zone moves the instants, not only their offset.
    cy.get('[data-testid="chart-win-7d"]').click();
    lastWindow("metrics", "ts", ["2026-10-21T00:00:00.000+09:00", "2026-10-27T23:59:59.999+09:00"]);

    cy.reload();
    cy.get('[data-testid="chart"]', { timeout: 15_000 }).should("have.attr", "data-tz", TOKYO);
    cy.get('[data-testid="tz-trigger"]').should("have.attr", "data-tz", TOKYO);
    cy.get('[data-testid="chart-win-7d"]').should("have.attr", "data-state", "on");
    cy.get('[data-testid="chart"]').should(
      "have.attr",
      "data-from",
      "2026-10-21T00:00:00.000+09:00",
    );
  });

  it("the table tab shows the same window", () => {
    visit("/udc/metrics?win=6h");
    lastWindow("metrics", "ts", ["2026-10-27T06:00:00.000+01:00", "2026-10-27T12:00:00.000+01:00"]);
    cy.get('[data-testid="tab-table"]').click();
    cy.get('[data-testid="row"]', { timeout: 15_000 }).should("have.length.at.least", 1);
    // The window came along: its control stays in the toolbar, with a button to drop it.
    cy.get('[data-testid="chart-win-6h"]').should("have.attr", "data-state", "on");
    cy.get('[data-testid="row-count"]').should("have.attr", "data-total", "75");
    cy.wrap(null).should(() => {
      const table = sent.filter((b) => b.collection === "metrics").at(-1);
      expect(betweenOf(table?.filter, "ts")).to.deep.eq([
        "2026-10-27T06:00:00.000+01:00",
        "2026-10-27T12:00:00.000+01:00",
      ]);
    });
    cy.get('[data-testid="chart-win-clear"]').click();
    cy.location("search").should("not.contain", "win=");
    cy.get('[data-testid="row-count"]').should("have.attr", "data-total", "8640");
  });
});

describe("repos: a pie of stars", () => {
  it("shows at most ten slices plus Other", () => {
    visit("/udc/repos?tab=chart");
    cy.get('[data-testid="chart"]')
      .should("have.attr", "data-type", "pie")
      .and("have.attr", "data-slices", "11")
      .and("have.attr", "data-other", "true");
    cy.get('[data-testid="chart"] .recharts-pie-sector').should("have.length", 11);
    cy.get('[data-testid="chart-legend-item"]').first().should("contain.text", "opencon-backend");
    cy.get('[data-testid="chart-legend-item"]').last().should("contain.text", "Other");
    cy.get('[data-testid="chart-slice-label"]').should("contain.text", "Other");
  });
});

describe("quakes: bars over the fixture's week", () => {
  beforeEach(record);

  it("asks for the 7d window on time and draws one bar per quake in it", () => {
    visit("/udc/quakes?tab=chart");
    lastWindow("quakes", "time", [
      "2026-10-21T00:00:00.000+02:00",
      "2026-10-27T23:59:59.999+01:00",
    ]);
    cy.get('[data-testid="chart"]').should("have.attr", "data-type", "bar");
    cy.get('[data-testid="row-count"]')
      .invoke("attr", "data-shown")
      .then((shown) => {
        expect(Number(shown)).to.be.greaterThan(10);
        cy.get('[data-testid="chart"]').should("have.attr", "data-points", shown);
      });
    cy.get('[data-testid="chart"] .recharts-bar-rectangle').should("have.length.greaterThan", 10);
    ticks().should("deep.equal", [
      "Oct 21",
      "Oct 22",
      "Oct 23",
      "Oct 24",
      "Oct 25",
      "Oct 26",
      "Oct 27",
    ]);
    // Framed on the magnitudes (M4.5+), not on zero.
    cy.get('[data-testid="chart"]')
      .invoke("attr", "data-left-domain")
      .should("match", /^4(\.5)?,/);
  });
});
