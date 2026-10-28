import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SchemaDocSchema, validateRow } from "@jsudc/udc-core";
import { describe, expect, it } from "vitest";
import {
  belgradeIso,
  DOCTORS,
  generateAppointments,
  seedToday,
} from "../scripts/generate-appointments.js";
import { CITY_COORDS, generateCompanies } from "../scripts/generate-companies.js";
import { generateKanban } from "../scripts/generate-kanban.js";
import { COLLECTIONS_DIR } from "../src/config.js";
import { readCollectionAssets } from "../src/registry.js";
import { seedRowsFor, shiftBelgradeWeeks, weeksBetween } from "../src/seed-rows.js";
import { companiesSeed } from "./helpers.js";

describe("generate-companies", () => {
  it("reproduces the committed seed.json from its default seed", () => {
    expect(generateCompanies(200, 20261018)).toEqual(companiesSeed);
  });

  /** Great-circle distance in km. */
  const km = (a: readonly [number, number], b: readonly [number, number]) => {
    const rad = (d: number) => (d * Math.PI) / 180;
    const h =
      Math.sin(rad(b[0] - a[0]) / 2) ** 2 +
      Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  };

  it("puts every company within 10 km of its city, and not all on the centre", () => {
    expect(companiesSeed).toHaveLength(200);
    const distances = companiesSeed.map((row) => {
      const city = CITY_COORDS[row.city as string];
      expect(city, `${row.city}`).toBeDefined();
      return km([row.lat as number, row.lng as number], city as readonly [number, number]);
    });
    expect(Math.max(...distances)).toBeLessThan(10);
    expect(distances.filter((d) => d > 0.5).length).toBeGreaterThan(150);
  });

  it("knows a coordinate for every city chip of the view", () => {
    const [companies] = readCollectionAssets(COLLECTIONS_DIR).filter((a) => a.name === "companies");
    const chip = companies?.view.filters?.find((f) => f.field === "city");
    expect(Object.keys(CITY_COORDS).sort()).toEqual(
      [...((chip?.options ?? []) as string[])].sort(),
    );
  });
});

describe("generate-kanban", () => {
  const seed = generateKanban(20261027);

  it("reproduces the committed seed files from its default seed", () => {
    for (const name of ["boards", "buckets", "tickets"] as const) {
      const file = JSON.parse(readFileSync(join(COLLECTIONS_DIR, name, "seed.json"), "utf8"));
      expect(seed[name]).toEqual(file);
    }
  });

  it("yields 3 boards, 15 buckets and ~60 tickets", () => {
    expect(seed.boards).toHaveLength(3);
    expect(seed.buckets).toHaveLength(15);
    expect(seed.tickets.length).toBeGreaterThanOrEqual(55);
    expect(seed.tickets.length).toBeLessThanOrEqual(65);
  });

  it("has unique ids and keys and only valid relations", () => {
    const all = [...seed.boards, ...seed.buckets, ...seed.tickets].map((r) => r.__meta.id);
    expect(new Set(all).size).toBe(all.length);
    const keys = seed.tickets.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);

    const boards = new Set(seed.boards.map((b) => b.__meta.id));
    const bucketBoard = new Map(seed.buckets.map((b) => [b.__meta.id, b.board_id]));
    for (const bucket of seed.buckets) expect(boards.has(bucket.board_id as string)).toBe(true);
    for (const t of seed.tickets) {
      expect(bucketBoard.get(t.bucket_id as string), `${t.key}`).toBe(t.board_id);
    }
    for (const id of boards) {
      expect(seed.buckets.filter((b) => b.board_id === id)).toHaveLength(5);
    }
  });

  it("orders are sparse and unique within a bucket", () => {
    const byBucket = new Map<string, typeof seed.tickets>();
    for (const t of seed.tickets) {
      const bucket = t.bucket_id as string;
      byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), t]);
    }
    for (const tickets of byBucket.values()) {
      expect(tickets.map((t) => t.order)).toEqual(tickets.map((_, i) => (i + 1) * 100));
    }
  });

  it("every row is valid against its schema", () => {
    for (const name of ["boards", "buckets", "tickets"] as const) {
      const schema = SchemaDocSchema.parse(
        JSON.parse(readFileSync(join(COLLECTIONS_DIR, name, "schema.json"), "utf8")),
      );
      for (const row of seed[name])
        expect(validateRow(schema, row, { mode: "insert" })).toEqual([]);
    }
  });

  it("schedules ~40% of the tickets on weekdays of the current and next week, 09-17 Belgrade", () => {
    const scheduled = seed.tickets.filter((t) => t.starts_at !== undefined);
    expect(scheduled.length / seed.tickets.length).toBeGreaterThan(0.3);
    expect(scheduled.length / seed.tickets.length).toBeLessThan(0.5);
    const from = Date.parse("2026-10-26T00:00:00+01:00");
    const to = Date.parse("2026-11-09T00:00:00+01:00");
    for (const t of scheduled) {
      const start = t.starts_at as string;
      const end = t.ends_at as string;
      expect(start).toMatch(/\+0[12]:00$/);
      expect(Date.parse(start)).toBeGreaterThanOrEqual(from);
      expect(Date.parse(end)).toBeLessThan(to);
      expect(Date.parse(end)).toBeGreaterThan(Date.parse(start));
      const [h] = belgradeClock(start);
      expect(h).toBeGreaterThanOrEqual(9);
      expect(belgradeClock(end)[0] * 60 + belgradeClock(end)[1]).toBeLessThanOrEqual(17 * 60);
      expect(["Sat", "Sun"]).not.toContain(belgradeWeekday(start));
    }
  });
});

