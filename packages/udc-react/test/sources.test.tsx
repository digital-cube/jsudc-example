import type { ViewConfig } from "@jsudc/core";
import { ViewConfigSchema } from "@jsudc/core";
import { UdcClient } from "@jsudc/core/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { ageText } from "../src/data-view/Freshness";
import { folderCrumbs, joinFolder, splitFolder } from "../src/data-view/folder";
import { DOC_TAB, useDataViewState } from "../src/data-view/useDataViewState";
import { Badges, badgeTone, formatBytes } from "../src/table/cells";
import { pollInterval, useUdcAllRows, useUdcCollection } from "../src/udc/hooks";
import { createUdcQueryClient, UdcProvider } from "../src/udc/provider";
import { listOf, mockUdcFetch, row } from "./fetchMock";

const caps = {
  mutate: false,
  subscribe: false,
  total_count: true,
  schema_edit: false,
  config_edit: false,
  reindex: false,
  tree_reparent: false,
  source_yaml: false,
  paging: ["offset" as const],
  supported_filter_ops: [],
};

describe("the Doc tab", () => {
  const view = (o: object = {}): ViewConfig =>
    ViewConfigSchema.parse({
      default_renderer: "cards",
      available_renderers: ["table", "cards"],
      ...o,
    });
  const at = (url: string, v: ViewConfig, doc: boolean) =>
    renderHook(() => useDataViewState("c", v, { doc }), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
      ),
    }).result;

  it("is selected by ?tab=doc when the collection has a README", () => {
    expect(at("/udc/c?tab=doc", view(), true).current.tab).toBe(DOC_TAB);
  });

  it("is never the default: the view's default_renderer opens", () => {
    expect(at("/udc/c", view(), true).current.tab).toBe("cards");
  });

  it("falls back to the default without a README", () => {
    expect(at("/udc/c?tab=doc", view(), false).current.tab).toBe("cards");
  });

  it("can be chosen with setTab", () => {
    const r = at("/udc/c", view(), true);
    act(() => r.current.setTab(DOC_TAB));
    expect(r.current.tab).toBe(DOC_TAB);
  });
});

function setup(handlers: Parameters<typeof mockUdcFetch>[0]) {
  const mock = mockUdcFetch(handlers);
  const client = new UdcClient({ httpUrl: "http://api", fetch: mock.fetch });
  const qc = createUdcQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <UdcProvider client={client}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </UdcProvider>
  );
  return { ...mock, wrapper };
}

const lists = (calls: { action: string }[]) => calls.filter((c) => c.action === "list").length;

