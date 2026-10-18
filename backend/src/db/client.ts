import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

export type Db = NodePgDatabase;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function connect(url: string): DbHandle {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle({ client: pool });
  return { db, pool, close: () => pool.end() };
}
