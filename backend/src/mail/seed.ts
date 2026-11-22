import type { Db } from "@jsudc/server";
import { sql } from "drizzle-orm";
import { generateMail, generateNewsletters, NEWSLETTERS } from "../../scripts/generate-mail.js";
import { mailFolders, mailMessages } from "../db/schema.js";

export interface MailSeedResult {
  skipped: boolean;
  folders: number;
  messages: number;
}

const BATCH = 500;

/**
 * Seed the mailbox tables with `generateMail` for the day `today`. Like
 * `seedCollection`: without `reset`, tables that already have rows are left
 * alone; with it, the folders, messages and the audit trail are emptied first.
 */
export async function seedMail(
  db: Db,
  opts: { today: string; reset?: boolean },
): Promise<MailSeedResult> {
  if (opts.reset) {
    await db.execute(sql`TRUNCATE mail_audit, mail_messages, mail_folders RESTART IDENTITY`);
  } else {
    const found = await db.execute(sql`SELECT 1 FROM mail_folders LIMIT 1`);
    if (found.rows.length > 0) return { skipped: true, folders: 0, messages: 0 };
  }
  const { folders, messages } = generateMail({ today: opts.today });
  await db.transaction(async (tx) => {
    await tx.insert(mailFolders).values(folders);
    for (let i = 0; i < messages.length; i += BATCH) {
      await tx.insert(mailMessages).values(messages.slice(i, i + BATCH));
    }
  });
  return { skipped: false, folders: folders.length, messages: messages.length };
}

/**
 * The long folder (0.5.0): each demo user's "Newsletters", `NEWSLETTERS.size`
 * messages, added for every user who has no such folder yet — whether or not
 * the rest of the mailbox was just reseeded. A stage seeded by 0.4.0 gets it
 * from a plain `npm run seed`, without `--reset` and without touching a
 * message anybody moved or read there.
 */
export async function seedNewsletters(
  db: Db,
  opts: { today: string; size?: number },
): Promise<MailSeedResult> {
  const have = await db.execute<{ owner: string }>(
    sql`SELECT DISTINCT owner FROM mail_folders WHERE role = ${NEWSLETTERS.role}`,
  );
  const done = new Set(have.rows.map((r) => r.owner));
  const all = generateNewsletters(opts);
  const folders = all.folders.filter((f) => !done.has(f.owner));
  const messages = all.messages.filter((m) => !done.has(m.owner));
  if (folders.length === 0) return { skipped: true, folders: 0, messages: 0 };
  await db.transaction(async (tx) => {
    await tx.insert(mailFolders).values(folders);
    for (let i = 0; i < messages.length; i += BATCH) {
      await tx.insert(mailMessages).values(messages.slice(i, i + BATCH));
    }
  });
  return { skipped: false, folders: folders.length, messages: messages.length };
}
