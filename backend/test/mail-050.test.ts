import type { AddressInfo } from "node:net";
import {
  type ChangeEvent,
  type DescribeResponse,
  type ListResponse,
  type MutateManyResponse,
  type Row,
  UdcError,
} from "@jsudc/core";
import { UdcClient } from "@jsudc/core/client";
import { buildApp, createChangeFeed, createDispatcher, loadRegistry } from "@jsudc/server";
import { moveToFolder, simulateIncoming } from "@jsudc/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateNewsletters, NEWSLETTERS } from "../scripts/generate-mail.js";
import { COLLECTIONS_DIR } from "../src/config.js";
import { registerMailActions } from "../src/mail/actions.js";
import { type DemoCtx, demoContext, demoRowScope } from "../src/mail/context.js";
import { seedMail, seedNewsletters } from "../src/mail/seed.js";
import { mailMessagesSource, mailSource } from "../src/mail/sources.js";
import { DEMO_USER_HEADER, MAIL_COLLECTIONS } from "../src/mail/users.js";
import { useTestDb } from "./helpers.js";

/*
 * What the mailbox shows of @jsudc/* 0.5.0, under two demo users over the
 * same tables: bulk actions (`mutate_many`, all or nothing under `onMutate`),
 * the typed host actions, the search answered by the full-text index, the
 * long folder's seed, and the change feed over real HTTP — the owner is
 * told, the other user is not.
 */

const TODAY = "2026-10-27";
const { db } = useTestDb();

const changes = createChangeFeed({ heartbeatMs: 60_000 });
const registry = loadRegistry(COLLECTIONS_DIR, (a) =>
  MAIL_COLLECTIONS.has(a.name) ? (mailSource(a, db) ?? null) : null,
);
const dispatcher = registerMailActions(
  createDispatcher<DemoCtx>(registry, { log: { error: vi.fn() }, rowScope: demoRowScope, changes }),
  { db, changes },
);

type Answer = { ok: boolean; payload: Record<string, unknown> };
async function as(user: string | null, action: string, payload: unknown): Promise<Answer> {
  const res = await dispatcher.dispatch({ kind: `udc.${action}`, id: "t", payload }, { user });
  return { ok: res.kind.endsWith(".ok"), payload: res.payload as Record<string, unknown> };
}
async function ok<T>(user: string | null, action: string, payload: unknown): Promise<T> {
  const res = await as(user, action, payload);
  if (!res.ok) throw UdcError.fromPayload(res.payload as never);
  return res.payload as T;
}

async function folderOf(user: string, role: string): Promise<string> {
  const res = await db.execute<{ id: string }>(
    sql`SELECT id::text FROM mail_folders WHERE owner = ${user} AND role = ${role}`,
  );
  return String(res.rows[0]?.id);
}
async function messageIds(user: string, folder: string, limit: number): Promise<string[]> {
  const res = await db.execute<{ id: string }>(
    sql`SELECT id::text FROM mail_messages WHERE owner = ${user} AND folder_id = ${folder}::uuid
        ORDER BY received_at DESC LIMIT ${limit}`,
  );
  return res.rows.map((r) => r.id);
}
async function seenOf(ids: string[]): Promise<Record<string, boolean>> {
  const res = await db.execute<{ id: string; seen: boolean }>(
    sql`SELECT id::text, seen FROM mail_messages WHERE id::text IN ${sql.raw(`(${ids.map((i) => `'${i}'`).join(",")})`)}`,
  );
  return Object.fromEntries(res.rows.map((r) => [r.id, r.seen]));
}
async function folderIdOf(id: string): Promise<string> {
  const res = await db.execute<{ folder_id: string }>(
    sql`SELECT folder_id::text FROM mail_messages WHERE id = ${id}::uuid`,
  );
  return String(res.rows[0]?.folder_id);
}
async function auditOps(id: string): Promise<string[]> {
  const res = await db.execute<{ op: string }>(
    sql`SELECT op FROM mail_audit WHERE message_id = ${id}::uuid ORDER BY id`,
  );
  return res.rows.map((r) => r.op);
}

beforeEach(async () => {
  await seedMail(db, { today: TODAY, reset: true });
});
afterAll(() => changes.close());

