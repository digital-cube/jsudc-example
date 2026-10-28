/**
 * flights: OpenSky state vectors with a server-side history. The backend
 * reads backend/test/fixtures/http/flights.1.json on its first upstream call
 * and flights.2.json on every later one (UDC_HTTP_FIXTURES), with a 1 s
 * cache (UDC_FLIGHTS_CACHE_TTL_MS, set by scripts/e2e.mjs): no internet, and
 * the second recording is what gives an aircraft a trail. The tests run in
 * order on one backend: the first sees the first recording.
 */

type State = [
  string,
  string,
  string,
  number,
  number,
  number,
  number,
  number | null,
  boolean,
  number,
  number,
];

const FIXTURES = "../backend/test/fixtures/http";
const markers = () => cy.get('[data-testid="map-marker"]');
const marker = (id: string) => cy.get(`[data-testid="map-marker"][data-id="${id}"]`);
const states = (n: 1 | 2) =>
  cy.readFile<{ states: State[] }>(`${FIXTURES}/flights.${n}.json`).then((f) => f.states);

describe("flights: aircraft over the Balkans, with trails", () => {
  let one: State[] = [];
  let two: State[] = [];
  before(() => {
    states(1).then((s) => {
      one = s;
    });
    states(2).then((s) => {
      two = s;
    });
  });

  it("opens on the map with turned aeroplanes; after the next poll a hovered one has a trail", () => {
    // Only setInterval is faked: the 30 s poll fires on cy.tick, everything else runs.
    cy.clock(Date.now(), ["setInterval"]);
    cy.visit("/udc/flights");
    cy.get('[data-testid="tab-map"]').should("have.attr", "data-state", "on");
    cy.get('[data-testid="map"]').should("have.attr", "data-region", "balkans");
    markers().should("have.length", one.length);
    cy.get('[data-testid="row-count"]').should("contain", `${one.length} on map of ${one.length}`);
    cy.get('[data-testid="map-marker"][data-icon="airplane"]').should("have.length", one.length);
    const first = one[0] as State;
    marker(first[0])
      .should("have.attr", "data-rotation", String(first[10]))
      .find(".udc-map-plane-glyph")
      .should("have.attr", "style")
      .and("contain", `rotate(${first[10]}deg)`)
      .and("contain", "width:22px");
    // One upstream answer so far: every history is one point long, no trail.
    cy.get('[data-testid="map-trail"]').should("not.exist");

    // Past the server's 1 s cache, the page's next poll reads the second recording.
    cy.wait(1200);
    cy.tick(30_000);
    markers().should("have.length", two.length);
    const both = two.find((s) => one.some((o) => o[0] === s[0])) as State;
    marker(both[0]).trigger("mouseover");
    cy.get(`[data-testid="map-trail"][data-id="${both[0]}"]`)
      .should("have.attr", "data-points", "2")
      .and("have.attr", "data-active", "true");
    // An aircraft first seen in the second recording has no trail yet.
    const fresh = two.find((s) => !one.some((o) => o[0] === s[0]));
    if (fresh) cy.get(`[data-testid="map-trail"][data-id="${fresh[0]}"]`).should("not.exist");

    // The popup of a click is the row's callsign, trimmed.
    marker(both[0]).click();
    cy.get('[data-testid="map-popup"]')
      .should("have.attr", "data-id", both[0])
      .find('[data-testid="map-popup-callsign"]')
      .should("have.text", both[1].trim());
  });

  it("the on-ground and altitude chips narrow the aeroplanes", () => {
    const airborne = two.filter((s) => !s[8]);
    const cruise = airborne.filter((s) => s[7] !== null && s[7] >= 9000 && s[7] <= 13000);
    expect(airborne.length, "airborne in the recording").to.be.lessThan(two.length);
    expect(cruise.length, "9–13 km in the recording").to.be.lessThan(airborne.length);
    cy.visit("/udc/flights");
    markers().should("have.length", two.length);
    cy.get('[data-testid="chip-on_ground"]').click();
    cy.get('[data-testid="chip-option-false"]').click();
    markers().should("have.length", airborne.length);
    cy.get('[data-testid="chip-baro_alt"]').click();
    cy.get('[data-testid="chip-min-baro_alt"]').clear().type("9000");
    cy.get('[data-testid="chip-max-baro_alt"]').clear().type("13000");
    cy.get('[data-testid="chip-apply"]').click();
    markers().should("have.length", cruise.length);
    cy.get('[data-testid="row-count"]').should(
      "contain",
      `${cruise.length} on map of ${cruise.length}`,
    );
  });

  it("the table shows altitude sparklines and heading glyphs", () => {
    cy.visit("/udc/flights?tab=table");
    cy.get('[data-testid="row"]').should("have.length.at.least", 10);
    cy.get('[data-testid="sparkline"]').should("have.length.at.least", 10);
    // Aircraft in both recordings: a line of at least two points.
    cy.get('[data-testid="sparkline"] polyline').should("have.length.at.least", 1);
    cy.get('[data-testid="heading-glyph"]')
      .first()
      .should("have.attr", "title")
      .and("match", /^\d+°$/);
    cy.get('[data-testid="cell-baro_alt"]')
      .first()
      .invoke("text")
      .should("match", /^[\d,]+ m$|^—$/);
  });

  it("the cards show the altitude metric and its sparkline", () => {
    cy.visit("/udc/flights?tab=cards");
    cy.get('[data-testid="card"]').should("have.length.at.least", 5);
    cy.get('[data-testid="card-metric"]').first().should("contain", "Altitude");
    cy.get('[data-testid="card-metric-value"]')
      .first()
      .invoke("text")
      .should("match", /^[\d,]+ m$|^—$/);
    cy.get('[data-testid="card-sparkline"] [data-testid="sparkline"]').should(
      "have.length.at.least",
      5,
    );
  });

  it("the freshness pill says the upstream is called anonymously, and how long the server keeps it", () => {
    cy.visit("/udc/flights");
    cy.get('[data-testid="updated-ago"]')
      .should("have.attr", "data-auth", "anonymous")
      .and("have.attr", "data-cache-ttl", "1000")
      .focus();
    cy.get('[data-testid="freshness-auth"]').should("contain", "anonymous");
    cy.get('[data-testid="freshness-cache"]').should("contain", "Server cache: 1 sec");
  });
});
