import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CollectionListing, Row } from "@jsudc/udc-core";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Circle, Kanban, Users } from "lucide-react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { I18nProvider } from "../src/i18n/i18n";
import { LUCIDE_ICONS } from "../src/icons/lucide.generated";
import { FALLBACK_ICON, resolveIcon } from "../src/icons/resolve";
import { ThemeProvider } from "../src/lib/theme";
import { readmeIntro } from "../src/shell/AboutPage";
import { AppShell } from "../src/shell/AppShell";
import {
  activeLeaf,
  buildMenu,
  loadMenuExpanded,
  MENU_EXPAND_KEY,
  menuLabel,
  parseMenuUrl,
  saveMenuExpanded,
  visibleItems,
  withOpen,
} from "../src/shell/menu";
import { TimezoneProvider } from "../src/time/timezone";
import { UdcClient } from "../src/udc/client";
import { createUdcQueryClient, UdcProvider } from "../src/udc/provider";
import { listOf, mockUdcFetch } from "./fetchMock";

const caps = {
  mutate: false,
  subscribe: false,
  total_count: true,
  schema_edit: false,
  config_edit: false,
  reindex: false,
  tree_reparent: false,
  source_yaml: true,
  paging: ["offset" as const],
  supported_filter_ops: [],
};

const listing = (name: string, extra: Partial<CollectionListing> = {}): CollectionListing => ({
  name,
  default_renderer: "table",
  capabilities: caps,
  source_kind: "postgres_jsonb",
  group: "database",
  ...extra,
});

/** A menu row as the yaml_menu source flattens it; ids are the path, for readability. */
function node(path: string, order: number, fields: Record<string, unknown> = {}): Row {
  const codes = path.split("/");
  const ancestors = codes.slice(0, -1).map((_, i) => codes.slice(0, i + 1).join("/"));
  return {
    __meta: { id: path, version: 1 },
    code: codes.at(-1),
    translation_key: null,
    icon: null,
    url: null,
    parent_id: ancestors.at(-1) ?? null,
    order,
    depth: ancestors.length,
    ancestor_ids: ancestors,
    children_count: 0,
    is_dynamic: false,
    ...fields,
  };
}

// Out of order on purpose: the tree sorts siblings by `order`.
const ROWS: Row[] = [
  node("VIEWS", 2, { translation_key: "MENU_VIEWS", icon: "lucide:layout-grid" }),
  node("HOME", 0, { translation_key: "MENU_HOME", icon: "lucide:house", url: "/" }),
  node("COLLECTIONS", 1, { translation_key: "MENU_COLLECTIONS", icon: "lucide:layers" }),
  node("COLLECTIONS/DATABASE", 0, { translation_key: "MENU_DATABASE" }),
  node("COLLECTIONS/DATABASE/COLLECTION_TICKETS", 1, {
    translation_key: "COLLECTIONS_TICKETS",
    icon: "lucide:kanban",
    url: "/udc/tickets",
    is_dynamic: true,
  }),
  node("COLLECTIONS/DATABASE/COLLECTION_COMPANIES", 0, {
    translation_key: "COLLECTIONS_COMPANIES",
    icon: "lucide:no-such-icon",
    url: "/udc/companies",
    is_dynamic: true,
  }),
  node("VIEWS/TICKETS_KANBAN", 0, {
    translation_key: "MENU_VIEW_TICKETS",
    icon: "lucide:kanban",
    url: "/udc/tickets?tab=kanban",
  }),
  node("VIEWS/DOC_ORG", 1, { translation_key: "UNTRANSLATED_THING", url: "/udc/org?tab=doc" }),
  node("VIEWS/ORG_PLAIN", 2, { translation_key: "MENU_ORG", url: "/udc/org/" }),
  node("COLLECTIONS/DATABASE/COLLECTION_ORG", 2, {
    translation_key: "COLLECTIONS_ORG",
    url: "/udc/org",
    is_dynamic: true,
  }),
  node("ORPHAN", 0, { parent_id: "NOWHERE", url: "/x" }),
];