describe("bulk actions: mutate_many on the messages, two users", () => {
  it("marks many read in one request; another user's id fails as not_found and stays as it was", async () => {
    const anaInbox = await folderOf("ana", "inbox");
    const mine = await messageIds("ana", anaInbox, 5);
    const [theirs] = await messageIds("marko", await folderOf("marko", "inbox"), 1);
    await db.execute(sql`UPDATE mail_messages SET seen = false WHERE owner IN ('ana', 'marko')`);

    const res = await ok<MutateManyResponse>("ana", "mutate_many", {
      collection: "mail_messages",
      op: "update",
      ids: [...mine, String(theirs)],
      row: { seen: true },
    });
    expect(res.updated).toBe(5);
    expect(res.failed).toEqual([expect.objectContaining({ id: theirs, code: "not_found" })]);
    const after = await seenOf([...mine, String(theirs)]);
    for (const id of mine) expect(after[id]).toBe(true);
    expect(after[String(theirs)]).toBe(false);
    // The onMutate hook ran once per message, in the same transaction.
    for (const id of mine) expect(await auditOps(id)).toEqual(["update"]);
    expect(await auditOps(String(theirs))).toEqual([]);
  });

  it("by filter minus except_ids ('select all that match'): only the caller's rows of the folder", async () => {
    const anaCustom = await folderOf("ana", "custom");
    const kept = await messageIds("ana", anaCustom, 2);
    await db.execute(sql`UPDATE mail_messages SET seen = true`);
    const res = await ok<MutateManyResponse>("ana", "mutate_many", {
      collection: "mail_messages",
      op: "update",
      filter: { field: "folder_id", op: "eq", value: anaCustom },
      except_ids: kept,
      row: { seen: false },
    });
    expect(res.updated).toBe(18);
    const unread = await db.execute<{ owner: string; n: number }>(
      sql`SELECT owner, count(*)::int AS n FROM mail_messages WHERE NOT seen GROUP BY owner`,
    );
    expect(unread.rows).toEqual([{ owner: "ana", n: 18 }]);
    expect(Object.values(await seenOf(kept))).toEqual([true, true]);
  });

  it("is all or nothing: a failing onMutate on one message rolls every message back", async () => {
    const failing = loadRegistry(COLLECTIONS_DIR, (a) =>
      a.name === "mail_messages"
        ? mailMessagesSource(a, db, {
            onMutate: async (_ctx, change) => {
              if (change.id === victim) throw new Error("the mail server said no");
            },
          })
        : MAIL_COLLECTIONS.has(a.name)
          ? (mailSource(a, db) ?? null)
          : null,
    );
    const d = createDispatcher<DemoCtx>(failing, {
      log: { error: vi.fn() },
      rowScope: demoRowScope,
    });
    const ids = await messageIds("ana", await folderOf("ana", "inbox"), 4);
    const victim = ids[2];
    await db.execute(sql`UPDATE mail_messages SET seen = false WHERE owner = 'ana'`);
    const res = await d.dispatch(
      {
        kind: "udc.mutate_many",
        id: "t",
        payload: { collection: "mail_messages", op: "update", ids, row: { seen: true } },
      },
      { user: "ana" },
    );
    expect(res.kind).toBe("udc.mutate_many.err");
    expect(Object.values(await seenOf(ids))).toEqual([false, false, false, false]);
  });
});

