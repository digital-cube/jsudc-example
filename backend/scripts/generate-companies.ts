/**
 * Writes `collections/companies/seed.json`: synthetic Serbian companies, no
 * real registry data. Deterministic: the same seed gives the same file.
 *
 *   npm run generate:companies -w @jsudc/backend -- [--count 200] [--seed 20261018]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { COLLECTIONS_DIR } from "../src/config.js";

/** mulberry32: tiny, seedable, good enough for fixtures. */
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

const PREFIXES = [
  "Morava",
  "Dunav",
  "Sava",
  "Drina",
  "Tisa",
  "Ibar",
  "Timok",
  "Zlatibor",
  "Kopaonik",
  "Avala",
  "Fruška",
  "Tara",
  "Rtanj",
  "Kosmaj",
  "Rudnik",
  "Šumadija",
  "Banat",
  "Bačka",
  "Srem",
  "Pomoravlje",
  "Sloga",
  "Napredak",
  "Jedinstvo",
  "Pobeda",
  "Zora",
  "Iskra",
  "Sunce",
  "Hrast",
  "Lipa",
  "Javor",
  "Jela",
  "Orao",
  "Soko",
  "Vuk",
  "Čelik",
  "Đerdap",
  "Žito",
  "Klas",
  "Vinogradi",
  "Beo",
];

const SUFFIXES = [
  "Gradnja",
  "Promet",
  "Trans",
  "Tehnika",
  "Inženjering",
  "Agrar",
  "Komerc",
  "Trgovina",
  "Mlin",
  "Pekara",
  "Soft",
  "Info",
  "Elektro",
  "Metal",
  "Plast",
  "Drvo",
  "Tekstil",
  "Farm",
  "Mlekara",
  "Turist",
  "Logistika",
  "Energija",
  "Projekt",
  "Dizajn",
  "Servis",
];

// Weighted: Beograd and Novi Sad host most companies.
const CITIES: [string, number][] = [
  ["Beograd", 30],
  ["Novi Sad", 14],
  ["Niš", 9],
  ["Kragujevac", 7],
  ["Subotica", 5],
  ["Zrenjanin", 4],
  ["Pančevo", 4],
  ["Čačak", 4],
  ["Kraljevo", 3],
  ["Novi Pazar", 3],
  ["Smederevo", 3],
  ["Leskovac", 3],
  ["Valjevo", 3],
  ["Kruševac", 3],
  ["Šabac", 3],
  ["Užice", 2],
  ["Sombor", 2],
  ["Požarevac", 2],
  ["Vranje", 2],
  ["Pirot", 2],
];

/** `[lat, lng]` of each city's centre, so the map has a place per chip. */
export const CITY_COORDS: Record<string, readonly [number, number]> = {
  Beograd: [44.8176, 20.4569],
  "Novi Sad": [45.2671, 19.8335],
  Niš: [43.3209, 21.8958],
  Kragujevac: [44.0128, 20.9114],
  Subotica: [46.1003, 19.6658],
  Zrenjanin: [45.3816, 20.3813],
  Pančevo: [44.8708, 20.6403],
  Čačak: [43.8914, 20.3497],
  Kraljevo: [43.7234, 20.687],
  "Novi Pazar": [43.1367, 20.5122],
  Smederevo: [44.6628, 20.93],
  Leskovac: [42.9981, 21.9461],
  Valjevo: [44.2751, 19.8982],
  Kruševac: [43.58, 21.3339],
  Šabac: [44.7489, 19.6908],
  Užice: [43.8586, 19.8488],
  Sombor: [45.7742, 19.1122],
  Požarevac: [44.6213, 21.1878],
  Vranje: [42.5514, 21.9003],
  Pirot: [43.1531, 22.5861],
};

/** How far from its city's centre a company may sit. */
export const JITTER_KM = 4;

const KM_PER_DEG_LAT = 111.32;

/**
 * A point uniformly inside a disc of `JITTER_KM` around `[lat, lng]`, rounded
 * to 5 decimals (about a metre).
 */
function jitter([lat, lng]: readonly [number, number], rand: () => number): [number, number] {
  const r = JITTER_KM * Math.sqrt(rand());
  const a = 2 * Math.PI * rand();
  const dLat = (r * Math.sin(a)) / KM_PER_DEG_LAT;
  const dLng = (r * Math.cos(a)) / (KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  const round = (x: number) => Math.round(x * 1e5) / 1e5;
  return [round(lat + dLat), round(lng + dLng)];
}

const INDUSTRIES = [
  "Građevinarstvo",
  "Trgovina",
  "Transport",
  "Poljoprivreda",
  "Informacione tehnologije",
  "Prehrambena industrija",
  "Energetika",
  "Turizam",
  "Metalska industrija",
  "Tekstilna industrija",
  "Farmacija",
  "Finansije",
  "Obrazovanje",
  "Zdravstvo",
  "Telekomunikacije",
];

const LEGAL_FORMS: [string, number][] = [
  ["DOO", 70],
  ["AD", 12],
  ["PR", 10],
  ["OD", 5],
  ["KD", 3],
];

export interface Company {
  pib: string;
  mb: string;
  name: string;
  legal_form: string;
  city: string;
  industry: string;
  employees: number;
  revenue_eur: number;
  founded: string;
  active: boolean;
  lat: number;
  lng: number;
}

export function generateCompanies(count: number, seed: number): Company[] {
  const rand = prng(seed);
  // The coordinates draw from a stream of their own: every other value stays what it was before they existed.
  const place = prng(seed ^ 0x6c61746c);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const weighted = (xs: [string, number][]) => {
    let r = rand() * xs.reduce((s, [, w]) => s + w, 0);
    for (const [x, w] of xs) {
      r -= w;
      if (r < 0) return x;
    }
    return (xs.at(-1) as [string, number])[0];
  };
  const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join("");

  const names = new Set<string>();
  const pibs = new Set<string>();
  const mbs = new Set<string>();
  const unique = (set: Set<string>, make: () => string) => {
    for (;;) {
      const v = make();
      if (!set.has(v)) {
        set.add(v);
        return v;
      }
    }
  };

  const start = Date.UTC(1990, 0, 1);
  const end = Date.UTC(2024, 11, 31);
  const rows: Company[] = [];
  for (let i = 0; i < count; i++) {
    const legal_form = weighted(LEGAL_FORMS);
    const name = unique(names, () => `${pick(PREFIXES)} ${pick(SUFFIXES)} ${legal_form}`);
    // Log-uniform head count: many small firms, a few large ones.
    const employees =
      legal_form === "PR" ? int(1, 9) : Math.round(Math.exp(rand() * Math.log(5000)));
    const revenue_eur = employees * int(20_000, 120_000) + int(0, 99_999);
    const founded = new Date(start + Math.floor(rand() * (end - start + 1)))
      .toISOString()
      .slice(0, 10);
    const pib = unique(pibs, () => digits(9));
    const mb = unique(mbs, () => digits(8));
    const city = weighted(CITIES);
    const industry = pick(INDUSTRIES);
    const active = rand() >= 0.1;
    const [lat, lng] = jitter(CITY_COORDS[city] as readonly [number, number], place);
    rows.push({
      pib,
      mb,
      name,
      legal_form,
      city,
      industry,
      employees,
      revenue_eur,
      founded,
      active,
      lat,
      lng,
    });
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      count: { type: "string", default: "200" },
      seed: { type: "string", default: "20261018" },
    },
  });
  const rows = generateCompanies(Number(values.count), Number(values.seed));
  const out = join(COLLECTIONS_DIR, "companies", "seed.json");
  writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`wrote ${rows.length} companies to ${out}`);
}
