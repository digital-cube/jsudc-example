import { buildApp } from "./app.js";
import { COLLECTIONS_DIR, config } from "./config.js";
import { connect } from "./db/client.js";
import { createDispatcher } from "./dispatcher.js";
import { loadRegistry } from "./registry.js";
import { makeSource } from "./sources/factory.js";

const handle = connect(config.databaseUrl);
// Each collection's source.yaml picks its source: Postgres (the default), files on disk, the net.
const registry = loadRegistry(COLLECTIONS_DIR, (asset, reg) =>
  makeSource(asset, { db: handle.db, registry: reg }),
);

// Dispatcher failures go to Fastify's logger, which exists once the app does.
const log = { error: (obj: unknown, msg?: string) => app.log.error(obj, msg) };
const app = await buildApp({
  dispatcher: createDispatcher(registry, { log }),
  registry,
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
    .map((c) => `${c.name} (${c.source.kind ?? "postgres_jsonb"})`)
    .join(", ")}`,
);
if (process.env.UDC_HTTP_FIXTURES) {
  app.log.info(`http_api collections read fixtures from ${process.env.UDC_HTTP_FIXTURES}`);
}
