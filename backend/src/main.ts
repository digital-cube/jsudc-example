import { buildApp } from "./app.js";
import { COLLECTIONS_DIR, config } from "./config.js";
import { connect } from "./db/client.js";
import { createDispatcher } from "./dispatcher.js";
import { loadRegistry } from "./registry.js";
import { PostgresJsonbSource } from "./sources/postgres-jsonb.js";

const handle = connect(config.databaseUrl);
const registry = loadRegistry(
  COLLECTIONS_DIR,
  (asset) =>
    new PostgresJsonbSource({
      db: handle.db,
      table: asset.name,
      initialSchema: asset.schema,
      pageSizeDefault: asset.view.page_size_default,
    }),
);

// Dispatcher failures go to Fastify's logger, which exists once the app does.
const log = { error: (obj: unknown, msg?: string) => app.log.error(obj, msg) };
const app = await buildApp({
  dispatcher: createDispatcher(registry, { log }),
  logger: { level: config.logLevel },
});

app.addHook("onClose", () => handle.close());
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void app.close().then(() => process.exit(0)));
}

await app.listen({ port: config.port, host: config.host });
app.log.info(
  `collections: ${registry
    .list()
    .map((c) => c.name)
    .join(", ")}`,
);
