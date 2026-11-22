import { type FilterNode, unauthenticatedError } from "@jsudc/core";
import { DEMO_USER_HEADER, demoUser, MAIL_COLLECTIONS } from "./users.js";

/** The request context of the example: which demo user is asking, if any. */
export interface DemoCtx {
  /** A known demo user's id, or `null` (no header, or a name nobody has). */
  user: string | null;
}

/** What `demoContext` reads of a Fastify request: its headers and the parsed body. */
export interface ContextRequest {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function collectionOf(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const c = (body as { collection?: unknown }).collection;
  return typeof c === "string" ? c : undefined;
}

/**
 * `udcPlugin`'s `context`: the demo user named in `x-demo-user`. A request
 * on a mailbox collection without a known user is refused in-protocol with
 * the unauthenticated error (`forbidden`, `details.reason: "unauthenticated"`);
 * the other collections need no user, so every other request goes through
 * with `user: null`.
 */
export function demoContext(request: ContextRequest): DemoCtx {
  const user = demoUser(headerValue(request.headers[DEMO_USER_HEADER]));
  const collection = collectionOf(request.body);
  if (!user && collection !== undefined && MAIL_COLLECTIONS.has(collection)) {
    throw unauthenticatedError("pick a demo user to open the mailbox");
  }
  return { user: user?.id ?? null };
}

/**
 * The dispatcher's `rowScope`: a mailbox collection is held to the rows the
 * demo user owns; every other collection is not scoped. Without a user (the
 * `collections` listing of an anonymous visitor, a dispatcher driven without
 * HTTP) the scope matches no row: it never falls open.
 */
export function demoRowScope(ctx: DemoCtx | undefined, collection: string): FilterNode | undefined {
  if (!MAIL_COLLECTIONS.has(collection)) return undefined;
  return { field: "owner", op: "eq", value: ctx?.user ?? "" };
}