describe("the host action mail.move_to_folder", () => {
  it("is the shared definition: name, request and response schemas", () => {
    expect(moveToFolder.name).toBe("mail.move_to_folder");
    expect(moveToFolder.request.safeParse({ folder_id: "x", ids: ["a"] }).success).toBe(false);
    const folder = "0b9b5c0e-1f0a-4b8e-9a51-6f1c0d1e2a3b";
    expect(moveToFolder.request.safeParse({ folder_id: folder }).success).toBe(false);
    expect(moveToFolder.request.safeParse({ folder_id: folder, ids: ["a"] }).success).toBe(true);
  });

  it("moves the caller's messages into the caller's folder; another user's id is reported, not moved", async () => {
    const archive = await folderOf("ana", "archive");
    const mine = await messageIds("ana", await folderOf("ana", "inbox"), 3);
    const markoInbox = await folderOf("marko", "inbox");
    const [theirs] = await messageIds("marko", markoInbox, 1);
    const res = await ok<{ moved: number; failed: string[] }>("ana", "mail.move_to_folder", {
      folder_id: archive,
      ids: [...mine, theirs],
    });
    expect(res).toEqual({ moved: 3, failed: [theirs] });
    for (const id of mine) expect(await folderIdOf(id)).toBe(archive);
    expect(await folderIdOf(String(theirs))).toBe(markoInbox);
    // The move went through mutate_many: the audit hook saw it.
    expect(await auditOps(String(mine[0]))).toEqual(["update"]);
  });

  it("refuses another user's folder as not_found, and moves nothing", async () => {
    const anaInbox = await folderOf("ana", "inbox");
    const mine = await messageIds("ana", anaInbox, 2);
    const res = await as("ana", "mail.move_to_folder", {
      folder_id: await folderOf("marko", "archive"),
      ids: mine,
    });
    expect(res.ok).toBe(false);
    expect(res.payload.code).toBe("not_found");
    for (const id of mine) expect(await folderIdOf(id)).toBe(anaInbox);
  });

  it("by filter: everything in a folder but the excepted ids", async () => {
    const custom = await folderOf("ana", "custom");
    const trash = await folderOf("ana", "trash");
    const kept = await messageIds("ana", custom, 1);
    const res = await ok<{ moved: number }>("ana", "mail.move_to_folder", {
      folder_id: trash,
      filter: { field: "folder_id", op: "eq", value: custom },
      except_ids: kept,
    });
    expect(res.moved).toBe(19);
    expect(await messageIds("ana", custom, 100)).toEqual(kept);
  });

  it("validates the payload and needs a demo user", async () => {
    const bad = await as("ana", "mail.move_to_folder", { folder_id: "not-a-uuid", ids: ["x"] });
    expect(bad.payload.code).toBe("validation_error");
    const anon = await as(null, "mail.move_to_folder", {
      folder_id: await folderOf("ana", "archive"),
      ids: ["x"],
    });
    expect(anon.payload).toMatchObject({
      code: "forbidden",
      details: { reason: "unauthenticated" },
    });
  });
});

describe("search answered by the source", () => {
  it("describe says capabilities.search: source, and the box's text is matched in the user's own rows by rank", async () => {
    const desc = await ok<DescribeResponse>("ana", "describe", { collection: "mail_messages" });
    expect(desc.capabilities).toMatchObject({ search: "source", changes: true, mutate_many: true });

    for (const user of ["ana", "marko"]) {
      const res = await ok<ListResponse>(user, "list", {
        collection: "mail_messages",
        search: "invoice",
        page: { limit: 50 },
      });
      expect(res.rows.length).toBeGreaterThan(0);
      for (const r of res.rows) expect(String(r.subject).toLowerCase()).toContain("invoice");
      const own = await db.execute<{ id: string }>(
        sql`SELECT id::text FROM mail_messages WHERE owner = ${user}`,
      );
      const mine = new Set(own.rows.map((r) => r.id));
      for (const r of res.rows) expect(mine.has(r.__meta.id)).toBe(true);
    }
  });

  it("ranks a subject hit above a body-only hit; web-search syntax excludes with a minus", async () => {
    const inbox = await folderOf("ana", "inbox");
    const [a, b] = await messageIds("ana", inbox, 2);
    await db.execute(
      sql`UPDATE mail_messages SET subject = 'Plain note', body = 'about the zeppelin' WHERE id = ${a}::uuid`,
    );
    await db.execute(
      sql`UPDATE mail_messages SET subject = 'Zeppelin tickets', body = 'see you' WHERE id = ${b}::uuid`,
    );
    const ranked = await ok<ListResponse>("ana", "list", {
      collection: "mail_messages",
      search: "zeppelins",
    });
    expect(ranked.rows.map((r: Row) => r.__meta.id)).toEqual([b, a]);
    const minus = await ok<ListResponse>("ana", "list", {
      collection: "mail_messages",
      search: "zeppelin -tickets",
    });
    expect(minus.rows.map((r: Row) => r.__meta.id)).toEqual([a]);
    // Marko has no zeppelin: the scope is ANDed with the match.
    const marko = await ok<ListResponse>("marko", "list", {
      collection: "mail_messages",
      search: "zeppelin",
    });
    expect(marko.rows).toEqual([]);
  });
});