const EN: Record<string, string> = { "MENU.HOME": "Home", "COLLECTIONS.TICKETS": "Tickets" };
const tEn = (section: string, term: string) => EN[`${section}.${term}`] ?? null;

const built = () => buildMenu(ROWS, (key, code) => menuLabel(key, code, tEn));

describe("menu labels (label_i18n)", () => {
  it("splits on the first underscore and reads t(section, term)", () => {
    expect(menuLabel("MENU_HOME", "HOME", tEn)).toBe("Home");
    expect(menuLabel("COLLECTIONS_TICKETS", "X", tEn)).toBe("Tickets");
  });

  it("falls back to the raw key, and to the code without one", () => {
    expect(menuLabel("UNTRANSLATED_THING", "X", tEn)).toBe("UNTRANSLATED_THING");
    expect(menuLabel("NOUNDERSCORE", "X", tEn)).toBe("NOUNDERSCORE");
    expect(menuLabel(null, "CODE", tEn)).toBe("CODE");
  });
});

describe("icon resolution", () => {
  it("resolves lucide:<kebab-name> and the bare legacy names", () => {
    expect(resolveIcon("lucide:kanban")).toBe(LUCIDE_ICONS.kanban);
    expect(LUCIDE_ICONS.kanban).toBe(Kanban);
    expect(resolveIcon("users")).toBe(Users);
  });

  it("falls back to a circle for an unknown name, nothing for no name", () => {
    expect(FALLBACK_ICON).toBe(Circle);
    expect(resolveIcon("lucide:no-such-icon")).toBe(Circle);
    expect(resolveIcon("whatever")).toBe(Circle);
    expect(resolveIcon(null)).toBeNull();
    expect(resolveIcon("")).toBeNull();
    expect(resolveIcon(42)).toBeNull();
  });

  it("the generated map has every lucide: name the collections reference", () => {
    const dir = join(import.meta.dirname, "..", "..", "backend", "collections");
    const names = new Set<string>();
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ya?ml|json)$/.test(n)) {
          for (const m of readFileSync(p, "utf8").matchAll(/lucide:([a-z0-9-]+)/g)) {
            names.add(m[1] as string);
          }
        }
      }
    };
    walk(dir);
    expect(names.size).toBeGreaterThan(10);
    const missing = [...names].filter((n) => !(n in LUCIDE_ICONS));
    expect(missing, "run npm run generate:icons -w @jsudc/frontend").toEqual([]);
  });
});

describe("the menu tree from flat rows", () => {
  it("nests children under their parent, siblings by order, orphans dropped", () => {
    const items = built();
    expect(items.map((i) => i.code)).toEqual(["HOME", "COLLECTIONS", "VIEWS"]);
    const db = items[1]?.children[0];
    expect(db?.code).toBe("DATABASE");
    expect(db?.children.map((c) => [c.code, c.isDynamic])).toEqual([
      ["COLLECTION_COMPANIES", true],
      ["COLLECTION_TICKETS", true],
      ["COLLECTION_ORG", true],
    ]);
    expect(items[0]).toMatchObject({ label: "Home", icon: "lucide:house", url: "/" });
    expect(db?.children[1]?.label).toBe("Tickets");
  });

  it("lists what is on screen: roots and the children of open items", () => {
    const items = built();
    const codes = (open: string[]) => visibleItems(items, new Set(open)).map((i) => i.code);
    expect(codes([])).toEqual(["HOME", "COLLECTIONS", "VIEWS"]);
    expect(codes(["COLLECTIONS"])).toEqual(["HOME", "COLLECTIONS", "DATABASE", "VIEWS"]);
    // A closed parent hides an open child.
    expect(codes(["COLLECTIONS/DATABASE"])).toEqual(["HOME", "COLLECTIONS", "VIEWS"]);
  });
});

