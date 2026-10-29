# @jsudc/react

React components for UDC (Universal Data Collection) collections. Give it a
collection name and `<UdcDataView>` asks a UDC server what the collection is
(`describe`) and draws it: search, filter chips and a filter builder, paging,
and one tab per renderer the view declares — **table**, **cards**, **kanban**,
**calendar**, **tree**, **map** and **chart** — with inline edits, drag and
drop, and a schema editor that adds, edits and deletes columns at runtime.

What is in the package:

- **`UdcProvider`** and **`createUdcQueryClient`**, and TanStack Query hooks over
  the transport client of [`@jsudc/core`](https://github.com/digital-cube/jsudc-core)
  (`useUdcCollections`, `useUdcDescribe`, `useUdcCollection`, `useUdcAllRows`,
  `useUdcMutate`, `useUdcSchema`, `useUdcSource`);
- **`UdcDataView`** and the renderer registry **`RENDERERS`** with its types;
- **`UdcI18nProvider`** + **`useI18n`**: the library's strings in English and
  Serbian, with your own sections, overrides and locales layered over them;
- **`ThemeProvider`** + **`useTheme`** (light / dark), **`TimezoneProvider`**
  (the zone instants are shown in);
- the UI primitives the renderers are built from (Radix + Tailwind, the shadcn
  pattern): `Button`, `Input`, `Checkbox`, `Select`, `Dialog`, `DropdownMenu`,
  `Popover`, `Tip`, `Segmented`, `Spinner`, `Skeleton`, and the `Toaster` and
  `TooltipProvider` the data view needs;
- **`styles.css`**, compiled at build time, and **`tokens.css`**, its raw source.

```sh
npm install @jsudc/react @jsudc/core \
  react react-dom react-router @tanstack/react-query @tanstack/react-table \
  radix-ui lucide-react leaflet recharts @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
# before the npm release, from a tag:
npm install github:digital-cube/jsudc-core#v0.1.0 github:digital-cube/jsudc-react#v0.1.0
```

## Quick start

```tsx
import "@jsudc/react/styles.css";
import { UdcClient } from "@jsudc/core/client";
import {
  createUdcQueryClient,
  Toaster,
  TooltipProvider,
  UdcDataView,
  UdcI18nProvider,
  UdcProvider,
} from "@jsudc/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

const client = new UdcClient({ httpUrl: "" }); // same origin; or "https://api.example.com"

createRoot(document.getElementById("root") as HTMLElement).render(
  <UdcProvider client={client}>
    <QueryClientProvider client={createUdcQueryClient()}>
      <UdcI18nProvider>
        <TooltipProvider>
          <Toaster>
            <BrowserRouter>
              <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
                <UdcDataView collection="companies" />
              </div>
            </BrowserRouter>
          </Toaster>
        </TooltipProvider>
      </UdcI18nProvider>
    </QueryClientProvider>
  </UdcProvider>,
);
```

The server is any UDC server, for example
[`@jsudc/server`](https://github.com/digital-cube/jsudc-server). It must be
same-origin, behind your dev server's proxy, or send CORS headers itself: the
client `POST`s JSON to `<httpUrl>/udc/<action>`.

`<UdcDataView>` fills its parent as a flex column (`flex: 1`, `min-height: 0`),
so give the parent a height. Key it by collection
(`<UdcDataView key={name} collection={name} />`) when one route shows many
collections, so each one starts from a fresh view.

### The providers a host wraps

| Provider                                                          | Needed | Why                                                                                                                                 |
| ----------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `UdcProvider client={new UdcClient(...)}`                         | yes    | every hook reads the client from it                                                                                                 |
| `QueryClientProvider client={createUdcQueryClient()}`             | yes    | the hooks are TanStack Query; `createUdcQueryClient` retries transport failures only, never a protocol error                        |
| `UdcI18nProvider`                                                 | yes    | every string goes through `useI18n()`                                                                                               |
| `TooltipProvider`                                                 | yes    | Radix tooltips on headers, chips and buttons                                                                                        |
| `Toaster`                                                         | yes    | save, conflict and schema-edit toasts (`useToast`)                                                                                  |
| a react-router router (`BrowserRouter`, `createBrowserRouter`, …) | yes    | search, filters, sort, paging and the tab live in the URL (`useSearchParams`)                                                       |
| `TimezoneProvider`                                                | no     | without it instants are shown in the browser's zone; with it the user's pick, kept in `localStorage` (`udc-tz`)                     |
| `ThemeProvider`                                                   | no     | `useTheme()` toggles the `dark` class on `<html>` and keeps the choice (`udc-theme`); any other way of setting that class works too |

## Peer dependencies

Everything the components import that a host is likely to have too is a peer,
so there is one copy of it in the bundle:

- `react`, `react-dom` ^19 — one React, or hooks break;
- `@tanstack/react-query` ^5 — one `QueryClient` context, shared with the
  host's own queries;
- `react-router` ^7 — the view keeps its state in the host's router;
- `@tanstack/react-table`, `radix-ui`, `lucide-react` — the table and the
  primitives;
- `leaflet` (map), `recharts` (chart), `@dnd-kit/core`, `@dnd-kit/sortable`,
  `@dnd-kit/utilities` (kanban, tree) — the renderers.

All of them are required in 0.1: the registry imports every renderer. Optional
renderer subpaths (`@jsudc/react/map`, `@jsudc/react/chart`) that let a host
skip Leaflet or Recharts are planned. The regular dependencies are
`@jsudc/core`, `clsx`, `tailwind-merge` and `marked` (the Doc tab).

The map renderer imports `leaflet/dist/leaflet.css` itself; your bundler picks
it up from the `leaflet` you installed.

## Styles

A host **without Tailwind** imports the compiled stylesheet once and is done:

```ts
import "@jsudc/react/styles.css";
```

It holds Tailwind's preflight, every utility the components use, the design
tokens of both themes and the library's few rules of its own.

A host that **runs Tailwind v4 itself** imports the raw tokens into its own
build instead, and lets Tailwind scan the package, so there is one preflight and
one utilities layer:

```css
@import "tailwindcss";
@import "@jsudc/react/tokens.css";
@source "../node_modules/@jsudc/react/dist";
```

### Theming

Every colour comes from a CSS variable on `:root` and
`.dark`. Restyling is redefining them after the stylesheet — no code:

```css
:root {
  --primary: oklch(0.55 0.2 150);
  --primary-foreground: white;
}
.dark {
  --background: oklch(0.12 0.01 150);
}
```

The variables are `--background`, `--foreground`, `--surface`,
`--surface-raised`, `--muted`, `--muted-foreground`, `--border`,
`--border-strong`, `--input`, `--ring`, `--primary`, `--primary-foreground`,
`--hover`, `--selected`, the semantic tones `--sem-{accent,success,warning,danger,info,muted}`
and their `-bg` pairs, and `--chart-1` … `--chart-8` (see `dist/tokens.css`). Dark mode is
the `dark` class on any ancestor, usually `<html>`. The font is `Inter
Variable` when the host loads it (`@fontsource-variable/inter`), else the
system UI font.

## i18n

`UdcI18nProvider` ships the library's strings (section `APP`) in `en` and `sr`.
`t(section, term)` looks in the field labels of the collection's schema first,
then in your `messages`, then in the library's dictionary, in the current
locale and then in English; a term found nowhere is humanised (`revenue_eur` →
`Revenue eur`).

```tsx
import { type Messages, UdcI18nProvider } from "@jsudc/react";

const messages: Messages = {
  // the collection's title, and its own field labels and strings
  COLLECTIONS: { COMPANIES: { en: "Companies", sr: "Preduzeća" } },
  TBL_COMPANIES: {
    __DESCRIPTION: { en: "Our customers", sr: "Naši klijenti" },
    REVENUE_EUR: { en: "Revenue (EUR)", sr: "Prihod (EUR)" },
  },
  // override one library string, in one locale
  APP: { RETRY: { en: "Reload" } },
};

<UdcI18nProvider messages={messages}>…</UdcI18nProvider>;
```

- Sections are `COLLECTIONS` (titles), `TBL_<COLLECTION>` (a collection's
  field labels — term = field name upper-cased — plus `__DESCRIPTION` under
  the title and `SEARCH_PLACEHOLDER`) and `APP`.
- **Another locale** is just strings in it: add `de` to the terms you translate
  and it is offered (`useI18n().locales` is `en`, `sr` and every locale your
  messages use); missing terms fall back to English. `Intl` formats with the
  locale tag as it is (`en` → `en-US` and `sr` → `sr-Latn-RS` are mapped).
- **Who owns the locale**: by default the provider does, remembered in
  `localStorage` (`udc-locale`). Pass `locale` and `onLocaleChange` to keep it in
  your own state, a URL or a user profile.
- `useI18n()` gives `t`, `tMaybe` (`null` when missing), `locale`,
  `intlLocale`, `locales` and `setLocale` to your own components too.

## API

Everything is exported from the package root; see `dist/index.d.ts`. Beyond
the above: `RENDERERS`, `rendererTabs`, `resolveTab` and the `RendererProps` /
`RendererEntry` types; `EmptyState` / `ErrorState`; `mergeMessages`, `makeT`,
`lookup`, `schemaLabelTerms`, `tableSection`, `TRANSLATIONS`, `LOCALES`;
`cn`, `storage`, `humanize`; `resolveIcon` with the `lucide:<name>` icons the
package bundles (`LUCIDE_ICONS`); and the zone helpers `allZones`,
`offsetLabel`, `zoneCity`.

The build is ESM only, one file per source module (tree-shakeable), with
`.d.ts` files next to them; every dependency and peer stays an import.

## Develop

```sh
nvm use          # Node 24
npm install      # also builds dist (prepare)
npm run typecheck
npm run lint     # Biome
npm test         # Vitest + Testing Library in jsdom, no server needed
npm run build    # vite build (lib mode) + tsc (.d.ts) + Tailwind CLI (dist/styles.css)
```

## License

MIT, see [LICENSE](LICENSE).
