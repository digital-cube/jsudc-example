import {
  type CollectionAsset,
  type Db,
  type OnMutateHook,
  type PostgresTableSearch,
  PostgresTableSource,
  type Source,
} from "@jsudc/server";
import { sql } from "drizzle-orm";
import type { DemoCtx } from "./context.js";

/**
 * The messages' `onMutate`: every change of a message writes a row into
 * `mail_audit`, in the same transaction, after the message's own statement
 * and before COMMIT. A refused change (another user's message, a stale
 * version, a read-only field) never reaches it; a failure here rolls the
 * message back too. The reading pane shows these rows, so the hook is seen.
 */
export const auditMessageChange: OnMutateHook<DemoCtx | undefined> = async (ctx, change, tx) => {
  // The demo user; a dispatcher driven without HTTP has no ctx, the row says whose it is.
  const owner = ctx?.user ?? String((change.after ?? change.before)?.owner ?? "");
  const changes =
    change.op === "delete"
      ? { subject: change.before?.subject ?? null }
      : Object.fromEntries(Object.entries(change.patch ?? {}).filter(([f]) => f !== "owner"));
  await tx.execute(sql`
    INSERT INTO mail_audit (owner, message_id, op, changes)
    VALUES (${owner}, ${change.id}::uuid, ${change.op}, ${JSON.stringify(changes)}::jsonb)`);
};

/**
 * `mail_folders`: one user's folders, each with its unread and total count —
 * computed fields, correlated subqueries over `mail_messages`, read-only.
 */
export function mailFoldersSource(asset: CollectionAsset, db: Db): Source {
  return new PostgresTableSource({
    db,
    schema: asset.schema,
    from: "mail_folders f",
    writeTable: "mail_folders",
    writeAlias: "f",
    idColumn: "f.id",
    versionColumn: "f.version",
    fields: {
      owner: "f.owner",
      name: "f.name",
      role: "f.role",
      position: "f.position",
      unread_count: {
        sql: "(SELECT count(*)::int FROM mail_messages x WHERE x.folder_id = f.id AND NOT x.seen)",
      },
      message_count: {
        sql: "(SELECT count(*)::int FROM mail_messages x WHERE x.folder_id = f.id)",
      },
    },
  });
}

/**
 * The search box, answered by Postgres (0.5.0): `m.tsv` is the generated
 * `tsvector` of migration 0007 (subject, sender, text; GIN-indexed). The text
 * is web-search syntax — `"exact phrase"`, `or`, `-excluded` — and is always a
 * bound parameter (`q`). With `rank`, a search without a sort comes back best
 * match first; the source then reports `capabilities.search: "source"` and
 * the client sends the box's text as `search` instead of `contains` filters.
 */
export const MAIL_SEARCH: PostgresTableSearch = {
  match: (q) => sql`m.tsv @@ websearch_to_tsquery('english', ${q})`,
  rank: (q) => sql`ts_rank(m.tsv, websearch_to_tsquery('english', ${q}))`,
};

/**
 * `mail_messages`: the messages joined to their folder (`folder_name` is a
 * column of the other table, so read-only), no `count(*)` beside a page
 * (`total_count: false`: a mailbox can be large), the audit hook, and the
 * search answered by the table's full-text index. `opts.onMutate` replaces
 * the audit hook (a test makes it fail, to see a bulk action roll back).
 */
export function mailMessagesSource(
  asset: CollectionAsset,
  db: Db,
  opts: { onMutate?: OnMutateHook } = {},
): Source {
  return new PostgresTableSource({
    db,
    schema: asset.schema,
    from: "mail_messages m JOIN mail_folders f ON f.id = m.folder_id",
    writeTable: "mail_messages",
    writeAlias: "m",
    idColumn: "m.id",
    versionColumn: "m.version",
    fields: {
      owner: "m.owner",
      folder_id: "m.folder_id",
      folder_name: "f.name",
      sender_name: "m.sender_name",
      sender_email: "m.sender_email",
      subject: "m.subject",
      preview: "m.preview",
      body: "m.body",
      received_at: { column: "m.received_at", readOnly: true },
      seen: "m.seen",
      size_bytes: { column: "m.size_bytes", readOnly: true },
    },
    totalCount: false,
    search: MAIL_SEARCH,
    onMutate: opts.onMutate ?? (auditMessageChange as OnMutateHook),
  });
}

/** `mail_audit`: what the hook wrote, read-only, newest first in the view. */
export function mailAuditSource(asset: CollectionAsset, db: Db): Source {
  return new PostgresTableSource({
    db,
    schema: asset.schema,
    table: "mail_audit",
    idType: "integer",
    readOnly: true,
    fields: {
      message_id: "message_id",
      changes: { column: "changes", filterable: false, sortable: false },
    },
  });
}

/** The mailbox collections' sources by name; `undefined` for every other collection. */
export function mailSource(asset: CollectionAsset, db: Db): Source | undefined {
  switch (asset.name) {
    case "mail_folders":
      return mailFoldersSource(asset, db);
    case "mail_messages":
      return mailMessagesSource(asset, db);
    case "mail_audit":
      return mailAuditSource(asset, db);
    default:
      return undefined;
  }
}
