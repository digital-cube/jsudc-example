import {
  ACTIONS,
  type CollectionsResponse,
  errKind,
  isUdcError,
  type ListResponse,
  okKind,
  parseKind,
  type ReadResponse,
  UdcError,
  type UdcMessage,
} from "@jsudc/udc-core";
import type { z } from "zod";
import { buildDescribe } from "./describe.js";
import type { Collection, CollectionRegistry } from "./registry.js";
import type { Source } from "./sources/source.js";

export interface DispatchLogger {
  error(obj: unknown, msg?: string): void;
}

type Handler<S extends z.ZodType> = (payload: z.output<S>) => unknown;

interface Registered {
  schema: z.ZodType;
  handle: (payload: unknown) => unknown;
}

/**
 * Turns a request envelope into its `.ok` / `.err` answer. Actions are
 * registered with the Zod schema of their payload; the dispatcher validates,
 * calls the handler, and maps every failure onto the closed error-code set.
 */
export class Dispatcher {
  private readonly handlers = new Map<string, Registered>();
  private readonly log: DispatchLogger;

  constructor(opts: { log: DispatchLogger }) {
    this.log = opts.log;
  }

  register<S extends z.ZodType>(action: string, schema: S, handle: Handler<S>): this {
    this.handlers.set(action, { schema, handle: handle as (payload: unknown) => unknown });
    return this;
  }

  has(action: string): boolean {
    return this.handlers.has(action);
  }

  actions(): string[] {
    return [...this.handlers.keys()];
  }

  /** The payload schema of a registered action (used for the OpenAPI document). */
  schemaOf(action: string): z.ZodType | undefined {
    return this.handlers.get(action)?.schema;
  }

  async dispatch(msg: UdcMessage): Promise<UdcMessage> {
    const parsed = parseKind(msg.kind);
    const action = parsed?.status === "request" ? parsed.action : msg.kind;
    try {
      const registered = parsed?.status === "request" ? this.handlers.get(action) : undefined;
      if (!registered) {
        throw new UdcError("unsupported_op", `unsupported action: ${action}`, { action });
      }
      const payload = registered.schema.safeParse(msg.payload ?? {});
      if (!payload.success) {
        throw new UdcError("validation_error", `invalid ${action} payload`, {
          issues: payload.error.issues,
        });
      }
      const result = await registered.handle(payload.data);
      return { kind: okKind(action), id: msg.id, payload: result };
    } catch (err) {
      if (isUdcError(err)) return { kind: errKind(action), id: msg.id, payload: err.toPayload() };
      this.log.error({ err, action, id: msg.id }, "udc action failed");
      return {
        kind: errKind(action),
        id: msg.id,
        payload: { code: "internal", message: "internal error" },
      };
    }
  }
}

export const PHASE1_ACTIONS = [
  "collections",
  "describe",
  "list",
  "read",
  "mutate",
  "schema.add_field",
  "schema.update_field",
  "schema.soft_delete_field",
] as const;

/** The source of a collection whose schema may be edited, or `unsupported_op`. */
function schemaEditable(c: Collection): Source {
  if (!c.source.capabilities.schema_edit) {
    throw new UdcError(
      "unsupported_op",
      `collection ${c.name} does not support schema edits (schema_edit: false)`,
      { collection: c.name },
    );
  }
  return c.source;
}

/** A dispatcher with the phase-1 actions wired to the registry. */
export function createDispatcher(
  registry: CollectionRegistry,
  opts: { log: DispatchLogger },
): Dispatcher {
  return new Dispatcher(opts)
    .register(
      "collections",
      ACTIONS.collections.request,
      (): CollectionsResponse => ({
        collections: registry.list().map((c) => ({
          name: c.name,
          ...(c.label === undefined ? {} : { label: c.label }),
          default_renderer: c.view.default_renderer,
          capabilities: c.source.capabilities,
        })),
      }),
    )
    .register("describe", ACTIONS.describe.request, async ({ collection }) => {
      const c = registry.get(collection);
      return buildDescribe(c.name, c.source.capabilities, await c.source.describe(), c.view);
    })
    .register(
      "list",
      ACTIONS.list.request,
      ({ collection, filter, sort, page }): Promise<ListResponse> => {
        const c = registry.get(collection);
        return c.source.list({
          filter,
          sort,
          page: { ...page, limit: page?.limit ?? c.view.page_size_default },
        });
      },
    )
    .register(
      "read",
      ACTIONS.read.request,
      async ({ collection, id }): Promise<ReadResponse> => ({
        row: await registry.get(collection).source.read(id),
      }),
    )
    .register("mutate", ACTIONS.mutate.request, async ({ collection, ...op }) => ({
      row: await registry.get(collection).source.mutate(op),
    }))
    .register(
      "schema.add_field",
      ACTIONS["schema.add_field"].request,
      async ({ collection, ...req }) => ({
        schema: await schemaEditable(registry.get(collection)).addField(req),
      }),
    )
    .register(
      "schema.update_field",
      ACTIONS["schema.update_field"].request,
      async ({ collection, ...req }) => ({
        schema: await schemaEditable(registry.get(collection)).updateField(req),
      }),
    )
    .register(
      "schema.soft_delete_field",
      ACTIONS["schema.soft_delete_field"].request,
      async ({ collection, field }) => ({
        schema: await schemaEditable(registry.get(collection)).softDeleteField(field),
      }),
    );
}
