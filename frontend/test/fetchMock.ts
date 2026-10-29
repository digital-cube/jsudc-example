import type { ListResponse, Row } from "@jsudc/core";
import { vi } from "vitest";

export interface Call {
  action: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

type Reply = { ok: unknown } | { err: unknown };
type Handler = (body: Record<string, unknown>) => Reply | Promise<Reply>;

/** A `fetch` that answers UDC envelopes from per-action handlers and records every call. */
export function mockUdcFetch(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const action = String(input).split("/udc/")[1] ?? "";
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ action, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const handler = handlers[action];
    if (!handler) throw new Error(`no mock for ${action}`);
    const res = await handler(body);
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

export function row(id: string, version: number, fields: Record<string, unknown>): Row {
  return { __meta: { id, version }, ...fields };
}

export function listOf(rows: Row[], total = rows.length, next: string | null = null): ListResponse {
  return { rows, next_cursor: next, total };
}
