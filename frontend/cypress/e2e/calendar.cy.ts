import type { FilterNode, Row } from "@jsudc/core";

/*
 * The appointments calendar, seeded around 2026-10-27 (`npm run e2e` pins
 * SEED_TODAY), and the tickets calendar tab. The display zone is set in
 * localStorage before each visit, so the run does not depend on the
 * machine's zone. Hour height is 64px (the view's `hour_height_px`).
 */

const BG = "Europe/Belgrade";
const NY = "America/New_York";
const HOUR_PX = 64;
/** The README's demo: an 08:00 Belgrade appointment on the seed day. */
const DEMO_START = "2026-10-27T08:00:00+01:00";
const WEEK: [string, string] = ["2026-10-26T00:00:00.000+01:00", "2026-10-30T23:59:59.999+01:00"];

function visitCalendar(path = "/udc/appointments?date=2026-10-27", zone = BG) {
  cy.visit(path, {
    onBeforeLoad(win) {
      win.localStorage.setItem("udc-tz", zone);
    },
  });
  cy.get('[data-testid="calendar"]', { timeout: 15_000 }).should("have.attr", "data-tz", zone);
  cy.get('[data-testid="cal-event"], [data-testid="cal-chip"]', { timeout: 15_000 }).should(
    "have.length.at.least",
    1,
  );
}

function inWindow(window: [string, string], extra?: FilterNode) {
  const between: FilterNode = { field: "start", op: "between", value: window };
  return cy
    .udc("list", {
      collection: "appointments",
      filter: extra ? { and: [extra, between] } : between,
      sort: [{ field: "start" }],
      page: { limit: 500 },
    })
    .then((res) => res.rows);
}

/** The first appointment at 08:00 Belgrade on the seed day. */
function demoRow(): Cypress.Chainable<Row> {
  return inWindow([DEMO_START, DEMO_START]).then((rows) => rows[0] as Row);
}

const eventEl = (id: string) => cy.get(`[data-testid="cal-event"][data-event-id="${id}"]`);

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

/** Press on `el` (its top part), move by `dy` px (and `dx`), release. */
function dragBy(el: Cypress.Chainable<JQuery<HTMLElement>>, dy: number, dx = 0, atBottom = false) {
  el.then(($el) => {
    const r = ($el[0] as HTMLElement).getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = atBottom ? r.bottom - 2 : r.top + 6;
    cy.wrap($el).trigger("pointerdown", pointer(x, y));
    cy.document().trigger("pointermove", pointer(x + dx / 2, y + dy / 2));
    cy.wait(30);
    cy.document().trigger("pointermove", pointer(x + dx, y + dy));
    cy.wait(30);
    cy.document().trigger("pointerup", pointer(x + dx, y + dy));
  });
}

function clickEvent(id: string) {
  eventEl(id).click();
  cy.get('[data-testid="cal-detail"]').should("have.attr", "data-event-id", id);
}

/** Alias the `list` call whose filter asks for the window starting at `from`. */
function aliasWindow(alias: string, from: string) {
  cy.intercept("POST", "/udc/list", (req) => {
    if (JSON.stringify(req.body.filter ?? null).includes(from)) req.alias = alias;
  });
}

const listBody = (i: { request: { body: { filter?: FilterNode } } }) => i.request.body.filter;

