/**
 * The `metrics` rows: three servers (two web nodes and a database) sampled
 * every 15 minutes for the 30 days ending at seed time, ~8,600 rows. A daily
 * cycle in Belgrade hours (quiet at 04:00, busiest around 16:00), quieter
 * weekends, and three incidents at fixed instants before the end (a CPU spike
 * on web-1 three hours before, an error burst on web-2 the day before, a slow
 * database five days before) so every window has something to show.
 * There is no committed seed.json: `npm run seed` calls this with the instant
 * it runs (`SEED_TODAY=YYYY-MM-DD` pins the end to noon of that day in
 * Belgrade, as the e2e seed does). Deterministic for one end and seed.
 *
 *   npm run generate:metrics -w @jsudc/backend -- [--end 2026-10-27T11:00:00Z] [--seed 20261027] [--json]
 */
import { parseArgs } from "node:util";
import { belgradeIso, CLINIC_ZONE, parseDay, zoneOffsetMinutes } from "./generate-appointments.js";

export const HOSTS = ["web-1", "web-2", "db-1"] as const;
export type Host = (typeof HOSTS)[number];

export const STEP_MS = 15 * 60_000;
export const DAYS = 30;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Samples per host: 30 days of quarter hours, the end included. */
export const SAMPLES = (DAYS * DAY) / STEP_MS;

/** The zone the servers' traffic follows (the users are in Belgrade). */
export const METRICS_ZONE = CLINIC_ZONE;

export interface MetricsRow extends Record<string, unknown> {
  __meta: { id: string };
  ts: string;
  host: Host;
  cpu: number;
  mem: number;
  load: number;
  req_per_s: number;
  errors: number;
}

/** The ranges every value stays inside (the schema's `min` / `max`, and what a test checks). */
export const RANGES = {
  cpu: [0, 100],
  mem: [0, 100],
  load: [0, 16],
  req_per_s: [0, 5000],
  errors: [0, 500],
} as const;

export type IncidentKind = "cpu_spike" | "error_burst" | "slow_db";

export interface Incident {
  kind: IncidentKind;
  host: Host;
  /** First and last sample instant (ms) inside the incident. */
  from: number;
  to: number;
}

/** The incidents of a series that ends at `end`: fixed offsets before the end. */
export function incidentsFor(end: number): Incident[] {
  const at = (hoursBefore: number, minutes: number, kind: IncidentKind, host: Host): Incident => {
    const from = end - hoursBefore * HOUR;
    return { kind, host, from, to: from + minutes * 60_000 - STEP_MS };
  };
  return [
    at(3, 45, "cpu_spike", "web-1"),
    at(30, 60, "error_burst", "web-2"),
    at(5 * 24 + 2, 120, "slow_db", "db-1"),
  ];
}

/** Each host's shape: an idle floor, how much the daily peak adds, cores, and its traffic. */
const PROFILE: Record<
  Host,
  { cpu: number; cpuPeak: number; mem: number; cores: number; req: number; reqPeak: number }
> = {
  "web-1": { cpu: 12, cpuPeak: 52, mem: 46, cores: 4, req: 60, reqPeak: 640 },
  "web-2": { cpu: 10, cpuPeak: 44, mem: 41, cores: 4, req: 50, reqPeak: 520 },
  // The database: a heavy, flat memory footprint (the axis case of a series that never leaves ~70 %).
  "db-1": { cpu: 18, cpuPeak: 30, mem: 71, cores: 8, req: 300, reqPeak: 1900 },
};

/** mulberry32, as the other generators. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;

function uuid(rand: Rand): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16));
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16] as string, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
const round = (v: number, decimals: number) => Number(v.toFixed(decimals));

/** `now` floored to its quarter hour: the last sample of a series seeded now. */
export function floorToStep(now: number): number {
  return Math.floor(now / STEP_MS) * STEP_MS;
}

