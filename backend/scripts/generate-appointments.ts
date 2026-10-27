/**
 * The `appointments` rows: 8 doctors with shifts, 30-minute slots between
 * 08:00 and 20:00 Europe/Belgrade on weekdays, never two at once for one
 * doctor, ~600 rows from 6 weeks before to 6 weeks after `today`. There is no
 * committed seed.json: `npm run seed` calls this with the day it runs
 * (`SEED_TODAY=YYYY-MM-DD` pins it; the e2e seed uses 2026-10-27), so the
 * calendar always opens on a busy week. Deterministic for one `today` and seed.
 *
 *   npm run generate:appointments -w @jsudc/backend -- [--today 2026-10-27] [--seed 20261027] [--json]
 */
import { parseArgs } from "node:util";

export const CLINIC_ZONE = "Europe/Belgrade";

export const DOCTORS = [
  "Ana Vuković",
  "Bojan Simić",
  "Dragana Popović",
  "Igor Tomić",
  "Katarina Ristić",
  "Milan Obradović",
  "Nina Savić",
  "Uroš Lazić",
] as const;

/** One colour per doctor, as the view's `color_map`. */
export const DOCTOR_COLORS: Record<(typeof DOCTORS)[number], string> = {
  "Ana Vuković": "#2563eb",
  "Bojan Simić": "#16a34a",
  "Dragana Popović": "#db2777",
  "Igor Tomić": "#d97706",
  "Katarina Ristić": "#7c3aed",
  "Milan Obradović": "#0891b2",
  "Nina Savić": "#dc2626",
  "Uroš Lazić": "#4d7c0f",
};

export const ROOMS = ["A1", "A2", "B1", "B2", "C1"] as const;
export const STATUSES = ["scheduled", "done", "cancelled"] as const;

/** The clinic day, in Belgrade hours. */
export const OPEN_HOUR = 8;
export const CLOSE_HOUR = 20;
const SLOT_MIN = 30;

/** Each doctor's hours: early (08–14), late (14–20) or a middle day (10–18). */
const SHIFTS = {
  early: [8, 14],
  late: [14, 20],
  middle: [10, 18],
} as const satisfies Record<string, readonly [number, number]>;

/** The shift a doctor (by index) works in a week: even and odd weeks alternate. */
const shiftOf = (doctor: number, week: number) => {
  const roster = ROSTER[doctor] as (typeof ROSTER)[number];
  return SHIFTS[roster.shifts[week % 2 === 0 ? 0 : 1]];
};
/** Per doctor: the shift on even weeks and on odd weeks, and the room. */
type Shift = keyof typeof SHIFTS;
const ROSTER: { shifts: readonly [Shift, Shift]; room: (typeof ROOMS)[number] }[] = [
  { shifts: ["early", "late"], room: "A1" },
  { shifts: ["late", "early"], room: "A2" },
  { shifts: ["middle", "middle"], room: "B1" },
  { shifts: ["early", "early"], room: "B2" },
  { shifts: ["late", "late"], room: "C1" },
  { shifts: ["middle", "early"], room: "A1" },
  { shifts: ["early", "middle"], room: "B1" },
  { shifts: ["late", "middle"], room: "A2" },
];

const SERVICES = [
  "Check-up",
  "Consultation",
  "Follow-up",
  "Lab results",
  "Vaccination",
  "Ultrasound",
  "ECG",
  "Blood pressure check",
];

const PATIENTS = [
  "Aleksa Jović",
  "Bisera Kostić",
  "Vuk Milošević",
  "Gordana Pešić",
  "Dušan Radić",
  "Đurđa Antić",
  "Emilija Stanković",
  "Žarko Mitić",
  "Zorana Babić",
  "Ivan Ćirić",
  "Jasna Filipović",
  "Kosta Živković",
  "Lena Vasić",
  "Ljubomir Gajić",
  "Maja Todorović",
  "Nemanja Kovačević",
  "Olga Marić",
  "Petar Jakovljević",
  "Radmila Božić",
  "Srđan Matić",
  "Tamara Đukić",
  "Ćirilo Nedić",
  "Una Perić",
  "Filip Zorić",
  "Hana Spasić",
  "Cvijeta Lukić",
  "Čedomir Vidić",
  "Šejla Mandić",
];

const NOTES = [
  "Bring the previous results.",
  "First visit; arrive 10 minutes early.",
  "Prefers a call the day before.",
  "Fasting since midnight.",
  "Interpreter requested.",
  "Referral from the family doctor.",
];

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
const pick = <T>(rand: Rand, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
const between = (rand: Rand, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

function uuid(rand: Rand): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16));
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16] as string, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** `zone`'s offset from UTC at `instant`, in minutes (Belgrade: 60 in winter, 120 in summer). */
export function zoneOffsetMinutes(instant: number, zone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
    .formatToParts(new Date(instant))
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? "");
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** `2026-10-27T08:00:00+01:00`: a Belgrade wall time, with the offset that day has. */
export function belgradeIso(day: number, minuteOfDay: number): string {
  const d = new Date(day);
  // Noon UTC of that day is safely clear of the 01:00 UTC DST switch.
  const off = zoneOffsetMinutes(day + 12 * 3_600_000, CLINIC_ZONE);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}:00` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** `YYYY-MM-DD` → midnight UTC of that calendar day. */
export function parseDay(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`expected YYYY-MM-DD, got ${JSON.stringify(day)}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(ms)) throw new Error(`not a date: ${day}`);
  return ms;
}