describe("calendar", () => {
  beforeEach(() => cy.reseed());

  it("opens on the work week of 2026-10-27 with the seeded count of that week", () => {
    inWindow(WEEK).then((rows) => {
      visitCalendar();
      cy.get('[data-testid="calendar"]')
        .should("have.attr", "data-preset", "workweek")
        .and("have.attr", "data-from", WEEK[0])
        .and("have.attr", "data-to", WEEK[1]);
      cy.get('[data-testid="cal-day-column"]').should("have.length", 5);
      cy.get('[data-testid="cal-event"]').should("have.length", rows.length);
      cy.get('[data-testid="row-count"]').should("have.attr", "data-total", String(rows.length));
      // No paging on the calendar tab.
      cy.get('[data-testid="paging-toggle"]').should("not.exist");
      cy.get('[data-testid="tz-trigger"]').should("have.attr", "data-tz", BG);
      cy.get('[data-testid="cal-zone"]').should("contain.text", "Belgrade");
    });
  });

  it("prev / next move the window and the between values of the request", () => {
    aliasWindow("next", "2026-11-02T00:00:00.000+01:00");
    aliasWindow("before", "2026-10-19T00:00:00.000+02:00");
    visitCalendar();
    cy.get('[data-testid="cal-next"]').click();
    cy.wait("@next")
      .then(listBody)
      .should("deep.eq", {
        field: "start",
        op: "between",
        value: ["2026-11-02T00:00:00.000+01:00", "2026-11-06T23:59:59.999+01:00"],
      });
    cy.location("search").should("contain", "date=2026-11-03");
    cy.get('[data-testid="cal-prev"]').click();
    cy.get('[data-testid="cal-prev"]').click();
    // A week before the DST change: Belgrade was on +02:00.
    cy.wait("@before");
    cy.get('[data-testid="calendar"]')
      .should("have.attr", "data-from", "2026-10-19T00:00:00.000+02:00")
      .and("have.attr", "data-to", "2026-10-23T23:59:59.999+02:00");
    cy.get('[data-testid="cal-today"]').click();
    cy.location("search").should("match", /date=\d{4}-\d{2}-\d{2}/);
  });

  it("month shows chips and +N more", () => {
    visitCalendar("/udc/appointments?date=2026-10-27&preset=month");
    cy.get('[data-testid="cal-month-cell"]').should("have.length", 35);
    cy.get('[data-testid="cal-month-cell"][data-day="2026-10-27"]').then(($cell) => {
      const count = Number($cell.attr("data-count"));
      expect(count).to.be.greaterThan(4);
      cy.wrap($cell).find('[data-testid="cal-chip"]').should("have.length", 4);
      cy.wrap($cell)
        .find('[data-testid="cal-more"]')
        .should("have.text", `+${count - 4} more`)
        .click();
      cy.get('[data-testid="cal-more-popover"] [data-testid="cal-chip"]').should(
        "have.length",
        count,
      );
    });
    // A day number opens that day.
    cy.get("body").type("{esc}");
    cy.get(
      '[data-testid="cal-month-cell"][data-day="2026-10-28"] [data-testid="cal-month-day"]',
    ).click();
    cy.get('[data-testid="calendar"]').should("have.attr", "data-preset", "day");
    cy.location("search").should("contain", "date=2026-10-28");
  });

  it("drags an event one hour down, and the move persists", () => {
    demoRow().then((row) => {
      const id = row.__meta.id;
      cy.intercept("POST", "/udc/mutate").as("mutate");
      visitCalendar();
      eventEl(id).should("have.attr", "data-start", DEMO_START);
      dragBy(eventEl(id), HOUR_PX);
      eventEl(id).should("have.attr", "data-start", "2026-10-27T09:00:00+01:00");
      cy.wait("@mutate").its("request.body.row").should("deep.eq", {
        start: "2026-10-27T09:00:00+01:00",
        end: "2026-10-27T09:30:00+01:00",
      });
      cy.udc("read", { collection: "appointments", id }).its("row").should("include", {
        start: "2026-10-27T09:00:00+01:00",
        end: "2026-10-27T09:30:00+01:00",
      });
      cy.reload();
      eventEl(id).should("have.attr", "data-start", "2026-10-27T09:00:00+01:00");
    });
  });

  it("resizing the bottom edge changes the end", () => {
    demoRow().then((row) => {
      const id = row.__meta.id;
      cy.intercept("POST", "/udc/mutate").as("mutate");
      visitCalendar();
      dragBy(eventEl(id).find('[data-testid="cal-resize-end"]'), HOUR_PX / 2, 0, true);
      cy.wait("@mutate");
      cy.udc("read", { collection: "appointments", id })
        .its("row")
        .should("include", { start: DEMO_START, end: "2026-10-27T09:00:00+01:00" });
    });
  });

  it("a conflicting edit wins: toast, and the event snaps to the server's value", () => {
    demoRow().then((row) => {
      const id = row.__meta.id;
      visitCalendar();
      eventEl(id).should("have.attr", "data-start", DEMO_START);
      // Someone else moves it to 10:00 while this screen still has version 1.
      cy.udc("mutate", {
        collection: "appointments",
        op: "update",
        id,
        row: { start: "2026-10-27T10:00:00+01:00", end: "2026-10-27T10:30:00+01:00" },
        expected_version: row.__meta.version,
      });
      dragBy(eventEl(id), HOUR_PX);
      cy.contains("Someone else changed this event").should("be.visible");
      eventEl(id).should("have.attr", "data-start", "2026-10-27T10:00:00+01:00");
      cy.udc("read", { collection: "appointments", id })
        .its("row.start")
        .should("eq", "2026-10-27T10:00:00+01:00");
    });
  });

  it("the detail popover edits the room", () => {
    demoRow().then((row) => {
      const id = row.__meta.id;
      const room = row.room === "C1" ? "B2" : "C1";
      visitCalendar();
      clickEvent(id);
      cy.get('[data-testid="cal-detail-doctor"]').should("contain.text", row.doctor as string);
      cy.get('[data-testid="cal-detail-edit-room"]').click();
      cy.get('[data-testid="cal-detail"] [data-testid="cell-editor"] select').select(room);
      cy.get('[data-testid="cal-detail"] [data-testid="cell-editor"] select').type("{enter}");
      cy.get('[data-testid="cal-detail-room"]').should("contain.text", room);
      cy.get('[data-testid="cal-detail-room"] [data-testid="cell-editor"]').should("not.exist");
      cy.udc("read", { collection: "appointments", id }).its("row.room").should("eq", room);
    });
  });

  it("delete removes the event", () => {
    demoRow().then((row) => {
      const id = row.__meta.id;
      visitCalendar();
      clickEvent(id);
      cy.get('[data-testid="cal-delete"]').click();
      cy.get('[data-testid="cal-delete-confirm"]').click();
      eventEl(id).should("not.exist");
      inWindow(WEEK).then((rows) => {
        expect(rows.map((r) => r.__meta.id)).not.to.include(id);
      });
    });
  });

  it("the doctor chip leaves one colour on the grid", () => {
    visitCalendar();
    cy.get('[data-testid="cal-event"]').then(($all) => {
      const colours = new Set([...$all].map((e) => e.getAttribute("data-color")));
      expect(colours.size).to.be.greaterThan(1);
    });
    cy.get('[data-testid="chip-doctor"]').click();
    cy.get('[data-testid="chip-option-Ana Vuković"]').click();
    cy.get("body").type("{esc}");
    inWindow(WEEK, { field: "doctor", op: "in", value: ["Ana Vuković"] }).then((rows) => {
      cy.get('[data-testid="cal-event"]').should("have.length", rows.length);
      cy.get('[data-testid="cal-event"]').each(($e) => {
        expect($e.attr("data-color")).to.eq("#2563eb");
      });
    });
  });

  it("the header zone switch moves every time, the window and the table, and survives a reload", () => {
    demoRow().then((row) => {
      const id = row.__meta.id;
      aliasWindow("newYork", "2026-10-26T00:00:00.000-04:00");
      visitCalendar();
      eventEl(id).find('[data-testid="cal-event-time"]').should("contain.text", "8:00");

      cy.get('[data-testid="tz-trigger"]').click();
      cy.get('[data-testid="tz-option"]').first().should("contain.text", "Browser");
      cy.get('[data-testid="tz-search"]').type("new york");
      cy.get(`[data-testid="tz-option"][data-tz="${NY}"]`).should("contain.text", "UTC−4").click();

      // 2026-10-27: New York is still on summer time (-04:00), Belgrade already on +01:00.
      cy.get('[data-testid="tz-trigger"]').should("have.attr", "data-tz", NY);
      eventEl(id)
        .should("have.attr", "data-start", "2026-10-27T03:00:00-04:00")
        .find('[data-testid="cal-event-time"]')
        .should("contain.text", "3:00 AM");
      cy.wait("@newYork")
        .then(listBody)
        .should("deep.eq", {
          field: "start",
          op: "between",
          value: ["2026-10-26T00:00:00.000-04:00", "2026-10-30T23:59:59.999-04:00"],
        });

      cy.get('[data-testid="tab-table"]').click();
      cy.get('[data-testid="search-input"]').type(row.patient as string);
      cy.get(`[data-testid="row"][data-row-id="${id}"]`, { timeout: 10_000 })
        .should("contain.text", "Oct 27, 2026, 3:00 AM")
        .and("not.contain.text", "8:00 AM");

      cy.reload();
      cy.get('[data-testid="tz-trigger"]').should("have.attr", "data-tz", NY);
    });
  });
});