/**
 * Where the series ends: noon in Belgrade of `SEED_TODAY` when it is set (the
 * e2e run pins it, and freezes the browser's clock at the same instant), else
 * the quarter hour the seed runs in.
 */
export function metricsEnd(env: NodeJS.ProcessEnv = process.env, now = Date.now()): number {
  const pinned = env.SEED_TODAY?.trim();
  return pinned ? noonOf(pinned) : floorToStep(now);
}

/** Noon of a `YYYY-MM-DD` day in Belgrade, as an instant. */
export function noonOf(day: string): number {
  return Date.parse(belgradeIso(parseDay(day), 12 * 60));
}

/** Every sample of every host for the 30 days ending at `end` (floored to a quarter hour). */
export function generateMetrics(opts: { end: number; seed?: number }): MetricsRow[] {
  const end = floorToStep(opts.end);
  const rand = prng(opts.seed ?? 20261027);
  const noise = (amp: number) => (rand() * 2 - 1) * amp;
  const incidents = incidentsFor(end);
  const during = (host: Host, t: number) =>
    incidents.find((i) => i.host === host && t >= i.from && t <= i.to)?.kind;
  const rows: MetricsRow[] = [];
  const first = end - (SAMPLES - 1) * STEP_MS;

  for (let t = first; t <= end; t += STEP_MS) {
    const local = t + zoneOffsetMinutes(t, METRICS_ZONE) * 60_000;
    const hour = (local % DAY) / HOUR;
    const weekday = new Date(local).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    // 0 at 04:00, 1 at 16:00 local; a weekend is a little over half as busy.
    const cycle = ((1 - Math.cos((2 * Math.PI * (hour - 4)) / 24)) / 2) * (weekend ? 0.55 : 1);
    // Memory creeps up through the day and drops at the 03:00 restart of the web nodes.
    const sinceRestart = (((hour - 3) % 24) + 24) % 24;

    for (const host of HOSTS) {
      const p = PROFILE[host];
      let cpu = p.cpu + p.cpuPeak * cycle + noise(3);
      let mem =
        host === "db-1" ? p.mem + 3 * cycle + noise(0.6) : p.mem + sinceRestart * 0.9 + noise(1.2);
      let req = p.req + p.reqPeak * cycle + noise(p.reqPeak * 0.05);
      let errors = rand() < 0.35 ? Math.floor(rand() * 3) : 0;
      switch (during(host, t)) {
        case "cpu_spike":
          cpu = 94 + rand() * 5;
          break;
        case "error_burst":
          errors = 60 + Math.floor(rand() * 60);
          req *= 0.6;
          break;
        case "slow_db":
          cpu = 88 + rand() * 8;
          mem += 12;
          break;
        default:
          break;
      }
      cpu = clamp(cpu, RANGES.cpu);
      mem = clamp(mem, RANGES.mem);
      const load = clamp((cpu / 100) * p.cores * 0.9 + noise(0.15), RANGES.load);
      rows.push({
        __meta: { id: uuid(rand) },
        ts: new Date(t).toISOString(),
        host,
        cpu: round(cpu, 1),
        mem: round(mem, 1),
        load: round(load, 2),
        req_per_s: Math.round(clamp(req, RANGES.req_per_s)),
        errors: clamp(errors, RANGES.errors),
      });
    }
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      end: { type: "string" },
      seed: { type: "string", default: "20261027" },
      json: { type: "boolean", default: false },
    },
  });
  const end = values.end ? Date.parse(values.end) : metricsEnd();
  if (Number.isNaN(end)) throw new Error(`--end is not an instant: ${values.end}`);
  const rows = generateMetrics({ end, seed: Number(values.seed) });
  if (values.json) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log(`${rows.length} samples (${rows[0]?.ts} … ${rows.at(-1)?.ts})`);
    for (const i of incidentsFor(floorToStep(end))) {
      console.log(
        `  ${i.kind} on ${i.host}: ${new Date(i.from).toISOString()} … ${new Date(i.to).toISOString()}`,
      );
    }
  }
}
