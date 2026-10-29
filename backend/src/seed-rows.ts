import { readFileSync } from "node:fs";
import type { CollectionAsset } from "@jsudc/server";
import { belgradeIso, generateAppointments, parseDay } from "../scripts/generate-appointments.js";
import { KANBAN_TODAY, mondayOf } from "../scripts/generate-kanban.js";
import { generateMetrics, noonOf } from "../scripts/generate-metrics.js";

const DAY = 86_400_000;
const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/**
 * A Belgrade wall time moved by whole weeks, the offset recomputed for the
 * new date (a slot written in summer time stays at 10:00 in winter).
 */
export function shiftBelgradeWeeks(iso: string, weeks: number): string {
  const m = WALL.exec(iso);
  if (!m || weeks === 0) return iso;
  const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + weeks * 7 * DAY;
  return belgradeIso(day, Number(m[4]) * 60 + Number(m[5]));
}

/** Whole weeks from the week of `from` to the week of `to` (both `YYYY-MM-DD`). */
export function weeksBetween(from: string, to: string): number {
  return Math.round((mondayOf(parseDay(to)) - mondayOf(parseDay(from))) / (7 * DAY));
}

/**
 * The rows `npm run seed` writes for one collection, on the day `today`:
 * `appointments` are generated around it; `metrics` are the 30 days ending at
 * `metricsEnd` (noon of `today` in Belgrade unless given); the tickets'
 * calendar slots are moved from the week they were committed for to its week;
 * everything else is `seed.json` as committed.
 */
export function seedRowsFor(
  asset: CollectionAsset,
  today: string,
  opts: { metricsEnd?: number } = {},
): Record<string, unknown>[] {
  if (asset.name === "appointments") return generateAppointments({ today });
  if (asset.name === "metrics") return generateMetrics({ end: opts.metricsEnd ?? noonOf(today) });
  const rows: Record<string, unknown>[] = asset.seedFile
    ? JSON.parse(readFileSync(asset.seedFile, "utf8"))
    : [];
  if (asset.name !== "tickets") return rows;
  const weeks = weeksBetween(KANBAN_TODAY, today);
  return rows.map((row) => {
    const out = { ...row };
    for (const f of ["starts_at", "ends_at"]) {
      if (typeof out[f] === "string") out[f] = shiftBelgradeWeeks(out[f] as string, weeks);
    }
    return out;
  });
}
