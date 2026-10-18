import { config } from "../config.js";
import { createDatabases, databaseName } from "../db/admin.js";

const urls = [config.databaseUrl, config.testDatabaseUrl];
const created = await createDatabases(urls);
for (const url of urls) {
  const name = databaseName(url);
  console.log(created.includes(name) ? `created ${name}` : `${name} already exists`);
}
