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
}

export function generateCompanies(count: number, seed: number): Company[] {
  const rand = prng(seed);
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
    rows.push({
      pib: unique(pibs, () => digits(9)),
      mb: unique(mbs, () => digits(8)),
      name,
      legal_form,
      city: weighted(CITIES),
      industry: pick(INDUSTRIES),
      employees,
      revenue_eur,
      founded,
      active: rand() >= 0.1,
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
