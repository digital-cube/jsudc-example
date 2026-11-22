import { isUnauthenticated, type ListResponse, type Row } from "@jsudc/core";
import { buildApp, createDispatcher, loadRegistry } from "@jsudc/server";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateMail, MESSAGES_PER_ROLE, welcomeSubject } from "../scripts/generate-mail.js";
import { COLLECTIONS_DIR } from "../src/config.js";
import { type DemoCtx, demoContext, demoRowScope } from "../src/mail/context.js";
import { seedMail } from "../src/mail/seed.js";
import { mailSource } from "../src/mail/sources.js";
import { DEMO_USER_HEADER, DEMO_USERS, MAIL_COLLECTIONS } from "../src/mail/users.js";
import { exampleSource } from "../src/sources.js";
import { useTestDb } from "./helpers.js";

const TODAY = "2026-10-27";
const PER_USER = Object.values(MESSAGES_PER_ROLE).reduce((a, b) => a + b, 0);
const { db } = useTestDb();

// Only the mailbox collections: what the server serves for them, the same sources and scope.
const registry = loadRegistry(COLLECTIONS_DIR, (a) =>
  MAIL_COLLECTIONS.has(a.name) ? (mailSource(a, db) ?? null) : null,
);
const dispatcher = createDispatcher<DemoCtx>(registry, {
  log: { error: vi.fn() },
  rowScope: demoRowScope,
});

type Answer = { ok: boolean; payload: Record<string, unknown> };
async function as(user: string | null, action: string, payload: unknown): Promise<Answer> {
  const res = await dispatcher.dispatch({ kind: `udc.${action}`, id: "t", payload }, { user });
  return { ok: res.kind.endsWith(".ok"), payload: res.payload as Record<string, unknown> };
}
async function ok<T>(user: string | null, action: string, payload: unknown): Promise<T> {
  const res = await as(user, action, payload);
  if (!res.ok) throw new Error(JSON.stringify(res.payload));
  return res.payload as T;
}
const code = (a: Answer) => a.payload.code;