describe("tickets calendar", () => {
  beforeEach(() => cy.reseed());

  it("shows the board's scheduled tickets coloured by priority and keeps ?board=", () => {
    const colours: Record<string, string> = {
      low: "#64748b",
      normal: "#2563eb",
      high: "#d97706",
      urgent: "#dc2626",
    };
    const week: [string, string] = [
      "2026-10-26T00:00:00.000+01:00",
      "2026-11-01T23:59:59.999+01:00",
    ];
    cy.udc("list", { collection: "boards", sort: [{ field: "order" }] }).then(
      ({ rows: boards }) => {
        const second = boards[1] as Row;
        cy.udc("list", {
          collection: "tickets",
          filter: {
            and: [
              { field: "board_id", op: "eq", value: second.__meta.id },
              { field: "starts_at", op: "between", value: week },
            ],
          },
          page: { limit: 200 },
        }).then(({ rows }) => {
          expect(rows.length).to.be.greaterThan(0);
          visitCalendar(`/udc/tickets?tab=calendar&date=2026-10-27&board=${second.__meta.id}`);
          cy.get('[data-testid="board-switcher"]').should("contain.text", second.name as string);
          cy.get('[data-testid="calendar"]').should("have.attr", "data-preset", "week");
          cy.get('[data-testid="cal-event"]').should("have.length", rows.length);
          for (const t of rows) {
            eventEl(t.__meta.id).should(
              "have.attr",
              "data-color",
              colours[t.priority as string] ?? "",
            );
          }
          // Back to the board tab: the same board.
          cy.get('[data-testid="tab-kanban"]').click();
          cy.get('[data-testid="kanban"]').should("have.attr", "data-board-id", second.__meta.id);
        });
      },
    );
  });
});
