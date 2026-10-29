/**
 * Writes `collections/{comments,org}/seed.json`, the two tree examples:
 *
 * - `comments`: one discussion of ~80 comments, replies up to depth 6.
 * - `org`: one company → 6 departments → 2–4 teams each → 4–8 people each.
 *
 * Every structure field is filled here, consistently: `parent_id`, sparse
 * `order` per parent, `depth`, and for `org` also `ancestor_ids` (root first)
 * and `children_count`. Deterministic: the same seed gives the same files,
 * ids included (rows refer to their parents by id, fixed in `__meta.id`).
 * Names and text are invented.
 *
 *   npm run generate:trees -w @jsudc/backend -- [--seed 20261028]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ORDER_GAP } from "@jsudc/core";
import { COLLECTIONS_DIR } from "../src/config.js";

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

export type SeedRow = Record<string, unknown> & { __meta: { id: string } };

// comments --------------------------------------------------------------------

export const COMMENT_AUTHORS = [
  ["Ana Petrović", "AP"],
  ["Marko Jovanović", "MJ"],
  ["Jelena Nikolić", "JN"],
  ["Nikola Đorđević", "NĐ"],
  ["Milica Stojanović", "MS"],
  ["Stefan Ilić", "SI"],
  ["Ivana Marković", "IM"],
  ["Luka Pavlović", "LP"],
  ["Tamara Kostić", "TK"],
  ["Vuk Milosavljević", "VM"],
] as const;

export const COMMENT_ROOTS = 8;
export const COMMENT_COUNT = 80;
export const COMMENT_MAX_DEPTH = 6;
/** The thread starts here; every reply comes later than the comment it answers. */
const THREAD_START = Date.UTC(2026, 9, 20, 7, 30);

const CITIES = ["Beograd", "Novi Sad", "Niš", "Kragujevac", "Subotica", "Čačak", "Zrenjanin"];
const OPENERS = [
  "Slažem se",
  "Ne bih se složio",
  "Zanimljivo",
  "Tačno tako",
  "Imam drugačije iskustvo",
  "Dobra poenta",
  "Moram da dodam",
  "Iskreno, nisam siguran",
  "Kod nas je isto",
  "Hvala na ovome",
];
const CLAIMS = [
  "rad od kuće meni štedi sat vremena dnevno",
  "kancelarija mi fali zbog ljudi, ne zbog posla",
  "hibridni model sa dva dana u kancelariji je najbolji kompromis",
  "sastanci su kraći kad su na daljinu",
  "nov tim je mnogo lakše uvesti u posao uživo",
  "zakup prostora je postao preskup za male firme",
  "internet kod kuće ume da zakaže baš kad je bitno",
  "deca i rad od kuće ne idu zajedno",
  "fleksibilno radno vreme je važnije od mesta rada",
  "zajednički prostori za rad su se pokazali kao dobro rešenje",
  "putovanje do posla je najveći gubitak vremena",
  "posle tri godine na daljinu teško je vratiti se",
];
const PLACES = [
  "u {city} gužve ujutru traju sve duže",
  "u {city} su cene stanova u centru porasle",
  "u {city} ima sve više coworking prostora",
  "firme iz {city} sve češće nude rad na daljinu",
  "prevoz u {city} se popravio ove godine",
];
const CLOSERS = [
  "Šta vi mislite?",
  "Videćemo kako će biti dogodine.",
  "Bar je tako kod nas.",
  "Možda grešim.",
  "To mi je presudilo.",
  "",
  "",
];

function commentBody(rand: Rand): string {
  const parts = [`${pick(rand, OPENERS)}, ${pick(rand, CLAIMS)}.`];
  if (rand() < 0.45) {
    const place = pick(rand, PLACES).replace("{city}", pick(rand, CITIES));
    parts.push(`${place[0]?.toUpperCase()}${place.slice(1)}.`);
  }
  const closer = pick(rand, CLOSERS);
  if (closer) parts.push(closer);
  return parts.join(" ");
}

/** The thread: `COMMENT_ROOTS` top-level comments, then replies, each under a comment above depth 6. */
export function generateComments(seed: number): SeedRow[] {
  const rand = prng(seed);
  const rows: (SeedRow & { depth: number; created: number })[] = [];
  const nextOrder = new Map<string | null, number>();
  const add = (parent: (typeof rows)[number] | null, created: number) => {
    const key = parent?.__meta.id ?? null;
    const order = (nextOrder.get(key) ?? 0) + ORDER_GAP;
    nextOrder.set(key, order);
    const [author, initials] = pick(rand, COMMENT_AUTHORS);
    const row = {
      __meta: { id: uuid(rand) },
      parent_id: key,
      order,
      depth: parent ? parent.depth + 1 : 0,
      body: commentBody(rand),
      author,
      author_initials: initials,
      score: between(rand, -3, 35),
      created,
    };
    rows.push(row);
    return row;
  };

  let at = THREAD_START;
  for (let i = 0; i < COMMENT_ROOTS; i++) {
    at += between(rand, 20, 90) * 60_000;
    add(null, at);
  }
  // One chain down to the deepest level, so the thread always shows depth 6.
  let deepest = rows[between(rand, 0, COMMENT_ROOTS - 1)] as (typeof rows)[number];
  while (deepest.depth < COMMENT_MAX_DEPTH) {
    deepest = add(deepest, deepest.created + between(rand, 5, 120) * 60_000);
  }
  while (rows.length < COMMENT_COUNT) {
    // Recent comments get most replies: pick from the later half more often.
    const open = rows.filter((r) => r.depth < COMMENT_MAX_DEPTH);
    const parent =
      rand() < 0.6 ? pick(rand, open.slice(Math.floor(open.length / 2))) : pick(rand, open);
    add(parent, parent.created + between(rand, 3, 600) * 60_000);
  }
  return rows.map(({ created, ...row }) => ({
    ...row,
    created_at: new Date(created).toISOString(),
  }));
}

