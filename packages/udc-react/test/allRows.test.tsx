import type { FilterNode } from "@jsudc/core";
import { UdcClient } from "@jsudc/core/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { fetchAllRows, useUdcAllRows } from "../src/udc/hooks";
import { udcKeys } from "../src/udc/keys";
import { createUdcQueryClient, UdcProvider } from "../src/udc/provider";
import { listOf, mockUdcFetch, row } from "./fetchMock";

const ROWS = Array.from({ length: 7 }, (_, i) => row(`r${i}`, 1, { n: i }));

/** A server over ROWS that pages by cursor (`c<offset>`) and by offset. */
function server(opts: { cursor: boolean } = { cursor: true }) {
  return mockUdcFetch({
    list: (body) => {
      const page = body.page as { limit: number; cursor?: string; offset?: number };
      const start = page.cursor ? Number(page.cursor.slice(1)) : (page.offset ?? 0);
      const rows = ROWS.slice(start, start + page.limit);
      const end = start + rows.length;
      const next = opts.cursor && end < ROWS.length ? `c${end}` : null;
      return { ok: listOf(rows, ROWS.length, next) };
    },
  });
}

const clientOf = (mock: ReturnType<typeof server>) =>
  new UdcClient({ httpUrl: "http://api", fetch: mock.fetch });
const pages = (mock: ReturnType<typeof server>) => mock.calls.map((c) => c.body.page);

describe("fetchAllRows", () => {
  it("follows the cursor until total", async () => {
    const mock = server();
    const res = await fetchAllRows(clientOf(mock), {
      collection: "x",
      max: 100,
      pageLimit: 3,
      cursor: true,
    });
    expect(res.rows.map((r) => r.__meta.id)).toEqual(ROWS.map((r) => r.__meta.id));
    expect(res.total).toBe(7);
    expect(pages(mock)).toEqual([
      { limit: 3 },
      { limit: 3, cursor: "c3" },
      { limit: 3, cursor: "c6" },
    ]);
  });

  it("stops at the cap, asking only for what is left", async () => {
    const mock = server();
    const res = await fetchAllRows(clientOf(mock), {
      collection: "x",
      max: 5,
      pageLimit: 3,
      cursor: true,
    });
    expect(res.rows).toHaveLength(5);
    expect(res.total).toBe(7);
    expect(pages(mock)).toEqual([{ limit: 3 }, { limit: 2, cursor: "c3" }]);
  });

  it("pages by offset when the source has no cursor", async () => {
    const mock = server({ cursor: false });
    const res = await fetchAllRows(clientOf(mock), {
      collection: "x",
      max: 100,
      pageLimit: 3,
      cursor: false,
    });
    expect(res.rows).toHaveLength(7);
    expect(pages(mock)).toEqual([
      { limit: 3, offset: 0 },
      { limit: 3, offset: 3 },
      { limit: 3, offset: 6 },
    ]);
  });

  it("falls back to offset when a cursor source answers no cursor mid-way", async () => {
    const mock = server({ cursor: false });
    const res = await fetchAllRows(clientOf(mock), {
      collection: "x",
      max: 100,
      pageLimit: 4,
      cursor: true,
    });
    expect(res.rows).toHaveLength(7);
    expect(pages(mock)).toEqual([{ limit: 4 }, { limit: 4, offset: 4 }]);
  });

  it("reports progress and passes filter and sort", async () => {
    const mock = server();
    const seen: number[] = [];
    const filter: FilterNode = { field: "n", op: "gte", value: 0 };
    await fetchAllRows(clientOf(mock), {
      collection: "x",
      filter,
      sort: [{ field: "n" }],
      max: 100,
      pageLimit: 4,
      cursor: true,
      onProgress: (n) => seen.push(n),
    });
    expect(seen).toEqual([4, 7]);
    expect(mock.calls[0]?.body).toMatchObject({ collection: "x", filter, sort: [{ field: "n" }] });
  });
});

describe("useUdcAllRows", () => {
  function setup(cursor: boolean) {
    const mock = server({ cursor });
    const client = clientOf(mock);
    const qc = createUdcQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <UdcProvider client={client}>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </UdcProvider>
    );
    return { mock, qc, wrapper };
  }

  it("uses offset when the capabilities say the source pages by offset only", async () => {
    const { mock, wrapper } = setup(false);
    const { result } = renderHook(
      () => useUdcAllRows({ collection: "x", capabilities: { paging: ["offset"] }, max: 100 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(7));
    expect(result.current).toMatchObject({ total: 7, capped: false, progress: null });
    expect(pages(mock)).toEqual([{ limit: 100, offset: 0 }]);
  });

  it("says when the cap cut the rows short, and lives under the collection's lists", async () => {
    const { qc, wrapper } = setup(true);
    const { result } = renderHook(() => useUdcAllRows({ collection: "x", max: 4 }), { wrapper });
    await waitFor(() => expect(result.current.rows).toHaveLength(4));
    expect(result.current.capped).toBe(true);
    // Under udcKeys.lists(x): useUdcMutate's optimistic patches and invalidations reach it.
    expect(qc.getQueriesData({ queryKey: udcKeys.lists("x") })).toHaveLength(1);
  });
});
