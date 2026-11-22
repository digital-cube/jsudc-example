import {
  type MutateManyResponse,
  UdcError,
  type UdcMessage,
  unauthenticatedError,
} from "@jsudc/core";
import type { ChangeFeed, Db, Dispatcher } from "@jsudc/server";
import { moveToFolder, simulateIncoming } from "@jsudc/shared";
import { sql } from "drizzle-orm";
import { incomingMessage } from "../../scripts/generate-mail.js";
import type { DemoCtx } from "./context.js";
import { demoUser } from "./users.js";

/*
 * The mailbox's host actions (0.5.0), defined once in @jsudc/shared and
 * registered here on the dispatcher: the payload arrives validated by the
 * definition's request schema, the handler gets the request context (the
 * demo user of `x-demo-user`), and the answer is typed by the response
 * schema. The browser calls them with `useUdcAction(definition)`.
 */

/** The demo user asking; a host action with no user is "not signed in", as the mailbox is. */
function userOf(ctx: DemoCtx | undefined): string {
  if (!ctx?.user) throw unauthenticatedError("pick a demo user to open the mailbox");
  return ctx.user;
}

/** Run a built-in action under the caller's context and scope; its error is thrown as it is. */
async function run<T>(
  dispatcher: Dispatcher,
  action: string,
  payload: unknown,
  ctx: DemoCtx,
): Promise<T> {
  const msg: UdcMessage = { kind: `udc.${action}`, id: "", payload };
  const res = await dispatcher.dispatch(msg, ctx);
  if (res.kind.endsWith(".err")) throw UdcError.fromPayload(res.payload as never);
  return res.payload as T;
}

export interface MailActionDeps {
  db: Db;
  /** The change feed, when the server runs one: told of what `simulate_incoming` writes. */
  changes?: ChangeFeed | undefined;
}

export function registerMailActions(dispatcher: Dispatcher, deps: MailActionDeps): Dispatcher {
  /**
   * Move messages into a folder. Nothing of it is written by hand: the folder
   * is `read` under the caller's scope (another user's folder is `not_found`,
   * exactly like one that does not exist), and the move is one `mutate_many`
   * under the same context — so the row scope holds the messages to the
   * caller's, the `onMutate` audit runs per message in one transaction, and
   * the change feed hears of it by itself.
   */
  dispatcher.register(moveToFolder, async (req, ctx: DemoCtx) => {
    userOf(ctx);
    await run(dispatcher, "read", { collection: "mail_folders", id: req.folder_id }, ctx);
    const target = req.ids
      ? { ids: req.ids }
      : { filter: req.filter, ...(req.except_ids ? { except_ids: req.except_ids } : {}) };
    const res = await run<MutateManyResponse>(
      dispatcher,
      "mutate_many",
      { collection: "mail_messages", op: "update", ...target, row: { folder_id: req.folder_id } },
      ctx,
    );
    // The folders' counts are computed from the messages: say they changed too.
    await deps.changes?.notify("mail_folders", { op: "update", ctx });
    return { moved: res.updated, failed: res.failed.map((f) => f.id) };
  });

  /**
   * Deliver a message into the caller's Inbox, the way mail arrives: written
   * straight into the table (no jsudc action, so no audit row and no event of
   * its own), then announced with `changes.notify`. The context is what the
   * feed tests against every open stream's row scope (`owner = <user>`):
   * only this user's screens are told, with the new id.
   */
  let delivered = 0;
  dispatcher.register(simulateIncoming, async (_req, ctx: DemoCtx) => {
    const user = demoUser(userOf(ctx));
    if (!user) throw unauthenticatedError("pick a demo user to open the mailbox");
    const msg = incomingMessage(user, ++delivered);
    const res = await deps.db.execute<{ id: string; folder_id: string }>(sql`
      INSERT INTO mail_messages
        (owner, folder_id, sender_name, sender_email, subject, preview, body, size_bytes)
      SELECT ${user.id}, f.id, ${msg.senderName}, ${msg.senderEmail}, ${msg.subject},
             ${msg.preview}, ${msg.body}, ${msg.sizeBytes}
      FROM mail_folders f WHERE f.owner = ${user.id} AND f.role = 'inbox'
      ORDER BY f.position LIMIT 1
      RETURNING id::text, folder_id::text`);
    const row = res.rows[0];
    if (!row) throw new UdcError("not_found", `${user.id} has no Inbox`);
    await deps.changes?.notify("mail_messages", { op: "insert", ids: [row.id], ctx });
    await deps.changes?.notify("mail_folders", { op: "update", ids: [row.folder_id], ctx });
    return { id: row.id, folder_id: row.folder_id, subject: msg.subject };
  });

  return dispatcher;
}
