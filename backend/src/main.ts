import { buildApp, connect, createDispatcher, loadRegistry, makeSource } from "@jsudc/server";
import { COLLECTIONS_DIR, config } from "./config.js";

const handle = connect(config.databaseUrl);
// Each collection's source.yaml picks its source: Postgres (the default), files on disk, the net.
// An http_api source logs every upstream call: the journal shows how often OpenSky is asked.
const sourceLog = {
  info: (msg: string) => app.log.info(msg),
  warn: (msg: string) => app.log.warn(msg),
};
// The library reads no environment of its own: the UDC_* overrides and the credentials come from here.
const registry = loadRegistry(COLLECTIONS_DIR, (asset, reg) =>
  makeSource(asset, { db: handle.db, registry: reg, log: sourceLog, env: process.env }),
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
