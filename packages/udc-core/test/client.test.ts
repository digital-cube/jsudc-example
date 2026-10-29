import { describe, expect, it, vi } from "vitest";
import { MESSAGE_ID_HEADER, UdcClient } from "../src/client.js";
import { UdcError } from "../src/index.js";

interface Call {
  action: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

type Reply = { ok: unknown } | { err: unknown };

/** A `fetch` that answers UDC envelopes from per-action handlers and records every call. */
function mockUdcFetch(handlers: Record<string, (body: Record<string, unknown>) => Reply>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const action = String(input).split("/udc/")[1] ?? "";
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ action, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const handler = handlers[action];
    if (!handler) throw new Error(`no mock for ${action}`);
    const res = handler(body);
    const envelope =
      "ok" in res
        ? { kind: `udc.${action}.ok`, id: "", payload: res.ok }
        : { kind: `udc.${action}.err`, id: "", payload: res.err };
    return new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

describe("UdcClient", () => {
  it("posts the payload to <httpUrl>/udc/<action> with a message id and unwraps .ok", async () => {
    const { fetch, calls } = mockUdcFetch({ describe: () => ({ ok: { collection: "c" } }) });
    const client = new UdcClient({ httpUrl: "http://h/", headers: { "x-extra": "1" }, fetch });
    await expect(client.describe("c")).resolves.toEqual({ collection: "c" });
    expect(calls[0]?.action).toBe("describe");
    expect(calls[0]?.body).toEqual({ collection: "c" });
    expect(calls[0]?.headers[MESSAGE_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[0]?.headers["x-extra"]).toBe("1");
    expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]).toBe(
      "http://h/udc/describe",
    );
  });

  it("throws UdcError on .err with code and details", async () => {
    const { fetch } = mockUdcFetch({
      mutate: () => ({
        err: { code: "version_conflict", message: "stale", details: { current_version: 4 } },
      }),
    });
    const client = new UdcClient({ httpUrl: "", fetch });
    const err = await client
      .mutate({ collection: "c", op: "update", id: "1", row: {} })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UdcError);
    expect(err).toMatchObject({ code: "version_conflict", details: { current_version: 4 } });
  });

  it("maps schema actions to their dotted names", async () => {
    const { fetch, calls } = mockUdcFetch({
      "schema.soft_delete_field": () => ({ ok: { schema: {} } }),
    });
    await new UdcClient({ httpUrl: "", fetch }).schemaSoftDeleteField({
      collection: "c",
      field: "x",
    });
    expect(calls[0]?.action).toBe("schema.soft_delete_field");
  });

  it("a non-200 is a plain (retryable) Error", async () => {
    const client = new UdcClient({
      httpUrl: "",
      fetch: async () => new Response("bad gateway", { status: 502 }),
    });
    const err = await client.collections().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UdcError);
  });
});
