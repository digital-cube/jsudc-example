import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BACKEND_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const COLLECTIONS_DIR = join(BACKEND_DIR, "collections");
export const MIGRATIONS_DIR = join(BACKEND_DIR, "drizzle");

const envFile = join(BACKEND_DIR, ".env");
// Variables already set in the environment win over the file.
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const DEFAULT_DATABASE_URL = "postgresql://jsudc:123@localhost/jsudc";
export const DEFAULT_TEST_DATABASE_URL = "postgresql://jsudc:123@localhost/jsudc_test";

export const config = {
  databaseUrl: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  testDatabaseUrl: process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL,
  port: Number(process.env.PORT || 5100),
  host: process.env.HOST || "127.0.0.1",
  logLevel: process.env.LOG_LEVEL || "info",
};