/** The calendar day it is in Belgrade right now. */
export function belgradeToday(now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CLINIC_ZONE }).format(new Date(now));
}

/** `SEED_TODAY` when set (the e2e pins it), else today in Belgrade. */
export function seedToday(env: NodeJS.ProcessEnv = process.env): string {
  const pinned = env.SEED_TODAY?.trim();
  if (pinned) {
    parseDay(pinned);
    return pinned;
  }
  return belgradeToday();
}

export interface AppointmentRow extends Record<string, unknown> {
  __meta: { id: string };
  title: string;
  doctor: string;
  patient: string;
  room: string;
  start: string;
  end: string;
  status: (typeof STATUSES)[number];
  notes?: string;
}

export const WEEKS_AROUND = 6;

/** Every appointment from `today` − 6 weeks to `today` + 6 weeks, weekdays only. */
export function generateAppointments(opts: { today: string; seed?: number }): AppointmentRow[] {
  const today = parseDay(opts.today);
  const rand = prng(opts.seed ?? 20261027);
  const rows: AppointmentRow[] = [];
  const first = today - WEEKS_AROUND * 7 * DAY;
  const last = today + WEEKS_AROUND * 7 * DAY;

  for (let day = first; day <= last; day += DAY) {
    const weekday = new Date(day).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    // Weeks counted from the epoch's Monday, so a doctor's rota does not depend on `today`.
    const week = Math.floor((day - 4 * DAY) / (7 * DAY));
    DOCTORS.forEach((doctor, i) => {
      const roster = ROSTER[i] as (typeof ROSTER)[number];
      // A doctor works four weekdays in five: one rotating day off.
      if ((week + i) % 5 === weekday - 1) return;
      const [from, to] = shiftOf(i, week);
      const slots = ((to - from) * 60) / SLOT_MIN;
      const taken = new Array<boolean>(slots).fill(false);
      const wanted = between(rand, 0, 3) + (rand() < 0.15 ? 1 : 0);
      let placed = 0;
      for (let attempt = 0; attempt < 12 && placed < wanted; attempt++) {
        const at = between(rand, 0, slots - 1);
        const len = pick(rand, [1, 1, 2, 2, 3]);
        if (at + len > slots || taken.slice(at, at + len).some(Boolean)) continue;
        for (let k = at; k < at + len; k++) taken[k] = true;
        placed += 1;
        const startMin = from * 60 + at * SLOT_MIN;
        const patient = pick(rand, PATIENTS);
        const service = pick(rand, SERVICES);
        const past = day < today;
        const r = rand();
        const status = past
          ? r < 0.85
            ? "done"
            : "cancelled"
          : r < 0.9
            ? "scheduled"
            : "cancelled";
        const row: AppointmentRow = {
          __meta: { id: uuid(rand) },
          title: `${service} · ${patient}`,
          doctor,
          patient,
          room: rand() < 0.8 ? roster.room : pick(rand, ROOMS),
          start: belgradeIso(day, startMin),
          end: belgradeIso(day, startMin + len * SLOT_MIN),
          status,
        };
        if (rand() < 0.3) row.notes = pick(rand, NOTES);
        rows.push(row);
      }
    });
  }
  // Every week shows the demo: one 08:00 appointment on `today`, when it is a weekday.
  const weekday = new Date(today).getUTCDay();
  if (weekday !== 0 && weekday !== 6) ensureEightOClock(rows, today, rand);
  return rows.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/**
 * The README's demonstration (switch the header zone, watch 08:00 become
 * 02:00 in New York) needs an 08:00 appointment on the seed day: the first
 * doctor on the early shift that day gets one, unless one is there.
 */
function ensureEightOClock(rows: AppointmentRow[], today: number, rand: Rand) {
  const at = belgradeIso(today, OPEN_HOUR * 60);
  if (rows.some((r) => r.start === at)) return;
  const week = Math.floor((today - 4 * DAY) / (7 * DAY));
  const weekday = new Date(today).getUTCDay();
  const i = DOCTORS.findIndex(
    (_, k) => (week + k) % 5 !== weekday - 1 && shiftOf(k, week)[0] === OPEN_HOUR,
  );
  if (i < 0) return;
  const doctor = DOCTORS[i] as string;
  const end = belgradeIso(today, OPEN_HOUR * 60 + SLOT_MIN);
  // Free the slot: drop whatever this doctor has overlapping 08:00–08:30.
  for (let k = rows.length - 1; k >= 0; k--) {
    const r = rows[k] as AppointmentRow;
    if (
      r.doctor === doctor &&
      Date.parse(r.start) < Date.parse(end) &&
      Date.parse(r.end) > Date.parse(at)
    ) {
      rows.splice(k, 1);
    }
  }
  rows.push({
    __meta: { id: uuid(rand) },
    title: "Check-up · Aleksa Jović",
    doctor,
    patient: "Aleksa Jović",
    room: (ROSTER[i] as (typeof ROSTER)[number]).room,
    start: at,
    end,
    status: "scheduled",
    notes: "The timezone demo: 08:00 in Belgrade.",
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      today: { type: "string" },
      seed: { type: "string", default: "20261027" },
      json: { type: "boolean", default: false },
    },
  });
  const today = values.today ?? seedToday();
  const rows = generateAppointments({ today, seed: Number(values.seed) });
  if (values.json) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log(
      `${rows.length} appointments around ${today} (${rows[0]?.start} … ${rows.at(-1)?.start})`,
    );
  }
}
