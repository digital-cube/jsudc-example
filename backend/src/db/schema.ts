import { collectionTable } from "@jsudc/server";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// The library's own table: listed here so drizzle-kit keeps it in the snapshot instead of dropping it.
export { udcSchemaRevisions } from "@jsudc/server";

// The demo collections: one jsonb table each, the shape the library reads.
export const companies = collectionTable("companies");
export const boards = collectionTable("boards");
export const buckets = collectionTable("buckets");
export const tickets = collectionTable("tickets");
export const appointments = collectionTable("appointments");
export const comments = collectionTable("comments");
export const org = collectionTable("org");
export const metrics = collectionTable("metrics");

// The mailbox example (0.4.0): ordinary relational tables with typed columns and
// UUID ids, served by `postgres_table` (src/mail). Every row has an owner, the
// demo user it belongs to; the host's row scope holds each request to its own.
export const mailFolders = pgTable(
  "mail_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    // inbox, sent, archive, …: which icon the folder list draws; a user folder is `custom`.
    role: text("role").notNull().default("custom"),
    position: integer("position").notNull().default(0),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("mail_folders_owner_idx").on(t.owner, t.position)],
);

export const mailMessages = pgTable(
  "mail_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner: text("owner").notNull(),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => mailFolders.id, { onDelete: "cascade" }),
    senderName: text("sender_name").notNull(),
    senderEmail: text("sender_email").notNull(),
    subject: text("subject").notNull(),
    preview: text("preview").notNull(),
    body: text("body").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    seen: boolean("seen").notNull().default(false),
    sizeBytes: integer("size_bytes").notNull().default(0),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("mail_messages_owner_folder_received_idx").on(t.owner, t.folderId, t.receivedAt),
    index("mail_messages_folder_seen_idx").on(t.folderId, t.seen),
  ],
);

// What the messages' `onMutate` writes in the same transaction as every change:
// the visible trace of the hook, read back as the `mail_audit` collection.
export const mailAudit = pgTable(
  "mail_audit",
  {
    id: serial("id").primaryKey(),
    owner: text("owner").notNull(),
    // No foreign key: the trace of a deleted message stays.
    messageId: uuid("message_id").notNull(),
    op: text("op").notNull(),
    changes: jsonb("changes").notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mail_audit_owner_message_idx").on(t.owner, t.messageId)],
);
