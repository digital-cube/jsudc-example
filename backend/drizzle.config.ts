import { defineConfig } from "drizzle-kit";
import { config } from "./src/config.js";

// `MIGRATE_TARGET=test drizzle-kit migrate` points the same migrations at the test database.
const url = process.env.MIGRATE_TARGET === "test" ? config.testDatabaseUrl : config.databaseUrl;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
