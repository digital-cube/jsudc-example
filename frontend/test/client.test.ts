import { UdcError } from "@jsudc/udc-core";
import { describe, expect, it } from "vitest";
import { MESSAGE_ID_HEADER, UdcClient } from "../src/udc/client";
import { mockUdcFetch } from "./fetchMock";

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