const belgrade = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Belgrade", hourCycle: "h23", ...opts });
/** `[hour, minute]` of an instant on a Belgrade clock. */
const belgradeClock = (iso: string): [number, number] => {
  const [h, m] = belgrade({ hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).split(":");
  return [Number(h), Number(m)];
};
const belgradeWeekday = (iso: string) => belgrade({ weekday: "short" }).format(new Date(iso));
const belgradeDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade" }).format(new Date(iso));

describe("generate-appointments", () => {
  const rows = generateAppointments({ today: "2026-10-27" });
  const schema = SchemaDocSchema.parse(
    JSON.parse(readFileSync(join(COLLECTIONS_DIR, "appointments", "schema.json"), "utf8")),
  );

  it("yields ~600 valid rows with unique ids", () => {
    expect(rows.length).toBeGreaterThan(500);
    expect(rows.length).toBeLessThan(700);
    for (const row of rows) expect(validateRow(schema, row, { mode: "insert" })).toEqual([]);
    expect(new Set(rows.map((r) => r.__meta.id)).size).toBe(rows.length);
    expect(schema.fields.doctor?.values).toEqual([...DOCTORS]);
  });

  it("is deterministic for one day and differs for another", () => {
    expect(generateAppointments({ today: "2026-10-27" })).toEqual(rows);
    expect(generateAppointments({ today: "2026-10-28" })).not.toEqual(rows);
  });

  it("spans six weeks before to six weeks after today, weekdays only", () => {
    const days = rows.map((r) => belgradeDay(r.start)).sort();
    expect((days[0] ?? "") >= "2026-09-15").toBe(true);
    expect((days.at(-1) ?? "") <= "2026-12-08").toBe(true);
    expect(days.some((d) => d < "2026-10-01")).toBe(true);
    expect(days.some((d) => d > "2026-11-25")).toBe(true);
    for (const r of rows) expect(["Sat", "Sun"]).not.toContain(belgradeWeekday(r.start));
  });

  it("keeps every appointment inside 08:00-20:00 Belgrade, on 30-minute slots", () => {
    for (const r of rows) {
      const [sh, sm] = belgradeClock(r.start);
      const [eh, em] = belgradeClock(r.end);
      expect(sh * 60 + sm, r.start).toBeGreaterThanOrEqual(8 * 60);
      expect(eh * 60 + em, r.end).toBeLessThanOrEqual(20 * 60);
      expect(sm % 30).toBe(0);
      expect(em % 30).toBe(0);
      expect(belgradeDay(r.end)).toBe(belgradeDay(r.start));
      expect(Date.parse(r.end) - Date.parse(r.start)).toBeGreaterThanOrEqual(30 * 60_000);
    }
  });

  it("never books one doctor twice at once", () => {
    for (const doctor of DOCTORS) {
      const mine = rows
        .filter((r) => r.doctor === doctor)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      mine.slice(1).forEach((next, i) => {
        const prev = mine[i] as (typeof mine)[number];
        expect(Date.parse(next.start), `${doctor} ${next.start}`).toBeGreaterThanOrEqual(
          Date.parse(prev.end),
        );
      });
    }
  });

  it("writes Belgrade's offset as the date dictates (+02:00 in summer, +01:00 in winter)", () => {
    for (const r of rows) {
      const summer = r.start < "2026-10-25";
      expect(r.start).toMatch(summer ? /\+02:00$/ : /\+01:00$/);
      expect(r.end.slice(-6)).toBe(r.start.slice(-6));
    }
    expect(belgradeIso(Date.UTC(2026, 9, 23), 8 * 60)).toBe("2026-10-23T08:00:00+02:00");
    expect(belgradeIso(Date.UTC(2026, 9, 26), 8 * 60)).toBe("2026-10-26T08:00:00+01:00");
    expect(belgradeIso(Date.UTC(2026, 2, 30), 8 * 60)).toBe("2026-03-30T08:00:00+02:00");
  });

  it("has the 08:00 demo appointment on the seed day", () => {
    expect(rows.filter((r) => r.start === "2026-10-27T08:00:00+01:00")).toHaveLength(1);
  });

  it("marks the past done or cancelled and the future scheduled or cancelled", () => {
    for (const r of rows) {
      const past = belgradeDay(r.start) < "2026-10-27";
      expect(past ? ["done", "cancelled"] : ["scheduled", "cancelled"]).toContain(r.status);
    }
  });

  it("reads the seed day from SEED_TODAY", () => {
    expect(seedToday({ SEED_TODAY: "2026-10-27" })).toBe("2026-10-27");
    expect(seedToday({})).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(() => seedToday({ SEED_TODAY: "27.10.2026" })).toThrow(/YYYY-MM-DD/);
  });
});

describe("seed rows", () => {
  const assets = readCollectionAssets(COLLECTIONS_DIR);
  const asset = (name: string) => {
    const found = assets.find((a) => a.name === name);
    if (!found) throw new Error(name);
    return found;
  };

  it("generates the appointments for the seed day", () => {
    expect(seedRowsFor(asset("appointments"), "2026-10-27")).toEqual(
      generateAppointments({ today: "2026-10-27" }),
    );
  });

  it("serves the committed tickets unchanged in their own week", () => {
    expect(seedRowsFor(asset("tickets"), "2026-10-29")).toEqual(generateKanban(20261027).tickets);
  });

  it("moves the tickets' slots by whole weeks, keeping the Belgrade wall time", () => {
    const base = generateKanban(20261027).tickets;
    const moved = seedRowsFor(asset("tickets"), "2027-01-13");
    expect(weeksBetween("2026-10-27", "2027-01-13")).toBe(11);
    base.forEach((t, i) => {
      const m = moved[i] as Record<string, unknown>;
      expect(m.title).toBe(t.title);
      expect(m.due).toBe(t.due);
      if (typeof t.starts_at !== "string") {
        expect(m.starts_at).toBeUndefined();
        return;
      }
      expect(belgradeClock(m.starts_at as string)).toEqual(belgradeClock(t.starts_at));
      expect(belgradeWeekday(m.starts_at as string)).toBe(belgradeWeekday(t.starts_at));
      expect(m.starts_at).toMatch(/\+01:00$/);
    });
    expect(shiftBelgradeWeeks("2026-10-19T10:00:00+02:00", 1)).toBe("2026-10-26T10:00:00+01:00");
  });
});