describe("the active leaf", () => {
  const at = (pathname: string, search = "") => activeLeaf(built(), { pathname, search })?.id;

  it("parses a menu url into a path and a tab", () => {
    expect(parseMenuUrl("/udc/tickets?tab=kanban")).toEqual({
      pathname: "/udc/tickets",
      tab: "kanban",
    });
    expect(parseMenuUrl("/udc/tickets/")).toEqual({ pathname: "/udc/tickets", tab: null });
  });

  it("without ?tab= in its url a leaf matches the path on any tab", () => {
    expect(at("/udc/tickets")).toBe("COLLECTIONS/DATABASE/COLLECTION_TICKETS");
    expect(at("/udc/companies", "?tab=map&q=x")).toBe("COLLECTIONS/DATABASE/COLLECTION_COMPANIES");
    expect(at("/udc/tickets", "?tab=table")).toBe("COLLECTIONS/DATABASE/COLLECTION_TICKETS");
  });

  it("with ?tab= it needs that tab, and then beats the plain one", () => {
    expect(at("/udc/tickets", "?tab=kanban")).toBe("VIEWS/TICKETS_KANBAN");
    expect(at("/udc/tickets", "?q=a&tab=kanban")).toBe("VIEWS/TICKETS_KANBAN");
    expect(at("/udc/org", "?tab=doc")).toBe("VIEWS/DOC_ORG");
    expect(at("/udc/tickets", "?tab=calendar")).toBe("COLLECTIONS/DATABASE/COLLECTION_TICKETS");
  });

  it("a written leaf beats a dynamic one on the same path, trailing slash or not", () => {
    expect(at("/udc/org")).toBe("VIEWS/ORG_PLAIN");
    expect(at("/udc/org/", "?tab=tree&q=x")).toBe("VIEWS/ORG_PLAIN");
  });

  it("matches the root path, and nothing elsewhere", () => {
    expect(at("/")).toBe("HOME");
    expect(at("/udc/nothing")).toBeUndefined();
  });
});

describe("expand persistence", () => {
  it("round-trips the open ids under udc:menu:expanded", () => {
    expect(loadMenuExpanded()).toBeNull();
    saveMenuExpanded(["a", "b"]);
    expect(localStorage.getItem(MENU_EXPAND_KEY)).toBe('["a","b"]');
    expect(loadMenuExpanded()).toEqual(["a", "b"]);
    localStorage.setItem(MENU_EXPAND_KEY, "{not json");
    expect(loadMenuExpanded()).toBeNull();
    localStorage.setItem(MENU_EXPAND_KEY, '["a", 3, null]');
    expect(loadMenuExpanded()).toEqual(["a"]);
  });

  it("adds ids once, and keeps the array when nothing is new", () => {
    const open = ["a"];
    expect(withOpen(open, ["a"])).toBe(open);
    expect(withOpen(open, ["b", "a", "c"])).toEqual(["a", "b", "c"]);
  });
});

describe("the about page", () => {
  it("is the README's first section, relative links as text", () => {
    const md =
      "# x\n\nSee [core](packages/core) and [web](https://example.com).\n\n## Layout\nrest";
    expect(readmeIntro(md)).toBe("# x\n\nSee core and [web](https://example.com).");
  });
});

// --- the sidebar in the shell ---------------------------------------------------------

