/**
 * The mailbox example's rows: for each demo user six folders (Inbox, Sent,
 * Drafts, Archive, Trash and one of their own) and about three hundred
 * messages over the 60 days before the seed day, the newest first in the
 * Inbox ("Welcome to the jsudc mailbox, <name>", unread), older ones mostly
 * seen. Ids are UUIDs drawn from the same seeded generator, so one seed day
 * always gives the same rows (the e2e run pins it with SEED_TODAY).
 * There is no seed.json: `npm run seed` calls this (src/mail/seed.ts).
 *
 *   npm run generate:mail -w @jsudc/backend -- [--today 2026-10-27] [--json]
 */
import { parseArgs } from "node:util";
import { DEMO_USERS, type DemoUser } from "../src/mail/users.js";
import { parseDay, seedToday } from "./generate-appointments.js";

export interface MailFolderRow {
  id: string;
  owner: string;
  name: string;
  role: "inbox" | "sent" | "drafts" | "archive" | "trash" | "custom" | "newsletters";
  position: number;
}

export interface MailMessageRow {
  id: string;
  owner: string;
  folderId: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  preview: string;
  body: string;
  receivedAt: Date;
  seen: boolean;
  sizeBytes: number;
}

export interface MailSeed {
  folders: MailFolderRow[];
  messages: MailMessageRow[];
}

/** Messages per folder role (the custom folder included): 300 a user. */
export const MESSAGES_PER_ROLE: Record<Exclude<MailFolderRow["role"], "newsletters">, number> = {
  inbox: 160,
  sent: 45,
  drafts: 5,
  archive: 60,
  trash: 10,
  custom: 20,
};

/** Each user's own folder: the one that differs between them. */
const OWN_FOLDER: Record<string, string> = {
  ana: "Projects",
  marko: "Travel",
  jelena: "Receipts",
};

const DAYS = 60;
const HOUR = 3_600_000;

const SENDERS: readonly [string, string][] = [
  ["Milica Stanković", "milica@studio.example"],
  ["Nikola Ilić", "nikola.ilic@build.example"],
  ["Ivana Đorđević", "ivana@accounts.example"],
  ["Stefan Pavlović", "stefan@ops.example"],
  ["Tamara Kostić", "tamara@design.example"],
  ["Dragan Marković", "dragan@vendor.example"],
  ["Jovana Popović", "jovana@hr.example"],
  ["Luka Živković", "luka@travel.example"],
  ["Sara Todorović", "sara@legal.example"],
  ["GitHub", "noreply@github.example"],
  ["Calendar", "calendar@mail.example"],
  ["Bank statements", "statements@bank.example"],
];

const TOPICS: readonly string[] = [
  "Quarterly report draft",
  "Invoice 2026-{n}",
  "Re: design review on Thursday",
  "Deploy window for the release",
  "Your trip to Novi Sad",
  "Lunch next week?",
  "Contract renewal",
  "Build #{n} failed on main",
  "Build #{n} passed on main",
  "Meeting notes: planning",
  "Welcome aboard, a few links",
  "Re: budget for the offsite",
  "Password policy update",
  "Pull request #{n}: fix the cursor on empty pages",
  "Receipt for your order {n}",
  "Fwd: conference schedule",
  "The office is closed on Friday",
  "Re: the new mailbox screen",
  "Statement for account ending {n}",
  "Can you review this by Monday?",
];

const SENTENCES: readonly string[] = [
  "Thanks for the quick answer yesterday.",
  "I have attached the latest version, the changes are marked.",
  "Could you take a look before the end of the week?",
  "Nothing urgent, but it would be good to settle it soon.",
  "The numbers in the second table have been checked twice.",
  "Let me know if Thursday at ten still works for you.",
  "We moved the deadline by two days, everything else stays.",
  "The link below opens the document in the browser.",
  "I spoke to the team and they agree with the proposal.",
  "If anything is unclear, call me, it is faster.",
  "This message was sent automatically, please do not reply.",
  "The previous thread is quoted below for reference.",
];

/** mulberry32: a small seeded generator, enough for demo data. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A v4-shaped UUID from the generator: deterministic for one seed. */
function uuidFrom(rand: () => number): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16));
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)] as T;
}

function seedOf(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619);
  return h >>> 0;
}

/** The subject every user's newest Inbox message has: what the e2e spec looks for. */
export function welcomeSubject(user: DemoUser): string {
  return `Welcome to the jsudc mailbox, ${user.name.split(" ")[0]}`;
}

