/**
 * Writes `collections/{boards,buckets,tickets}/seed.json`: three invented
 * boards with five buckets each and ~60 tickets. Deterministic: the same seed
 * gives the same files, ids included (tickets refer to boards and buckets by
 * id, so the seed fixes them in `__meta.id`).
 *
 *   npm run generate:kanban -w @jsudc/backend -- [--seed 20261027]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { COLLECTIONS_DIR } from "../src/config.js";
import { belgradeIso, parseDay } from "./generate-appointments.js";

/** mulberry32, as the companies generator. */
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

/** A version-4 shaped uuid from the generator, so ids are stable across runs. */
function uuid(rand: Rand): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16));
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16] as string, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

interface BoardSpec {
  name: string;
  key: string;
  description: string;
  color: string;
  buckets: { name: string; color: string; is_done?: boolean }[];
  /** Tickets per bucket, in bucket order. */
  counts: number[];
  titles: string[];
  tags: string[];
}

const BOARDS: BoardSpec[] = [
  {
    name: "Product roadmap",
    key: "ROA",
    description: "What the product team builds next, from idea to shipped.",
    color: "accent",
    buckets: [
      { name: "Backlog", color: "muted" },
      { name: "Ready", color: "info" },
      { name: "In progress", color: "accent" },
      { name: "Review", color: "warning" },
      { name: "Done", color: "success", is_done: true },
    ],
    counts: [6, 4, 4, 3, 3],
    titles: [
      "Saved filters per user",
      "Bulk edit for selected rows",
      "Export the current view to CSV",
      "Keyboard shortcuts cheat sheet",
      "Dark mode for the print layout",
      "Column presets per collection",
      "Inline image previews",
      "Audit log for schema edits",
      "Undo for the last change",
      "Shareable view links",
      "Faster first load on slow networks",
      "Calendar view for due dates",
      "Comment threads on rows",
      "Onboarding checklist",
      "Usage analytics dashboard",
      "Field-level permissions",
      "Mobile layout for the toolbar",
      "Import rows from a spreadsheet",
      "Relation picker with search",
      "Accessible drag and drop",
    ],
    tags: ["ux", "api", "performance", "a11y", "docs", "mobile"],
  },
  {
    name: "Support desk",
    key: "SUP",
    description: "Customer requests, triaged and answered.",
    color: "info",
    buckets: [
      { name: "New", color: "info" },
      { name: "Triage", color: "warning" },
      { name: "In progress", color: "accent" },
      { name: "Waiting on customer", color: "muted" },
      { name: "Resolved", color: "success", is_done: true },
    ],
    counts: [5, 4, 5, 3, 3],
    titles: [
      "Cannot log in after password reset",
      "Invoice shows the wrong currency",
      "Export stops at 1,000 rows",
      "Dates show in the wrong time zone",
      "Search misses accented names",
      "Two-factor codes arrive late",
      "Dashboard is slow on Mondays",
      "Attachment upload fails over 10 MB",
      "Duplicate rows after import",
      "Email notifications go to spam",
      "Need a copy of last year's data",
      "Report totals do not add up",
      "User cannot see shared views",
      "Request to rename the workspace",
      "Printing cuts off the last column",
      "API key rotation question",
      "Billing address change",
      "Filter chips reset on reload",
      "Translation missing in the menu",
      "Session expires too quickly",
    ],
    tags: ["billing", "bug", "question", "account", "data", "urgent-customer"],
  },
  {
    name: "Release 3.0",
    key: "REL",
    description: "The steps from feature freeze to the 3.0 release.",
    color: "success",
    buckets: [
      { name: "Planned", color: "muted" },
      { name: "Building", color: "accent" },
      { name: "Testing", color: "warning" },
      { name: "Staging", color: "info" },
      { name: "Released", color: "success", is_done: true },
    ],
    counts: [4, 5, 4, 4, 3],
    titles: [
      "Freeze the public API",
      "Migrate the settings table",
      "Write the upgrade guide",
      "Load test the list endpoint",
      "Update third-party licences",
      "Record the release demo",
      "Rotate the signing keys",
      "Smoke tests on staging",
      "Database backup drill",
      "Changelog for 3.0",
      "Remove deprecated endpoints",
      "Bump the minimum Node version",
      "Translate new strings",
      "Security review sign-off",
      "Prepare the rollback plan",
      "Tag the release candidate",
      "Announce the maintenance window",
      "Verify the metrics dashboards",
      "Archive the 2.x branch",
      "Send the release notes",
    ],
    tags: ["infra", "qa", "docs", "security", "release"],
  },
];

const PEOPLE = [
  "Ana Petrović",
  "Marko Ilić",
  "Jelena Kovač",
  "Nikola Stojanović",
  "Mila Đorđević",
  "Luka Pavlović",
  "Sara Nikolić",
  "Stefan Marković",
  "Ivana Lukić",
  "Filip Janković",
];

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const PRIORITY_WEIGHTS = [0.25, 0.45, 0.2, 0.1];