function renderShell(url: string, collections: CollectionListing[], rows: Row[] = ROWS) {
  const mock = mockUdcFetch({
    collections: () => ({ ok: { collections } }),
    list: () => ({ ok: listOf(rows) }),
  });
  const client = new UdcClient({ httpUrl: "", fetch: mock.fetch });
  const view = render(
    <ThemeProvider>
      <I18nProvider>
        <TimezoneProvider>
          <UdcProvider client={client}>
            <QueryClientProvider client={createUdcQueryClient()}>
              <TooltipProvider>
                <MemoryRouter initialEntries={[url]}>
                  <Routes>
                    <Route element={<AppShell />}>
                      <Route path="*" element={<div data-testid="page" />} />
                    </Route>
                  </Routes>
                </MemoryRouter>
              </TooltipProvider>
            </QueryClientProvider>
          </UdcProvider>
        </TimezoneProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
  return { mock, view };
}

const MENU_LISTING = listing("menu", { source_kind: "yaml_menu", group: "files" });

describe("the sidebar", () => {
  it("is drawn from the menu collection when the server serves one", async () => {
    const { mock } = renderShell("/udc/companies", [listing("companies"), MENU_LISTING]);
    const tree = await screen.findByTestId("menu-tree");
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-sidebar", "menu");
    expect(mock.calls.find((c) => c.action === "list")?.body.collection).toBe("menu");
    // The way to the active leaf is opened, the leaf highlighted.
    const active = await within(tree).findByTestId("nav-companies");
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveAttribute("data-active", "true");
    expect(within(tree).getByTestId("menu-HOME")).toHaveTextContent("Home");
    expect(within(tree).getByTestId("menu-COLLECTIONS")).toHaveAttribute("aria-expanded", "true");
    expect(within(tree).getByTestId("menu-VIEWS")).toHaveAttribute("aria-expanded", "false");
    // An unknown icon still draws (the fallback), with the name kept.
    expect(within(active).getByTestId("menu-icon")).toHaveAttribute(
      "data-icon",
      "lucide:no-such-icon",
    );
    expect(JSON.parse(localStorage.getItem(MENU_EXPAND_KEY) ?? "[]")).toEqual([
      "COLLECTIONS",
      "COLLECTIONS/DATABASE",
    ]);
  });

  it("toggles a branch, persists it, and opens it again on the next mount", async () => {
    const first = renderShell("/udc/companies", [MENU_LISTING]);
    fireEvent.click(await screen.findByTestId("menu-VIEWS"));
    expect(await screen.findByTestId("menu-TICKETS_KANBAN")).toBeInTheDocument();
    expect(loadMenuExpanded()).toContain("VIEWS");
    first.view.unmount();

    renderShell("/", [MENU_LISTING]);
    expect(await screen.findByTestId("menu-TICKETS_KANBAN")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("menu-VIEWS"));
    await waitFor(() => expect(screen.queryByTestId("menu-TICKETS_KANBAN")).toBeNull());
    expect(loadMenuExpanded()).not.toContain("VIEWS");
  });

  it("highlights the Views leaf on its tab, not the collection's", async () => {
    renderShell("/udc/tickets?tab=kanban", [MENU_LISTING]);
    const leaf = await screen.findByTestId("menu-TICKETS_KANBAN");
    expect(leaf).toHaveAttribute("aria-current", "page");
    expect(screen.queryByTestId("nav-tickets")).toBeNull();
  });

  it("moves with the arrow keys as the tree renderer does", async () => {
    renderShell("/", [MENU_LISTING]);
    const home = await screen.findByTestId("menu-HOME");
    home.focus();
    fireEvent.keyDown(home, { key: "ArrowDown" });
    const coll = screen.getByTestId("menu-COLLECTIONS");
    expect(coll).toHaveFocus();
    fireEvent.keyDown(coll, { key: "ArrowRight" });
    expect(await screen.findByTestId("menu-DATABASE")).toBeInTheDocument();
    fireEvent.keyDown(coll, { key: "ArrowRight" });
    expect(screen.getByTestId("menu-DATABASE")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("menu-DATABASE"), { key: "ArrowLeft" });
    expect(coll).toHaveFocus();
    fireEvent.keyDown(coll, { key: "ArrowLeft" });
    await waitFor(() => expect(screen.queryByTestId("menu-DATABASE")).toBeNull());
  });

  it("falls back to the grouped sidebar when the menu collection is absent", async () => {
    const { mock } = renderShell("/udc/companies", [
      listing("companies"),
      listing("files", { source_kind: "filesystem", group: "files" }),
    ]);
    expect(await screen.findByTestId("nav-group-database")).toBeInTheDocument();
    expect(screen.getByTestId("nav-group-files")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-sidebar", "groups");
    expect(screen.queryByTestId("menu-tree")).toBeNull();
    expect(mock.calls.some((c) => c.action === "list")).toBe(false);
  });
});
