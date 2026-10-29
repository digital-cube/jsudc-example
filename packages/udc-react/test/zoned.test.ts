import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  dayOf,
  isoInZone,
  offsetLabel,
  offsetMinutes,
  parseDayKey,
  startOfDay,
  zonedParts,
  zonedToInstant,
} from "../src/time/zoned";

const BG = "Europe/Belgrade";
const NY = "America/New_York";
const TOKYO = "Asia/Tokyo";
const at = (iso: string) => Date.parse(iso);

describe("zonedParts / offsetMinutes", () => {
  it("reads an instant on several clocks", () => {
    const t = at("2026-10-27T08:00:00+01:00");
    expect(zonedParts(t, BG)).toMatchObject({ y: 2026, m: 10, d: 27, hh: 8, mm: 0, weekday: 2 });
    expect(zonedParts(t, NY)).toMatchObject({ d: 27, hh: 3 });
    expect(zonedParts(t, TOKYO)).toMatchObject({ d: 27, hh: 16 });
    expect(zonedParts(t, "UTC")).toMatchObject({ d: 27, hh: 7 });
  });

  it("knows the offsets on both sides of the European changes", () => {
    expect(offsetMinutes(at("2026-03-29T00:59:59Z"), BG)).toBe(60);
    expect(offsetMinutes(at("2026-03-29T01:00:00Z"), BG)).toBe(120);
    expect(offsetMinutes(at("2026-10-25T00:59:59Z"), BG)).toBe(120);
    expect(offsetMinutes(at("2026-10-25T01:00:00Z"), BG)).toBe(60);
    // New York changes a week later in autumn: 2026-11-01.
    expect(offsetMinutes(at("2026-10-27T12:00:00Z"), NY)).toBe(-240);
    expect(offsetMinutes(at("2026-11-02T12:00:00Z"), NY)).toBe(-300);
    expect(offsetMinutes(at("2026-07-01T12:00:00Z"), TOKYO)).toBe(540);
    expect(offsetMinutes(at("2026-01-01T12:00:00Z"), TOKYO)).toBe(540);
  });
});

describe("zonedToInstant", () => {
  it("round-trips an ordinary wall time", () => {
    const t = zonedToInstant({ y: 2026, m: 10, d: 27, hh: 8, mm: 0 }, BG);
    expect(new Date(t).toISOString()).toBe("2026-10-27T07:00:00.000Z");
    expect(zonedToInstant({ y: 2026, m: 7, d: 1, hh: 8, mm: 0 }, BG)).toBe(
      at("2026-07-01T06:00:00Z"),
    );
  });

  it("spring forward (2026-03-29): the day starts at +01:00, 03:00 is +02:00, 02:30 is past the gap", () => {
    expect(startOfDay({ y: 2026, m: 3, d: 29 }, BG)).toBe(at("2026-03-28T23:00:00Z"));
    expect(zonedToInstant({ y: 2026, m: 3, d: 29, hh: 3, mm: 0 }, BG)).toBe(
      at("2026-03-29T01:00:00Z"),
    );
    // 02:30 does not exist: it lands an hour on, at 03:30.
    const gap = zonedToInstant({ y: 2026, m: 3, d: 29, hh: 2, mm: 30 }, BG);
    expect(zonedParts(gap, BG)).toMatchObject({ hh: 3, mm: 30 });
    // That day is 23 hours long.
    expect(
      startOfDay({ y: 2026, m: 3, d: 30 }, BG) - startOfDay({ y: 2026, m: 3, d: 29 }, BG),
    ).toBe(23 * 3_600_000);
  });

  it("fall back (2026-10-25): 02:30 happens twice, the first is taken; the day is 25 hours", () => {
    expect(zonedToInstant({ y: 2026, m: 10, d: 25, hh: 2, mm: 30 }, BG)).toBe(
      at("2026-10-25T00:30:00Z"),
    );
    expect(zonedToInstant({ y: 2026, m: 10, d: 25, hh: 5, mm: 0 }, BG)).toBe(
      at("2026-10-25T04:00:00Z"),
    );
    expect(
      startOfDay({ y: 2026, m: 10, d: 26 }, BG) - startOfDay({ y: 2026, m: 10, d: 25 }, BG),
    ).toBe(25 * 3_600_000);
  });

  it("a zone without DST is a fixed shift all year", () => {
    for (const m of [1, 3, 7, 10, 12]) {
      const t = zonedToInstant({ y: 2026, m, d: 15, hh: 9, mm: 0 }, TOKYO);
      expect(new Date(t).getUTCHours()).toBe(0);
    }
  });
});

describe("isoInZone", () => {
  it("writes the zone's own offset", () => {
    const t = at("2026-10-27T07:00:00Z");
    expect(isoInZone(t, BG)).toBe("2026-10-27T08:00:00+01:00");
    expect(isoInZone(t, NY)).toBe("2026-10-27T03:00:00-04:00");
    expect(isoInZone(t, TOKYO)).toBe("2026-10-27T16:00:00+09:00");
    expect(isoInZone(t, "UTC")).toBe("2026-10-27T07:00:00+00:00");
    expect(isoInZone(at("2026-07-01T06:00:00Z"), BG)).toBe("2026-07-01T08:00:00+02:00");
    expect(isoInZone(at("2026-10-27T22:59:59.999Z"), BG, true)).toBe(
      "2026-10-27T23:59:59.999+01:00",
    );
    expect(isoInZone(at("2026-10-27T07:00:00Z"), "Asia/Kolkata")).toBe("2026-10-27T12:30:00+05:30");
  });

  it("reads back to the same instant", () => {
    for (const zone of [BG, NY, TOKYO, "UTC", "Australia/Sydney"]) {
      const t = at("2026-03-29T01:30:00Z");
      expect(Date.parse(isoInZone(t, zone))).toBe(t);
    }
  });
});

describe("civil days", () => {
  it("adds days and months across year and month ends", () => {
    expect(addDays({ y: 2026, m: 12, d: 30 }, 3)).toEqual({ y: 2027, m: 1, d: 2 });
    expect(addDays({ y: 2026, m: 3, d: 1 }, -1)).toEqual({ y: 2026, m: 2, d: 28 });
    expect(addMonths({ y: 2026, m: 1, d: 31 }, 1)).toEqual({ y: 2026, m: 2, d: 28 });
    expect(addMonths({ y: 2026, m: 11, d: 15 }, -12)).toEqual({ y: 2025, m: 11, d: 15 });
  });

  it("parses only real days", () => {
    expect(parseDayKey("2026-10-27")).toEqual({ y: 2026, m: 10, d: 27 });
    expect(parseDayKey("2026-02-30")).toBeNull();
    expect(parseDayKey("27.10.2026")).toBeNull();
    expect(parseDayKey(null)).toBeNull();
  });

  it("the day of an instant depends on the zone", () => {
    const t = at("2026-10-27T23:30:00Z");
    expect(dayOf(t, BG)).toEqual({ y: 2026, m: 10, d: 28 });
    expect(dayOf(t, NY)).toEqual({ y: 2026, m: 10, d: 27 });
  });

  it("labels offsets", () => {
    expect(offsetLabel(60)).toBe("UTC+1");
    expect(offsetLabel(-240)).toBe("UTC−4");
    expect(offsetLabel(330)).toBe("UTC+5:30");
    expect(offsetLabel(0)).toBe("UTC");
  });
});