async function messagesOf(user: string): Promise<{ id: string; seen: boolean; version: number }[]> {
  const res = await db.execute<{ id: string; seen: boolean; version: number }>(
    sql`SELECT id::text, seen, version FROM mail_messages WHERE owner = ${user} ORDER BY received_at DESC`,
  );
  return res.rows;
}
async function auditCount(messageId: string): Promise<number> {
  const res = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM mail_audit WHERE message_id = ${messageId}::uuid`,
  );
  return res.rows[0]?.n ?? 0;
}

beforeAll(async () => {
  await seedMail(db, { today: TODAY, reset: true });
});

describe("the mailbox seed", () => {
  it("gives every demo user six folders and the same number of messages, deterministically", () => {
    const a = generateMail({ today: TODAY });
    const b = generateMail({ today: TODAY });
    expect(a).toEqual(b);
    for (const user of DEMO_USERS) {
      expect(a.folders.filter((f) => f.owner === user.id)).toHaveLength(6);
      const mine = a.messages.filter((m) => m.owner === user.id);
      expect(mine).toHaveLength(PER_USER);
      const newest = [...mine].sort((x, y) => +y.receivedAt - +x.receivedAt)[0];
      expect(newest?.subject).toBe(welcomeSubject(user));
      expect(newest?.seen).toBe(false);
    }
    expect(new Set(a.messages.map((m) => m.id)).size).toBe(a.messages.length);
    expect(generateMail({ today: "2026-11-01" }).messages[0]?.id).not.toBe(a.messages[0]?.id);
  });

  it("leaves tables that already have rows alone unless reset", async () => {
    expect(await seedMail(db, { today: TODAY })).toEqual({
      skipped: true,
      folders: 0,
      messages: 0,
    });
  });
});

describe("the demo context", () => {
  it("names a known demo user, and refuses a mailbox collection without one", () => {
    const req = (headers: Record<string, string>, collection?: string) => ({
      headers,
      body: collection ? { collection } : undefined,
    });
    expect(demoContext(req({ [DEMO_USER_HEADER]: "ana" }, "mail_messages"))).toEqual({
      user: "ana",
    });
    for (const headers of [{}, { [DEMO_USER_HEADER]: "eve" }] as Record<string, string>[]) {
      for (const c of ["mail_messages", "mail_folders", "mail_audit"]) {
        let err: unknown;
        try {
          demoContext(req(headers, c));
        } catch (e) {
          err = e;
        }
        expect(isUnauthenticated(err), `${JSON.stringify(headers)} on ${c}`).toBe(true);
      }
      // The other collections, and the listing of collections, need no user.
      expect(demoContext(req(headers, "companies"))).toEqual({ user: null });
      expect(demoContext(req(headers))).toEqual({ user: null });
    }
    expect(demoContext({ headers: { [DEMO_USER_HEADER]: ["marko", "ana"] } })).toEqual({
      user: "marko",
    });
  });

  it("scopes only the mailbox collections, and never opens up without a user", () => {
    expect(demoRowScope({ user: "ana" }, "mail_messages")).toEqual({
      field: "owner",
      op: "eq",
      value: "ana",
    });
    expect(demoRowScope({ user: null }, "mail_folders")).toEqual({
      field: "owner",
      op: "eq",
      value: "",
    });
    expect(demoRowScope(undefined, "mail_audit")).toMatchObject({ value: "" });
    expect(demoRowScope({ user: "ana" }, "companies")).toBeUndefined();
  });

  it("over HTTP: no header or an unknown user is the unauthenticated error, in-protocol", async () => {
    const app = await buildApp({
      dispatcher,
      registry,
      context: demoContext,
      swagger: false,
      logger: false,
    });
    afterAll(() => app.close());
    const post = (headers: Record<string, string>) =>
      app.inject({
        method: "POST",
        url: "/udc/list",
        headers: { "content-type": "application/json", ...headers },
        payload: { collection: "mail_messages", page: { limit: 1 } },
      });
    for (const headers of [{}, { [DEMO_USER_HEADER]: "eve" }] as Record<string, string>[]) {
      const res = await post(headers);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        kind: "udc.list.err",
        payload: { code: "forbidden", details: { reason: "unauthenticated" } },
      });
    }
    const res = await post({ [DEMO_USER_HEADER]: "ana" });
    expect(res.json().kind).toBe("udc.list.ok");
  });

  it("the example's source factory serves the mailbox in code and the rest from source.yaml", () => {
    const assets = loadRegistry(COLLECTIONS_DIR, (a) =>
      a.name === "mail_messages" || a.name === "companies"
        ? exampleSource(a, { db, env: { UDC_HTTP_SOURCES: "off" } })
        : null,
    );
    expect(assets.get("mail_messages").source.kind).toBe("postgres_table");
    expect(assets.get("companies").source.kind ?? "postgres_jsonb").toBe("postgres_jsonb");
  });
});

describe("two demo users over the same tables", () => {
  let ana: Awaited<ReturnType<typeof messagesOf>>;
  let marko: Awaited<ReturnType<typeof messagesOf>>;
  beforeEach(async () => {
    ana = await messagesOf("ana");
    marko = await messagesOf("marko");
  });

  it("each lists only their own messages and folders; the owner is hidden", async () => {
    for (const [user, mine, theirs] of [
      ["ana", ana, marko],
      ["marko", marko, ana],
    ] as const) {
      const ids = new Set<string>();
      let cursor: string | null = null;
      do {
        const page: ListResponse = await ok<ListResponse>(user, "list", {
          collection: "mail_messages",
          page: { limit: 100, ...(cursor ? { cursor } : {}) },
        });
        expect(page.total).toBeNull(); // total_count: false
        for (const r of page.rows) {
          ids.add(r.__meta.id);
          expect(r).not.toHaveProperty("owner");
        }
        cursor = page.next_cursor;
      } while (cursor);
      expect(ids.size).toBe(mine.length);
      expect(mine.every((m) => ids.has(m.id))).toBe(true);
      expect(theirs.some((m) => ids.has(m.id))).toBe(false);

      const folders = await ok<ListResponse>(user, "list", { collection: "mail_folders" });
      expect(folders.rows).toHaveLength(6);
      const unread = folders.rows.reduce((n, f) => n + Number(f.unread_count), 0);
      expect(unread).toBe(mine.filter((m) => !m.seen).length);
    }
  });

  it("describe hides the owner and reports no total count", async () => {
    const d = await ok<{
      schema: { fields: Record<string, unknown> };
      capabilities: Record<string, unknown>;
    }>("ana", "describe", { collection: "mail_messages" });
    expect(Object.keys(d.schema.fields)).not.toContain("owner");
    expect(d.schema.fields).toHaveProperty("folder_name");
    expect(d.capabilities).toMatchObject({ total_count: false, mutate: true, schema_edit: false });
    // A client cannot even name it.
    const byOwner = await as("ana", "list", {
      collection: "mail_messages",
      filter: { field: "owner", op: "eq", value: "marko" },
    });
    expect(code(byOwner)).toBe("validation_error");
  });

  it("filters by the open folder and joins the folder's name", async () => {
    const folders = await ok<ListResponse>("ana", "list", { collection: "mail_folders" });
    const inbox = folders.rows.find((f) => f.role === "inbox") as Row;
    const page = await ok<ListResponse>("ana", "list", {
      collection: "mail_messages",
      filter: { field: "folder_id", op: "eq", value: inbox.__meta.id },
      sort: [{ field: "received_at", dir: "desc" }],
      page: { limit: 500 },
    });
    expect(page.rows).toHaveLength(MESSAGES_PER_ROLE.inbox);
    expect(page.rows.every((r) => r.folder_name === "Inbox")).toBe(true);
    expect(page.rows[0]?.subject).toBe("Welcome to the jsudc mailbox, Ana");
  });

  it("neither reads, updates nor deletes the other's message: not_found, nothing written", async () => {
    const theirs = marko[0] as (typeof marko)[number];
    const read = await as("ana", "read", { collection: "mail_messages", id: theirs.id });
    const missing = await as("ana", "read", {
      collection: "mail_messages",
      id: "00000000-0000-4000-8000-000000000000",
    });
    expect(code(read)).toBe("not_found");
    expect(code(missing)).toBe("not_found");

    const update = await as("ana", "mutate", {
      collection: "mail_messages",
      op: "update",
      id: theirs.id,
      row: { seen: !theirs.seen },
      expected_version: theirs.version,
    });
    expect(code(update)).toBe("not_found");
    const del = await as("ana", "mutate", {
      collection: "mail_messages",
      op: "delete",
      id: theirs.id,
    });
    expect(code(del)).toBe("not_found");

    const after = (await messagesOf("marko")).find((m) => m.id === theirs.id);
    expect(after).toEqual(theirs);
    expect(await auditCount(theirs.id)).toBe(0);
    // Marko still reads it.
    expect(
      (await ok<{ row: Row }>("marko", "read", { collection: "mail_messages", id: theirs.id })).row
        .__meta.id,
    ).toBe(theirs.id);
  });

  it("an update writes the audit row in the same transaction; a refused one writes none", async () => {
    const mine = ana.find((m) => !m.seen) as (typeof ana)[number];
    const before = await auditCount(mine.id);

    // Refused: a stale version, a read-only field.
    const stale = await as("ana", "mutate", {
      collection: "mail_messages",
      op: "update",
      id: mine.id,
      row: { seen: true },
      expected_version: mine.version + 7,
    });
    expect(code(stale)).toBe("version_conflict");
    const readOnly = await as("ana", "mutate", {
      collection: "mail_messages",
      op: "update",
      id: mine.id,
      row: { folder_name: "Elsewhere" },
    });
    expect(code(readOnly)).toBe("validation_error");
    expect(await auditCount(mine.id)).toBe(before);

    const done = await ok<{ row: Row }>("ana", "mutate", {
      collection: "mail_messages",
      op: "update",
      id: mine.id,
      row: { seen: true },
      expected_version: mine.version,
    });
    expect(done.row.seen).toBe(true);
    expect(done.row.__meta.version).toBe(mine.version + 1);
    expect(await auditCount(mine.id)).toBe(before + 1);

    // The trail is a collection of its own, scoped like the rest and read-only.
    const trail = await ok<ListResponse>("ana", "list", {
      collection: "mail_audit",
      filter: { field: "message_id", op: "eq", value: mine.id },
    });
    expect(trail.rows.at(-1)).toMatchObject({ op: "update", changes: { seen: true } });
    expect(
      (await ok<ListResponse>("marko", "list", { collection: "mail_audit" })).rows.some(
        (r) => r.message_id === mine.id,
      ),
    ).toBe(false);
    const write = await as("ana", "mutate", {
      collection: "mail_audit",
      op: "delete",
      id: String(trail.rows[0]?.__meta.id),
    });
    expect(code(write)).toBe("unsupported_op");
  });

  it("an insert is pinned to the user asking and audited; a delete of one's own is audited too", async () => {
    const folders = await ok<ListResponse>("ana", "list", { collection: "mail_folders" });
    const own = folders.rows.find((f) => f.role === "custom") as Row;
    const naming = await as("ana", "mutate", {
      collection: "mail_messages",
      op: "insert",
      row: {
        owner: "marko",
        folder_id: own.__meta.id,
        sender_name: "x",
        sender_email: "x@x",
        subject: "x",
      },
    });
    expect(code(naming)).toBe("validation_error");

    const ins = await ok<{ row: Row }>("ana", "mutate", {
      collection: "mail_messages",
      op: "insert",
      row: {
        folder_id: own.__meta.id,
        sender_name: "Ana Petrović",
        sender_email: "ana@mail.example",
        subject: "A note to self",
        preview: "Buy milk",
        body: "Buy milk",
      },
    });
    const id = ins.row.__meta.id;
    expect(ins.row.folder_name).toBe(own.name);
    const owner = await db.execute<{ owner: string }>(
      sql`SELECT owner FROM mail_messages WHERE id = ${id}::uuid`,
    );
    expect(owner.rows[0]?.owner).toBe("ana");
    expect(code(await as("marko", "read", { collection: "mail_messages", id }))).toBe("not_found");

    await ok("ana", "mutate", { collection: "mail_messages", op: "delete", id });
    const ops = await db.execute<{ op: string; owner: string }>(
      sql`SELECT op, owner FROM mail_audit WHERE message_id = ${id}::uuid ORDER BY id`,
    );
    expect(ops.rows).toEqual([
      { op: "insert", owner: "ana" },
      { op: "delete", owner: "ana" },
    ]);
  });

  it("a request without a user (a dispatcher driven without HTTP) sees no row at all", async () => {
    const page = await ok<ListResponse>(null, "list", { collection: "mail_messages" });
    expect(page.rows).toHaveLength(0);
  });
});
