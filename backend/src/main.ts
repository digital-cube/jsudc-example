import { buildApp, connect, createChangeFeed, createDispatcher, loadRegistry } from "@jsudc/server";
import { COLLECTIONS_DIR, config } from "./config.js";
import { registerMailActions } from "./mail/actions.js";
import { type DemoCtx, demoContext, demoRowScope } from "./mail/context.js";
import { exampleSource } from "./sources.js";

const handle = connect(config.databaseUrl);
// Each collection's source.yaml picks its source: Postgres (the default), files on disk, the net;
// the mailbox collections are registered in code (src/mail/sources.ts).
// An http_api source logs every upstream call: the journal shows how often OpenSky is asked.
const sourceLog = {
  info: (msg: string) => app.log.info(msg),
  warn: (msg: string) => app.log.warn(msg),
};
// The library reads no environment of its own: the UDC_* overrides and the credentials come from here.
const registry = loadRegistry(COLLECTIONS_DIR, (asset, reg) =>
  exampleSource(asset, { db: handle.db, registry: reg, log: sourceLog, env: process.env }),
);

// Dispatcher failures go to Fastify's logger, which exists once the app does.
const log = { error: (obj: unknown, msg?: string) => app.log.error(obj, msg) };
// The change feed (0.5.0): every collection says `capabilities.changes: true` and the plugin
// serves GET /udc/changes as Server-Sent Events, each stream under its own row scope. One
// process, so the default in-process bus; several processes behind a load balancer would pass
// `bus: createPostgresChangeBus({ connectionString })` so a write in one reaches the others.
const changes = createChangeFeed({ log });
// Who is asking: the demo user the frontend names in x-demo-user (no login). The mailbox
// collections are held to that user's rows; every other collection is not scoped.
const dispatcher = createDispatcher<DemoCtx>(registry, { log, rowScope: demoRowScope, changes });
// The mailbox's own actions (move to folder, simulate incoming mail), typed in @jsudc/shared.
registerMailActions(dispatcher, { db: handle.db, changes });
const app = await buildApp({
  dispatcher,
  registry,
  context: demoContext,
  logger: { level: config.logLevel },
});

app.addHook("onClose", async () => {
  await changes.close();
  await handle.close();
});
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