function userMail(user: DemoUser, today: string): MailSeed {
  const rand = rng(seedOf(`${user.id}:${today}`));
  // Noon UTC of the seed day: the newest message, the rest before it.
  const end = parseDay(today) + 12 * HOUR;
  const roles = ["inbox", "sent", "drafts", "archive", "trash", "custom"] as const;
  const names: Record<(typeof roles)[number], string> = {
    inbox: "Inbox",
    sent: "Sent",
    drafts: "Drafts",
    archive: "Archive",
    trash: "Trash",
    custom: OWN_FOLDER[user.id] ?? "Projects",
  };
  const folders = roles.map(
    (role, position): MailFolderRow => ({
      id: uuidFrom(rand),
      owner: user.id,
      name: names[role],
      role,
      position,
    }),
  );
  const messages: MailMessageRow[] = [];
  for (const folder of folders) {
    const n = MESSAGES_PER_ROLE[folder.role as keyof typeof MESSAGES_PER_ROLE];
    for (let i = 0; i < n; i++) {
      // Spread over the 60 days, newest first; the first Inbox message is the welcome.
      const age =
        folder.role === "inbox" && i === 0 ? 0 : (i / n) * DAYS * 24 * HOUR + rand() * 6 * HOUR;
      const outgoing = folder.role === "sent" || folder.role === "drafts";
      const [otherName, otherEmail] = pick(rand, SENDERS);
      const welcome = folder.role === "inbox" && i === 0;
      const subject = welcome
        ? welcomeSubject(user)
        : pick(rand, TOPICS).replace("{n}", String(100 + Math.floor(rand() * 900)));
      const sentences = Array.from({ length: 3 + Math.floor(rand() * 5) }, () =>
        pick(rand, SENTENCES),
      );
      const body = welcome
        ? [
            `Hello ${user.name.split(" ")[0]},`,
            "this mailbox is the jsudc example: your folders and messages live in two relational tables, served by postgres_table and held to your user by the server's row scope.",
            "Switch the user at the top right and you see somebody else's mail, never a mix.",
            "Walk the list with j / k or the arrows, open a message with Enter.",
            "New in 0.5.0: tick a few messages and archive them at once, open a row's menu with the dots or a right-click, move a message to another folder, search by relevance, simulate incoming mail and watch it arrive, and scroll the five thousand Newsletters without the page slowing down.",
          ].join("\n\n")
        : `Hi,\n\n${sentences.join(" ")}\n\nBest,\n${outgoing ? user.name : otherName}`;
      // Older mail is mostly read; a third of the recent Inbox is not.
      const recent = age < 7 * 24 * HOUR;
      const seen = welcome ? false : outgoing ? true : recent ? rand() > 0.35 : rand() > 0.05;
      messages.push({
        id: uuidFrom(rand),
        owner: user.id,
        folderId: folder.id,
        senderName: outgoing ? user.name : welcome ? "jsudc" : otherName,
        senderEmail: outgoing ? user.email : welcome ? "hello@jsudc.example" : otherEmail,
        subject,
        preview: body.replace(/\s+/g, " ").slice(0, 140),
        body,
        receivedAt: new Date(end - Math.round(age / 60_000) * 60_000),
        seen,
        sizeBytes: body.length * 2 + 1800 + Math.floor(rand() * 40_000),
      });
    }
  }
  return { folders, messages };
}

/** The long folder (0.5.0): its name, its role and how many messages each user gets in it. */
export const NEWSLETTERS = { name: "Newsletters", role: "newsletters", size: 5000 } as const;

const NEWSLETTER_SENDERS: readonly [string, string][] = [
  ["Frontend Weekly", "digest@frontend-weekly.example"],
  ["Postgres Planet", "news@postgres-planet.example"],
  ["The Balkan Traveller", "letters@balkan-traveller.example"],
  ["Data Engineering Digest", "hello@de-digest.example"],
  ["City of Novi Sad", "events@novisad.example"],
  ["Open Source Monthly", "monthly@oss.example"],
];

const NEWSLETTER_TOPICS: readonly string[] = [
  "React Server Components in practice",
  "Faster full-text search with tsvector",
  "Indexes you did not know you needed",
  "A weekend in Kotor",
  "Streaming rows with Server-Sent Events",
  "Virtual scrolling without a library",
  "The state of TypeScript",
  "Concerts on the Petrovaradin fortress",
  "Vacuum, bloat and you",
  "Designing for keyboards first",
  "Partitioning a billion rows",
  "Trains from Belgrade to Budapest",
];

