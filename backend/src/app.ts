import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { ACTIONS, ErrorPayloadSchema, errKind, isActionName, requestKind } from "@jsudc/udc-core";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { jsonSchemaTransform } from "fastify-type-provider-zod";
import { z } from "zod";
import { registerBlobRoute } from "./blob.js";
import type { Dispatcher } from "./dispatcher.js";
import type { CollectionRegistry } from "./registry.js";

const MESSAGE_ID_HEADER = "x-udc-message-id";

function messageId(header: string | string[] | undefined): string {
  return (Array.isArray(header) ? header[0] : header) ?? "";
}

/** The documented response of one action: its ok payload or the error payload, always HTTP 200. */
function envelopeDoc(action: string) {
  const ok = isActionName(action) ? ACTIONS[action].response : z.unknown();
  return z
    .object({
      kind: z.string().describe(`udc.${action}.ok | udc.${action}.err`),
      id: z.string().describe(`echo of the ${MESSAGE_ID_HEADER} header`),
      payload: z.union([ok, ErrorPayloadSchema]),
    })
    .describe("Always HTTP 200: the envelope kind says ok or err.");
}

/**
 * The HTTP face of the dispatcher: `POST /udc/:action` with the payload as
 * body, always answering HTTP 200 with the `.ok` / `.err` envelope.
 */
export async function buildApp(opts: {
  dispatcher: Dispatcher;
  /** With it, `GET /udc/files/blob` serves file previews of filesystem collections. */
  registry?: CollectionRegistry | undefined;
  logger?: FastifyServerOptions["logger"];
}): Promise<FastifyInstance> {
  const { dispatcher } = opts;
  const app = Fastify({ logger: opts.logger ?? false });

  // Zod schemas on the routes document the API; the dispatcher validates, so a
  // bad payload becomes a `validation_error` envelope instead of an HTTP 400.
  app.setValidatorCompiler(() => (data) => ({ value: data }));
  app.setSerializerCompiler(() => (data) => JSON.stringify(data));

  await app.register(swagger, {
    openapi: {
      info: {
        title: "jsudc",
        version: "0.1.0",
        description:
          "UDC envelope RPC. Every action is `POST /udc/<action>` with the payload as body; " +
          `the answer is always HTTP 200 with \`{kind, id, payload}\`. Send \`${MESSAGE_ID_HEADER}\` to correlate.`,
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  const handle = async (action: string, body: unknown, header: string | string[] | undefined) =>
    dispatcher.dispatch({ kind: requestKind(action), id: messageId(header), payload: body ?? {} });

  // A body Fastify cannot parse (bad JSON, wrong content type) is still answered in-protocol.
  app.setErrorHandler((err: { statusCode?: number; message: string }, request, reply) => {
    const action =
      (request.params as { action?: string }).action ?? request.url.split("/")[2] ?? "";
    if (!request.url.startsWith("/udc/")) {
      reply.code(err.statusCode ?? 500).send({ error: err.message });
      return;
    }
    const clientError = (err.statusCode ?? 500) < 500;
    if (!clientError) request.log.error({ err }, "udc transport failed");
    reply.code(200).send({
      kind: errKind(action),
      id: messageId(request.headers[MESSAGE_ID_HEADER]),
      payload: clientError
        ? { code: "validation_error", message: err.message }
        : { code: "internal", message: "internal error" },
    });
  });

  app.get("/healthz", { schema: { hide: true } }, async () => ({ ok: true }));
  if (opts.registry) registerBlobRoute(app, opts.registry);

  for (const action of dispatcher.actions()) {
    app.post(
      `/udc/${action}`,
      {
        schema: {
          tags: ["udc"],
          operationId: action,
          body: dispatcher.schemaOf(action),
          headers: z.object({ [MESSAGE_ID_HEADER]: z.string().optional() }),
          response: { 200: envelopeDoc(action) },
        },
      },
      (request) => handle(action, request.body, request.headers[MESSAGE_ID_HEADER]),
    );
  }

  // Anything else under /udc: the dispatcher answers `unsupported_op`.
  app.post<{ Params: { action: string } }>("/udc/:action", { schema: { hide: true } }, (request) =>
    handle(request.params.action, request.body, request.headers[MESSAGE_ID_HEADER]),
  );

  return app;
}