// org -------------------------------------------------------------------------

const FIRST = [
  "Aleksandar",
  "Bojana",
  "Dejan",
  "Dragana",
  "Đorđe",
  "Isidora",
  "Jovan",
  "Katarina",
  "Lazar",
  "Maja",
  "Miloš",
  "Nevena",
  "Ognjen",
  "Petra",
  "Relja",
  "Sanja",
  "Teodora",
  "Uroš",
  "Vesna",
  "Zoran",
];
const LAST = [
  "Antić",
  "Babić",
  "Ćirić",
  "Despotović",
  "Filipović",
  "Gajić",
  "Janković",
  "Lukić",
  "Mitrović",
  "Obradović",
  "Popović",
  "Radić",
  "Savić",
  "Todorović",
  "Vasić",
  "Živković",
];

interface DepartmentSpec {
  name: string;
  title: string;
  teams: string[];
  roles: string[];
}

export const ORG_COMPANY = "Kvadrat Softver d.o.o.";

export const ORG_DEPARTMENTS: DepartmentSpec[] = [
  {
    name: "Inženjering",
    title: "Razvoj proizvoda",
    teams: ["Platforma", "Mobilne aplikacije", "Podaci", "Infrastruktura"],
    roles: ["Softverski inženjer", "Stariji inženjer", "Tehnički lider", "QA inženjer"],
  },
  {
    name: "Prodaja",
    title: "Prodaja i partnerstva",
    teams: ["Domaće tržište", "Izvoz", "Partneri"],
    roles: ["Menadžer prodaje", "Komercijalista", "Account menadžer"],
  },
  {
    name: "Marketing",
    title: "Brend i rast",
    teams: ["Sadržaj", "Performans marketing", "Društvene mreže"],
    roles: ["Kopirajter", "Dizajner", "Marketing specijalista"],
  },
  {
    name: "Finansije",
    title: "Računovodstvo i kontroling",
    teams: ["Računovodstvo", "Kontroling", "Nabavka"],
    roles: ["Računovođa", "Finansijski analitičar", "Referent nabavke"],
  },
  {
    name: "Ljudski resursi",
    title: "Ljudi i kultura",
    teams: ["Regrutacija", "Razvoj zaposlenih", "Administracija"],
    roles: ["Regruter", "HR partner", "Trener"],
  },
  {
    name: "Podrška korisnicima",
    title: "Uspeh korisnika",
    teams: ["Prva linija", "Druga linija", "Obuke"],
    roles: ["Agent podrške", "Specijalista podrške", "Trener za korisnike"],
  },
];

const ICON = { company: "building", department: "users", team: "users", person: "user" } as const;
type Kind = keyof typeof ICON;

export function generateOrg(seed: number): SeedRow[] {
  const rand = prng(seed);
  const rows: SeedRow[] = [];
  const used = new Set<string>();
  const person = () => {
    for (;;) {
      const name = `${pick(rand, FIRST)} ${pick(rand, LAST)}`;
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
  };
  const node = (
    kind: Kind,
    name: string,
    title: string,
    parent: SeedRow | null,
    order: number,
  ): SeedRow => {
    const ancestors = parent ? [...(parent.ancestor_ids as string[]), parent.__meta.id] : [];
    const row: SeedRow = {
      __meta: { id: uuid(rand) },
      parent_id: parent?.__meta.id ?? null,
      order,
      depth: ancestors.length,
      children_count: 0,
      ancestor_ids: ancestors,
      name,
      kind,
      title,
      icon: ICON[kind],
      headcount: kind === "person" ? 1 : 0,
    };
    if (parent) parent.children_count = (parent.children_count as number) + 1;
    rows.push(row);
    return row;
  };

  const company = node("company", ORG_COMPANY, "Softver za logistiku", null, ORDER_GAP);
  ORG_DEPARTMENTS.forEach((d, di) => {
    const dept = node("department", d.name, d.title, company, (di + 1) * ORDER_GAP);
    d.teams.forEach((t, ti) => {
      const team = node("team", t, `Tim: ${t}`, dept, (ti + 1) * ORDER_GAP);
      const people = between(rand, 4, 8);
      for (let pi = 0; pi < people; pi++) {
        const role = pi === 0 ? "Vođa tima" : pick(rand, d.roles);
        node("person", person(), role, team, (pi + 1) * ORDER_GAP);
      }
      team.headcount = people;
      dept.headcount = (dept.headcount as number) + people;
    });
    company.headcount = (company.headcount as number) + (dept.headcount as number);
  });
  return rows;
}

export const TREES_SEED = 20261028;

export function generateTrees(seed = TREES_SEED): { comments: SeedRow[]; org: SeedRow[] } {
  return { comments: generateComments(seed), org: generateOrg(seed + 1) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: { seed: { type: "string", default: String(TREES_SEED) } },
  });
  for (const [name, rows] of Object.entries(generateTrees(Number(values.seed)))) {
    const out = join(COLLECTIONS_DIR, name, "seed.json");
    writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
    console.log(`wrote ${rows.length} ${name} to ${out}`);
  }
}