const BODIES = [
  "Agree on the scope first, then split it into small steps.",
  "Steps to reproduce are in the first comment; it happens every time.",
  "Needs a short design review before anyone starts.",
  "Blocked until the related change is merged.",
  "Customer asked for an update by the end of the week.",
  "Low risk; a quick win if someone has an hour.",
  "Check with the team lead which option we prefer.",
  "The acceptance criteria are listed in the description of the epic.",
];

/** The day the due dates are spread around. */
const BASE_DAY = Date.UTC(2026, 10, 2);
const DAY = 86_400_000;

/**
 * The day the committed calendar slots were written for: the current and the
 * next week of it. `npm run seed` moves them by whole weeks to the week it
 * runs in (`shiftSlotsToWeekOf`), so the tickets calendar is never empty.
 */
export const KANBAN_TODAY = "2026-10-27";
/** Share of the tickets that get a `starts_at` / `ends_at`. */
const SCHEDULED_SHARE = 0.4;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Monday of the week `day` (midnight UTC of a calendar day) falls in. */
export const mondayOf = (day: number) => day - ((new Date(day).getUTCDay() + 6) % 7) * DAY;

export interface SeedRow extends Record<string, unknown> {
  __meta: { id: string };
}

export interface KanbanSeed {
  boards: SeedRow[];
  buckets: SeedRow[];
  tickets: SeedRow[];
}

function weighted<T>(rand: Rand, xs: readonly T[], weights: readonly number[]): T {
  let r = rand();
  for (let i = 0; i < xs.length; i++) {
    r -= weights[i] ?? 0;
    if (r < 0) return xs[i] as T;
  }
  return xs[xs.length - 1] as T;
}

function sample<T>(rand: Rand, xs: readonly T[], n: number): T[] {
  const pool = [...xs];
  const out: T[] = [];
  while (out.length < n && pool.length > 0)
    out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0] as T);
  return out;
}

export function generateKanban(seed: number): KanbanSeed {
  const rand = prng(seed);
  // Its own stream: the calendar slots do not move the rest of the board around.
  const slots = prng(seed ^ 0x5ca1ab1e);
  const firstMonday = mondayOf(parseDay(KANBAN_TODAY));
  const out: KanbanSeed = { boards: [], buckets: [], tickets: [] };

  BOARDS.forEach((spec, b) => {
    const boardId = uuid(rand);
    out.boards.push({
      __meta: { id: boardId },
      name: spec.name,
      key: spec.key,
      description: spec.description,
      color: spec.color,
      order: (b + 1) * 100,
    });

    let n = 0;
    spec.buckets.forEach((bucket, k) => {
      const bucketId = uuid(rand);
      out.buckets.push({
        __meta: { id: bucketId },
        board_id: boardId,
        name: bucket.name,
        color: bucket.color,
        order: (k + 1) * 100,
        is_done: bucket.is_done === true,
      });

      for (let i = 0; i < (spec.counts[k] ?? 0); i++) {
        n += 1;
        const ticket: SeedRow = {
          __meta: { id: uuid(rand) },
          board_id: boardId,
          bucket_id: bucketId,
          order: (i + 1) * 100,
          key: `${spec.key}-${String(n).padStart(3, "0")}`,
          title: spec.titles[n - 1] ?? `${spec.name} task ${n}`,
          body: pick(rand, BODIES),
          priority: weighted(rand, PRIORITIES, PRIORITY_WEIGHTS),
          tags: sample(rand, spec.tags, between(rand, 0, 3)),
          assignees: sample(rand, PEOPLE, between(rand, 0, 3)),
        };
        // Roughly one ticket in five has no due date.
        if (rand() < 0.8) ticket.due = isoDay(BASE_DAY + between(rand, -10, 24) * DAY);
        // ~40% are scheduled: a weekday of this week or the next, 09:00-17:00 Belgrade time.
        if (slots() < SCHEDULED_SHARE) {
          const day = firstMonday + between(slots, 0, 9) * DAY;
          const weekday = day + (day - firstMonday >= 5 * DAY ? 2 * DAY : 0);
          const start = between(slots, 9 * 4, 15 * 4) * 15;
          ticket.starts_at = belgradeIso(weekday, start);
          ticket.ends_at = belgradeIso(weekday, start + between(slots, 2, 8) * 15);
        }
        out.tickets.push(ticket);
      }
    });
  });
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { seed: { type: "string", default: "20261027" } } });
  const seed = generateKanban(Number(values.seed));
  for (const [name, rows] of Object.entries(seed)) {
    const out = join(COLLECTIONS_DIR, name, "seed.json");
    writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
    console.log(`wrote ${rows.length} ${name} to ${out}`);
  }
}
