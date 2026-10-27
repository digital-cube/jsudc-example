/**
 *   npm run seed -- [--reset] [--db <url | database name>] [--test] [--limit N] [--collection NAME]
 *
 * Seeds every collection under backend/collections (or just --collection):
 * schema.json as active revision 1, then seed.json. Without --reset a
 * collection whose table already has rows is left alone. Rows that depend on
 * the day (the appointments, the tickets' calendar slots) are written around
 * today in Belgrade, or `SEED_TODAY=YYYY-MM-DD` when set.
 */
import { parseArgs } from "node:util";
import { seedToday } from "../../scripts/generate-appointments.js";
import { COLLECTIONS_DIR, config } from "../config.js";
import { connect } from "../db/client.js";
import { readCollectionAssets } from "../registry.js";
import { seedCollection } from "../seed.js";
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
const assets = readCollectionAssets(COLLECTIONS_DIR).filter(
  (a) => values.collection === undefined || a.name === values.collection,
);
if (assets.length === 0)
  throw new Error(`no collection to seed (${values.collection ?? "none found"})`);

const today = seedToday();
const handle = connect(url);
try {
  for (const asset of assets) {
    const rows = seedRowsFor(asset, today);
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
} finally {
  await handle.close();
}
