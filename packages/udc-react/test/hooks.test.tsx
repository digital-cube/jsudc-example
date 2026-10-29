import { isVersionConflict, type ListResponse, UdcError } from "@jsudc/core";
import { UdcClient } from "@jsudc/core/client";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { pageOffset, useUdcCollection, useUdcMutate } from "../src/udc/hooks";
import { udcKeys } from "../src/udc/keys";
import { createUdcQueryClient, shouldRetry, UdcProvider } from "../src/udc/provider";
import { type Call, listOf, mockUdcFetch, row } from "./fetchMock";

function setup(handlers: Parameters<typeof mockUdcFetch>[0]) {
  const mock = mockUdcFetch(handlers);
  const client = new UdcClient({ httpUrl: "http://api", fetch: mock.fetch });
  const qc = createUdcQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <UdcProvider client={client}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </UdcProvider>
  );
  return { ...mock, qc, wrapper };
}

const listCalls = (calls: Call[]) => calls.filter((c) => c.action === "list");

describe("useUdcCollection", () => {
  it("pages mode asks for offset = (page-1)*limit and exposes rows and total", async () => {
    const { wrapper, calls } = setup({
      list: () => ({ ok: listOf([row("a", 1, { name: "A" })], 120) }),
    });
    const { result } = renderHook(
      () =>
        useUdcCollection({
          collection: "companies",
          mode: "pages",
          pageLimit: 25,
          page: 3,
          sort: [{ field: "name", dir: "asc" }],
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.total).toBe(120);
    expect(result.current.hasNextPage).toBe(false);
    expect(listCalls(calls)).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      collection: "companies",
      sort: [{ field: "name", dir: "asc" }],
      page: { limit: 25, offset: 50 },
    });
    expect(pageOffset(1, 50)).toBe(0);
  });

  it("infinite mode follows next_cursor and concatenates pages", async () => {
    const { wrapper, calls } = setup({
      list: (body) => {
        const cursor = (body.page as { cursor?: string }).cursor;
        return cursor
          ? { ok: listOf([row("b", 1, {})], 2, null) }
          : { ok: listOf([row("a", 1, {})], 2, "CUR") };
      },
    });
    const { result } = renderHook(
      () => useUdcCollection({ collection: "c", mode: "infinite", pageLimit: 1 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.rows.map((r) => r.__meta.id)).toEqual(["a", "b"]));
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.total).toBe(2);
    expect(listCalls(calls).map((c) => c.body.page)).toEqual([
      { limit: 1 },
      { limit: 1, cursor: "CUR" },
    ]);
  });

  it("does not retry a UdcError", async () => {
    const { wrapper, calls } = setup({
      list: () => ({ err: { code: "validation_error", message: "unknown field nope" } }),
    });
    const { result } = renderHook(
      () => useUdcCollection({ collection: "c", mode: "pages", pageLimit: 10 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.error).toBeInstanceOf(UdcError));
    expect(listCalls(calls)).toHaveLength(1);
    expect(shouldRetry(0, new Error("network"))).toBe(true);
    expect(shouldRetry(2, new Error("network"))).toBe(false);
  });
});

/** Seed the cache with one page of two rows, as a mounted list would. */
function seedPage(qc: QueryClient, data: ListResponse) {
  const key = udcKeys.list("companies", {
    filter: undefined,
    sort: [],
    limit: 50,
    mode: "pages",
    page: 1,
  });
  qc.setQueryData(key, data);
  return key;
}

describe("useUdcMutate", () => {
  const initial = listOf([row("a", 1, { name: "Old" }), row("b", 4, { name: "Other" })]);

  it("patches the row optimistically, then takes the server's row", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { wrapper, qc, calls } = setup({
      // The reply is held until the optimistic state has been checked.
      mutate: async () => {
        await gate;
        return { ok: { row: row("a", 2, { name: "New" }) } };
      },
      list: () => ({ ok: initial }),
    });
    const key = seedPage(qc, initial);
    const { result } = renderHook(() => useUdcMutate("companies"), { wrapper });
    let promise: Promise<unknown> = Promise.resolve();
    act(() => {
      promise = result.current.mutateAsync({
        op: "update",
        id: "a",
        row: { name: "New" },
        expected_version: 1,
      });
    });
    await waitFor(() =>
      expect((qc.getQueryData(key) as ListResponse).rows[0]).toEqual(row("a", 1, { name: "New" })),
    );
    release();
    await act(async () => {
      await promise;
    });
    const after = qc.getQueryData(key) as ListResponse;
    expect(after.rows[0]).toEqual(row("a", 2, { name: "New" }));
    expect(after.rows[1]).toEqual(initial.rows[1]);
    expect(calls.find((c) => c.action === "mutate")?.body).toEqual({
      collection: "companies",
      op: "update",
      id: "a",
      row: { name: "New" },
      expected_version: 1,
    });
  });

  it("rolls back when the server refuses", async () => {
    const { wrapper, qc } = setup({
      mutate: () => ({
        err: { code: "validation_error", message: "invalid row", details: { problems: [] } },
      }),
      list: () => ({ ok: initial }),
    });
    const key = seedPage(qc, initial);
    const { result } = renderHook(() => useUdcMutate("companies"), { wrapper });
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ op: "update", id: "a", row: { name: "" } });
      } catch (e) {
        caught = e;
      }
    });
    expect(caught).toBeInstanceOf(UdcError);
    expect((qc.getQueryData(key) as ListResponse).rows[0]).toMatchObject({ name: "Old" });
  });

  it("surfaces version_conflict and puts the fresh row in the cache", async () => {
    const { wrapper, qc, calls } = setup({
      mutate: () => ({
        err: { code: "version_conflict", message: "stale", details: { current_version: 3 } },
      }),
      read: () => ({ ok: { row: row("a", 3, { name: "Theirs" }) } }),
      list: () => ({ ok: listOf([row("a", 3, { name: "Theirs" }), initial.rows[1] as never]) }),
    });
    const key = seedPage(qc, initial);
    const { result } = renderHook(() => useUdcMutate("companies"), { wrapper });
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          op: "update",
          id: "a",
          row: { name: "Mine" },
          expected_version: 1,
        });
      } catch (e) {
        caught = e;
      }
    });
    expect(isVersionConflict(caught)).toBe(true);
    await waitFor(() =>
      expect((qc.getQueryData(key) as ListResponse).rows[0]).toMatchObject({
        name: "Theirs",
        __meta: { version: 3 },
      }),
    );
    expect(calls.some((c) => c.action === "read" && c.body.id === "a")).toBe(true);
  });
});
