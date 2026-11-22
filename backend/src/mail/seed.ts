import type { Db } from "@jsudc/server";
import { sql } from "drizzle-orm";
import { generateMail } from "../../scripts/generate-mail.js";
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