/**
 * Each demo user's long folder: `NEWSLETTERS.size` messages over the two years
 * before the seed day, newest first, nearly all of them read — the folder the
 * table windows (infinite mode, virtualised). Drawn from a generator of its
 * own, so adding it leaves every row of `generateMail` exactly as it was.
 * `position` follows the six folders `generateMail` gives each user.
 */
export function generateNewsletters(opts: { today: string; size?: number }): MailSeed {
  const size = opts.size ?? NEWSLETTERS.size;
  const out: MailSeed = { folders: [], messages: [] };
  const span = 730 * 24 * HOUR;
  for (const user of DEMO_USERS) {
    const rand = rng(seedOf(`${user.id}:newsletters:${opts.today}`));
    const end = parseDay(opts.today) + 11 * HOUR;
    const folder: MailFolderRow = {
      id: uuidFrom(rand),
      owner: user.id,
      name: NEWSLETTERS.name,
      role: NEWSLETTERS.role,
      position: 6,
    };
    out.folders.push(folder);
    for (let i = 0; i < size; i++) {
      const [senderName, senderEmail] = pick(rand, NEWSLETTER_SENDERS);
      const topic = pick(rand, NEWSLETTER_TOPICS);
      const issue = size - i;
      const sentences = Array.from({ length: 3 + Math.floor(rand() * 4) }, () =>
        pick(rand, SENTENCES),
      );
      const body = `This week: ${topic.toLowerCase()}.\n\n${sentences.join(" ")}\n\nIssue ${issue} of ${senderName}. Unsubscribe at any time.`;
      out.messages.push({
        id: uuidFrom(rand),
        owner: user.id,
        folderId: folder.id,
        senderName,
        senderEmail,
        subject: `${senderName} #${issue}: ${topic}`,
        preview: body.replace(/\s+/g, " ").slice(0, 140),
        body,
        receivedAt: new Date(end - Math.round(((i / size) * span) / 60_000) * 60_000),
        // The newest dozen unread, the rest read.
        seen: i >= 12,
        sizeBytes: body.length * 2 + 12_000 + Math.floor(rand() * 60_000),
      });
    }
  }
  return out;
}

/**
 * One new message for `user`'s Inbox, received `at`: what "Simulate incoming
 * mail" delivers. `n` varies the sender and the subject between clicks.
 */
export function incomingMessage(
  user: DemoUser,
  n: number,
): Pick<
  MailMessageRow,
  "senderName" | "senderEmail" | "subject" | "preview" | "body" | "sizeBytes"
> {
  const rand = rng(seedOf(`${user.id}:incoming:${n}`));
  const [senderName, senderEmail] = pick(rand, SENDERS);
  const subject = `New: ${pick(rand, TOPICS).replace("{n}", String(100 + Math.floor(rand() * 900)))}`;
  const body = `Hi ${user.name.split(" ")[0]},\n\n${[pick(rand, SENTENCES), pick(rand, SENTENCES)].join(" ")}\n\nThis message was delivered by "Simulate incoming mail": written straight into the table, then announced on the change feed.\n\nBest,\n${senderName}`;
  return {
    senderName,
    senderEmail,
    subject,
    preview: body.replace(/\s+/g, " ").slice(0, 140),
    body,
    sizeBytes: body.length * 2 + 1800,
  };
}

/** Every demo user's folders and messages for the seed day `today` (`YYYY-MM-DD`). */
export function generateMail(opts: { today: string }): MailSeed {
  const out: MailSeed = { folders: [], messages: [] };
  for (const user of DEMO_USERS) {
    const one = userMail(user, opts.today);
    out.folders.push(...one.folders);
    out.messages.push(...one.messages);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: { today: { type: "string" }, json: { type: "boolean", default: false } },
  });
  const mail = generateMail({ today: values.today ?? seedToday() });
  if (values.json) console.log(JSON.stringify(mail, null, 2));
  else {
    for (const user of DEMO_USERS) {
      const folders = mail.folders.filter((f) => f.owner === user.id);
      const msgs = mail.messages.filter((m) => m.owner === user.id);
      console.log(
        `${user.id}: ${folders.map((f) => f.name).join(", ")}; ${msgs.length} messages, ${msgs.filter((m) => !m.seen).length} unread`,
      );
    }
  }
}