describe("the long folder", () => {
  it("is generated apart from the rest, deterministically, and seeded once per user", async () => {
    const small = generateNewsletters({ today: TODAY, size: 30 });
    expect(small.folders.map((f) => [f.owner, f.name, f.role])).toEqual([
      ["ana", NEWSLETTERS.name, "newsletters"],
      ["marko", NEWSLETTERS.name, "newsletters"],
      ["jelena", NEWSLETTERS.name, "newsletters"],
    ]);
    expect(generateNewsletters({ today: TODAY, size: 30 })).toEqual(small);
    expect(small.messages.filter((m) => !m.seen)).toHaveLength(36);

    expect(await seedNewsletters(db, { today: TODAY, size: 30 })).toEqual({
      skipped: false,
      folders: 3,
      messages: 90,
    });
    // A second run finds every user's folder and adds nothing.
    expect(await seedNewsletters(db, { today: TODAY, size: 30 })).toMatchObject({ skipped: true });
    const folders = await ok<ListResponse>("ana", "list", { collection: "mail_folders" });
    expect(folders.rows.find((f) => f.role === "newsletters")).toMatchObject({
      name: "Newsletters",
      message_count: 30,
      unread_count: 12,
    });
  });
});

describe("the change feed over HTTP: the owner is told, the other user is not", () => {
  let base = "";
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    app = await buildApp({
      dispatcher,
      registry,
      context: demoContext,
      swagger: false,
      logger: false,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });
  afterAll(() => app.close());

  /** Open a stream as `user` on mail_messages and mail_folders; resolves once it is subscribed. */
  async function listen(user: string) {
    const events: ChangeEvent[] = [];
    const stop = new AbortController();
    const client = new UdcClient({ httpUrl: base, headers: { [DEMO_USER_HEADER]: user } });
    await new Promise<void>((ready, fail) => {
      void client
        .changes({
          collections: ["mail_messages", "mail_folders"],
          onChange: (e) => events.push(e),
          onOpen: () => ready(),
          onError: (err) => fail(err),
          signal: stop.signal,
        })
        .catch(fail);
    });
    return { events, client, stop: () => stop.abort() };
  }
  const settle = () => new Promise((r) => setTimeout(r, 150));

  it("simulate_incoming: Ana's stream hears the new id, Marko's hears nothing", async () => {
    const ana = await listen("ana");
    const marko = await listen("marko");
    try {
      const sent = await ana.client.call(simulateIncoming, {});
      await vi.waitFor(() =>
        expect(ana.events).toContainEqual({
          collection: "mail_messages",
          op: "insert",
          ids: [sent.id],
        }),
      );
      expect(ana.events).toContainEqual({
        collection: "mail_folders",
        op: "update",
        ids: [sent.folder_id],
      });
      await settle();
      expect(marko.events).toEqual([]);
      // It is in Ana's Inbox, unread, and only hers.
      const row = await ok<{ row: Row }>("ana", "read", {
        collection: "mail_messages",
        id: sent.id,
      });
      expect(row.row).toMatchObject({ subject: sent.subject, seen: false, folder_name: "Inbox" });
      expect((await as("marko", "read", { collection: "mail_messages", id: sent.id })).ok).toBe(
        false,
      );
    } finally {
      ana.stop();
      marko.stop();
    }
  });

  it("a bulk action and a move: Ana's stream is told of her ids, Marko's of nothing", async () => {
    const ana = await listen("ana");
    const marko = await listen("marko");
    try {
      const ids = await messageIds("ana", await folderOf("ana", "inbox"), 3);
      await ana.client.mutateMany({
        collection: "mail_messages",
        op: "update",
        ids,
        row: { seen: true },
      });
      // The ids come in the order the rows were locked (by id), not the order asked.
      await vi.waitFor(() =>
        expect(ana.events).toContainEqual({
          collection: "mail_messages",
          op: "update",
          ids: [...ids].sort(),
        }),
      );
      const moved = await ana.client.call(moveToFolder, {
        folder_id: await folderOf("ana", "archive"),
        ids: ids.slice(0, 1),
      });
      expect(moved).toEqual({ moved: 1, failed: [] });
      await vi.waitFor(() =>
        expect(ana.events).toContainEqual({ collection: "mail_folders", op: "update" }),
      );
      await settle();
      expect(marko.events).toEqual([]);
    } finally {
      ana.stop();
      marko.stop();
    }
  });

  it("a stream on the mailbox without a demo user is refused (401), not opened", async () => {
    const res = await fetch(`${base}/udc/changes?collections=mail_messages`);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ details: { reason: "unauthenticated" } });
    const other = await fetch(`${base}/udc/changes?collections=mail_messages`, {
      headers: { [DEMO_USER_HEADER]: "eve" },
    });
    expect(other.status).toBe(401);
    await other.body?.cancel();
  });
});
