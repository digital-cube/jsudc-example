import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** The shape every jsonb-backed collection table has: all fields live in `data`. */
export function collectionTable(name: string) {
  return pgTable(name, {
    id: uuid("id").primaryKey().defaultRandom(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });
}

export const companies = collectionTable("companies");
export const boards = collectionTable("boards");
export const buckets = collectionTable("buckets");
export const tickets = collectionTable("tickets");
export const appointments = collectionTable("appointments");

export const udcSchemaRevisions = pgTable(
  "udc_schema_revisions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    collection: text("collection").notNull(),
    version: integer("version").notNull(),
    schema: jsonb("schema").$type<Record<string, unknown>>().notNull(),
    active: boolean("active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("udc_schema_revisions_collection_version_key").on(t.collection, t.version),
    uniqueIndex("udc_schema_revisions_one_active_idx").on(t.collection).where(sql`active`),
  ],
);
