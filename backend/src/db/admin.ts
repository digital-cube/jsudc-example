import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { MIGRATIONS_DIR } from "../config.js";

/** The database name of a connection URL. */
export function databaseName(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`refusing to create database with name ${JSON.stringify(name)}`);
  }
  return name;
}

/** `CREATE DATABASE` for every URL whose database is missing, through a connection to `postgres`. */
export async function createDatabases(urls: string[]): Promise<string[]> {
  const created: string[] = [];
  for (const url of urls) {
    const name = databaseName(url);
    const admin = new URL(url);
    admin.pathname = "/postgres";
    const client = new pg.Client({ connectionString: admin.toString() });
    await client.connect();
    try {
      const found = await client.query("select 1 from pg_database where datname = $1", [name]);
      if (found.rowCount === 0) {
        await client.query(`create database "${name}"`);
        created.push(name);
      }
    } finally {
      await client.end();
    }
  }
  return created;
}

/** Apply the drizzle-kit migrations in `backend/drizzle` (what `drizzle-kit migrate` does). */
export async function runMigrations(url: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}
