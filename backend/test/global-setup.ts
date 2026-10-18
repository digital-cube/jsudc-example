import { config } from "../src/config.js";
import { createDatabases, runMigrations } from "../src/db/admin.js";

/** Make sure `jsudc_test` exists and is migrated before any test file runs. */
export default async function setup() {
  await createDatabases([config.testDatabaseUrl]);
  await runMigrations(config.testDatabaseUrl);
}