describe("polling from refresh_interval_ms", () => {
  it("pollInterval: a positive number of ms, else off", () => {
    expect(pollInterval(60_000)).toBe(60_000);
    expect(pollInterval(undefined)).toBe(false);
    expect(pollInterval(0)).toBe(false);
  });

  it("useUdcCollection refetches on the interval and exposes fetched_at and stale", async () => {
    let n = 0;
    const { wrapper, calls } = setup({
      list: () => {
        n += 1;
        const fetched_at = new Date(Date.UTC(2026, 9, 28, 10, 0, n)).toISOString();
        return { ok: { ...listOf([row("a", 1, {})]), fetched_at, stale: n > 1 } };
      },
    });
    const { result } = renderHook(
      () =>
        useUdcCollection({ collection: "q", mode: "pages", pageLimit: 10, refetchInterval: 40 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.fetchedAt).toMatch(/^2026-10-28T10:/));
    await waitFor(() => expect(lists(calls)).toBeGreaterThanOrEqual(3), { timeout: 2000 });
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(Date.parse(result.current.fetchedAt ?? "")).toBeGreaterThan(
      Date.UTC(2026, 9, 28, 10, 0, 1),
    );
  });

  it("does not poll without an interval", async () => {
    const { wrapper, calls } = setup({ list: () => ({ ok: listOf([row("a", 1, {})]) }) });
    const { result } = renderHook(
      () => useUdcCollection({ collection: "q", mode: "pages", pageLimit: 10 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 150));
    expect(lists(calls)).toBe(1);
    expect(result.current.fetchedAt).toBeNull();
  });

  it("useUdcAllRows polls too, keeping the first page's freshness", async () => {
    const { wrapper, calls } = setup({
      list: () => ({
        ok: { ...listOf([row("a", 1, {})]), fetched_at: "2026-10-28T10:00:00.000Z" },
      }),
    });
    const { result } = renderHook(
      () => useUdcAllRows({ collection: "q", capabilities: caps, refetchInterval: 40 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.fetchedAt).toBe("2026-10-28T10:00:00.000Z"));
    await waitFor(() => expect(lists(calls)).toBeGreaterThanOrEqual(3), { timeout: 2000 });
  });
});

describe("an offset-only source", () => {
  const rows = Array.from({ length: 5 }, (_, i) => row(`r${i}`, 1, { n: i }));
  const handlers = {
    list: (body: Record<string, unknown>) => {
      const page = body.page as { limit: number; offset?: number; cursor?: string };
      if (page.cursor) return { err: { code: "unsupported_op", message: "offset only" } };
      const offset = page.offset ?? 0;
      return { ok: listOf(rows.slice(offset, offset + page.limit), rows.length, null) };
    },
  };

  it("infinite mode walks it by offset until total", async () => {
    const { wrapper, calls } = setup(handlers);
    const { result } = renderHook(
      () =>
        useUdcCollection({ collection: "f", mode: "infinite", pageLimit: 2, capabilities: caps }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));
    act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.rows).toHaveLength(5));
    expect(result.current.hasNextPage).toBe(false);
    expect(calls.filter((c) => c.action === "list").map((c) => c.body.page)).toEqual([
      { limit: 2 },
      { limit: 2, offset: 2 },
      { limit: 2, offset: 4 },
    ]);
  });

  it("useUdcAllRows reads every row by offset", async () => {
    const { wrapper, calls } = setup(handlers);
    const { result } = renderHook(
      () => useUdcAllRows({ collection: "f", capabilities: caps, max: 100 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(5));
    expect(result.current.capped).toBe(false);
    expect(calls.every((c) => !(c.body.page as { cursor?: string } | undefined)?.cursor)).toBe(
      true,
    );
  });
});

describe("folder navigation in the filter tree", () => {
  const search = { field: "name", op: "contains" as const, value: "x" };

  it("splits the folder condition off and joins it back", () => {
    expect(splitFolder(null, "path")).toEqual({ folder: null, rest: null });
    expect(splitFolder({ field: "path", op: "eq", value: "docs" }, "path")).toEqual({
      folder: "docs",
      rest: null,
    });
    const both = joinFolder(search, "path", "docs/archive");
    expect(both).toEqual({ and: [{ field: "path", op: "eq", value: "docs/archive" }, search] });
    expect(splitFolder(both, "path")).toEqual({ folder: "docs/archive", rest: search });
    expect(joinFolder(search, "path", "")).toEqual(search);
    expect(joinFolder(null, "path", null)).toBeNull();
    // A path condition the user built elsewhere (an or) is not the folder.
    const other = { or: [{ field: "path", op: "eq" as const, value: "a" }, search] };
    expect(splitFolder(other, "path")).toEqual({ folder: null, rest: other });
  });

  it("derives the breadcrumb from the folder", () => {
    expect(folderCrumbs(null)).toEqual([]);
    expect(folderCrumbs("docs/archive")).toEqual([
      { name: "docs", path: "docs" },
      { name: "archive", path: "docs/archive" },
    ]);
  });
});

describe("bytes and badge renders, freshness", () => {
  it("formats bytes in powers of 1024", () => {
    expect(formatBytes(0, "en")).toBe("0 B");
    expect(formatBytes(1023, "en")).toBe("1,023 B");
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
    expect(formatBytes(30_298, "en")).toBe("29.6 KB");
    expect(formatBytes(5 * 1024 * 1024, "en")).toBe("5 MB");
    expect(formatBytes(1536, "sr-Latn-RS")).toBe("1,5 KB");
  });

  it("tones a badge from render_options.map, else default, else muted", () => {
    const opts = { map: { red: "danger", green: "success", odd: "nope" }, default: "info" };
    expect(badgeTone("red", opts)).toBe("danger");
    expect(badgeTone("odd", opts)).toBe("info");
    expect(badgeTone("blue", { map: {} })).toBe("muted");
  });

  it("draws one pill per array element", () => {
    render(<Badges value={["udc", "react", null]} column={{ field: "topics", render: "badge" }} />);
    expect(screen.getAllByTestId("badge").map((b) => b.textContent)).toEqual(["udc", "react"]);
  });

  it("says how old a fetched copy is", () => {
    const at = "2026-10-28T10:00:00.000Z";
    const t = Date.parse(at);
    expect(ageText(at, t + 12_000, "en")).toBe("12 sec. ago");
    expect(ageText(at, t + 185_000, "en")).toBe("3 min. ago");
    expect(ageText(at, t + 7_300_000, "en")).toBe("2 hr. ago");
  });
});
