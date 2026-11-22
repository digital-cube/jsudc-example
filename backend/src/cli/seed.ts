/**
 *   npm run seed -- [--reset] [--db <url | database name>] [--test] [--limit N] [--collection NAME]
 *
 * Seeds every Postgres collection under backend/collections (or just --collection):
 * schema.json as active revision 1, then seed.json. Without --reset a
 * collection whose table already has rows is left alone. Rows that depend on
 * the day (the appointments, the tickets' calendar slots) are written around
 * today in Belgrade, or `SEED_TODAY=YYYY-MM-DD` when set; the metrics end at
 * the quarter hour the seed runs in, or at noon of `SEED_TODAY`. The mailbox
 * tables (mail_folders, mail_messages: `postgres_table`, no schema revisions)
 * get the generated folders and messages of every demo user (src/mail/seed.ts),
 * and each user's long "Newsletters" folder whenever they have none yet, even
 * without --reset (so a deploy adds it without reseeding anything else).
 */
import { parseArgs } from "node:util";
import { connect, readCollectionAssets, seedCollection } from "@jsudc/server";
import { seedToday } from "../../scripts/generate-appointments.js";
import { metricsEnd } from "../../scripts/generate-metrics.js";
import { COLLECTIONS_DIR, config } from "../config.js";
import { seedMail, seedNewsletters } from "../mail/seed.js";
import { MAIL_COLLECTIONS } from "../mail/users.js";
import { seedRowsFor } from "../seed-rows.js";

const { values } = parseArgs({
  options: {
    reset: { type: "boolean", default: false },
    test: { type: "boolean", default: false },
    db: { type: "string" },
    limit: { type: "string" },
    collection: { type: "string" },
  },
});

/** `--db` takes a full URL or just a database name on the default server. */
function targetUrl(): string {
  const base = values.test ? config.testDatabaseUrl : config.databaseUrl;
  if (!values.db) return base;
  if (values.db.includes("://")) return values.db;
  const url = new URL(base);
  url.pathname = `/${values.db}`;
  return url.toString();
}

const limit = values.limit === undefined ? undefined : Number(values.limit);
if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
  throw new Error(`--limit must be a non-negative integer, got ${values.limit}`);
}

const url = targetUrl();
// Only a database collection has a table to seed; files and the net bring their own rows.
const assets = readCollectionAssets(COLLECTIONS_DIR).filter(
  (a) =>
    a.source.kind === "postgres_jsonb" &&
    (values.collection === undefined || a.name === values.collection),
);
const mail = values.collection === undefined || MAIL_COLLECTIONS.has(values.collection);
if (assets.length === 0 && !mail)
  throw new Error(`no collection to seed (${values.collection ?? "none found"})`);

const today = seedToday();
const end = metricsEnd();
const handle = connect(url);
try {
  for (const asset of assets) {
    const rows = seedRowsFor(asset, today, { metricsEnd: end });
    const res = await seedCollection(handle.db, {
      table: asset.name,
      schema: asset.schemaJson,
      rows,
      reset: values.reset,
      ...(limit === undefined ? {} : { limit }),
    });
    const where = new URL(url).pathname.slice(1);
    console.log(
      res.skipped
        ? `${where}.${res.table}: already has rows, left alone (use --reset to reseed)`
        : `${where}.${res.table}: ${res.inserted} rows, schema revision 1 ${res.revision}`,
    );
  }
  if (mail) {
    const res = await seedMail(handle.db, { today, reset: values.reset });
    const where = new URL(url).pathname.slice(1);
    console.log(
      res.skipped
        ? `${where}.mail_*: already has rows, left alone (use --reset to reseed)`
        : `${where}.mail_*: ${res.folders} folders, ${res.messages} messages`,
    );
    const long = await seedNewsletters(handle.db, { today });
    console.log(
      long.skipped
        ? `${where}.mail_*: every user has the long folder already, left alone`
        : `${where}.mail_*: the long folder for ${long.folders} users, ${long.messages} messages`,
    );
  }
} finally {
  await handle.close();
}
