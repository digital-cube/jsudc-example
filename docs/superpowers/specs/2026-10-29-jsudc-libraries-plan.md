# jsudc as open-source libraries — plan

**Date:** 2026-10-29. **Status:** draft for Igor's review. Written in the Root
chat of the thilo board, from the code on `main` at `44d5f42`.

## 1. Intent

jsudc today is one application: `packages/udc-core` + `backend/` +
`frontend/`, deployed as the dev stack at `jsudc.igor.digitalcube.work`. The
decision (Igor, 2026-10-29) is:

- the application is **not** the product. It is the example of how the
  libraries are used, and it moves to its own repository, `jsudc-example`;
- the product is a family of **open-source npm libraries** under one name:
  `jsudc-core`, `jsudc-server`, `jsudc-react` now; `jsudc-react-native`,
  `jsudc-angular` and possibly more in the next phase, with a second example
  app `jsudc-mobile-example` for React Native;
- DigitalCube's own projects consume them from npm like anybody else;
- the libraries get a **website** (domain to be bought; `jsudc.*` is free in
  every TLD checked) with docs and the live example;
- the React library must be **easy to restyle** and must work with any design
  system — shadcn, Material, Ant, or the house style used today — and the
  examples must prove it.

UDC stands for **Universal Data Collections**.

## 2. Where we are (what the code says)

| Part | Lines | Library-ready? | Coupled to the demo by |
|---|---|---|---|
| `packages/udc-core` | 2.7k | yes: `exports`, `dist`, `files`, only `zod` | nothing (`private: true`, no scope, no licence) |
| `backend/src` | 4.0k | internally yes: `buildApp`, `createDispatcher`, `CollectionRegistry`, `makeSource`, five sources, `seedCollection`, `schema-store` know no collection name | `main.ts`, `config.ts`, `cli/`, `db/schema.ts` (8 demo tables), 5 drizzle migrations, `scripts/generate-*`; runs from `src` via `tsx`, no `dist` |
| `frontend/src` | 15.4k | internally yes: renderers, data view, schema editor, `udc/` client know no collection name | `App.tsx` routes, `shell/`, `AboutPage`, demo strings in `i18n/translations.ts`, `index.html`, Vite proxy; no library build; Tailwind v4 classes in 53 files over custom `@theme` tokens; `useDataViewState` uses react-router's `useSearchParams` |
| `frontend/src/udc/client.ts` | small | framework-free: imports only `@jsudc/udc-core`, uses `fetch` | — |

Also true: the repo has **no git remote, no LICENSE, no CI**. npm cannot
install a sub-directory of a GitHub repository, so "install from our GitHub"
only works with one repository per package or a registry.

Availability checked 2026-10-29 (RDAP / registry HTTP):

- npm: `jsudc`, `jsudc-core`, `jsudc-server`, `jsudc-react`, `@jsudc/core`,
  `udc-core`, `udc-react` are free; `udc` is taken (v1.0.1, unrelated).
- GitHub: no user or org named `jsudc`.
- npm org `jsudc`: no such org.
- Domains not registered: `jsudc.com .org .net .dev .io .app`, `udc.dev`,
  `udc.io`, `universaldatacollections.com`.

## 3. Target shape

### 3.1 Packages (npm, public, scope `@jsudc`)

| Package | Repository | Contents | Peer deps |
|---|---|---|---|
| `@jsudc/core` | `jsudc-core` | the protocol: envelopes, filter DSL + evaluator, schema/view/source types, action payloads, row validation, and the **transport client** (`@jsudc/core/client`) | `zod` |
| `@jsudc/server` | `jsudc-server` | dispatcher, registry, sources (postgres_jsonb, memory, filesystem, http_api, yaml_menu), schema store + edits, Fastify plugin, seeding, the UDC-owned SQL | `fastify`, `drizzle-orm`, `pg`, `zod` |
| `@jsudc/react` | `jsudc-react` | hooks, data-view state, the eight renderers, schema editor, i18n, theme tokens, the default UI kit, compiled CSS | `react`, `react-dom`, `@tanstack/react-query`; optional: `@tanstack/react-table`, `leaflet`, `recharts`, `@dnd-kit/*`, `radix-ui` (see §4.3) |
| `@jsudc/react-native` (phase 2) | `jsudc-react-native` | hooks (shared with react), RN renderers | `react-native`, `@tanstack/react-query` |
| `@jsudc/angular` (phase 2) | `jsudc-angular` | Angular services + components | `@angular/*` |

Scope `@jsudc/*` is **my call**: unscoped `jsudc-core` works too, but the
scope reserves the whole family at once and the npm org is free. Repository
names stay `jsudc-core` etc. as Igor wrote them.

### 3.2 Repositories (GitHub, public)

Phase 1: `jsudc-core`, `jsudc-server`, `jsudc-react`, `jsudc-example`,
`jsudc-website`. Phase 2: `jsudc-react-native`, `jsudc-angular`,
`jsudc-mobile-example`.

One repository per package, as Igor asked, which matches how DigitalCube's
other shared libraries (memento, vola, udc, rul) are kept. The cost is the
development loop across packages (a change to core needs a local link or a
prerelease before server/react can use it); §5 keeps the extraction inside
this monorepo until the three packages are proven, and only then splits.

`jsudc-example` is this repository's `backend/` + `frontend/` + `deploy/` +
`docs/demo.md`, with the packages installed from npm. The website is its own
repo so docs releases do not depend on app releases.

### 3.3 Versioning and release

- The three phase-1 packages share one semver line and release together:
  the protocol in core must match on both sides. Start at `0.1.0`; `1.0.0`
  when the protocol is frozen.
- Each repo: GitHub Actions (typecheck, lint, test; Postgres service for
  server), Changesets for the changelog, publish on tag with npm provenance
  (OIDC trusted publishing, no long-lived token).
- Registry: **npmjs.org public**, not GitHub Packages (which demands a token
  even for public installs). GitHub stays the home of the source.

## 4. Architecture decisions

### 4.1 Core owns the client

`frontend/src/udc/client.ts` (fetch + envelope + `UdcError`) moves into
`@jsudc/core` as subpath `@jsudc/core/client`. Reason: React Native and
Angular need exactly that and nothing React. Query keys stay in react.

### 4.2 Server owns only UDC objects in the database

The library ships SQL for `udc_schema_revisions` and the `udc_date` /
`udc_timestamptz` cast functions, exposed two ways: a `migrations/` folder a
host copies into its own drizzle/knex/flyway tree, and
`ensureUdcSchema(db)` for hosts without migrations. A host creates each
collection table with the exported `collectionTable(name)` (drizzle) or
`createCollectionTableSql(name)`. The eight demo tables and their migrations
go to `jsudc-example`.

Public API (first cut, from what `main.ts` already composes):
`createDispatcher`, `CollectionRegistry`, `loadRegistry`,
`readCollectionAssets`, `makeSource`, the five `*Source` classes,
`udcPlugin(app, {dispatcher, registry})` (the body of `buildApp` as a Fastify
plugin, so a host mounts it on its own Fastify), `seedCollection`,
`ensureUdcSchema`, `collectionTable`. Config via arguments, never
`process.env` inside the library (the `UDC_*` env lookups in `factory.ts`
move behind an `env` argument, which they already accept).

### 4.3 React: three layers so any design system works

This is the answer to the restyling requirement. The library is cut into
layers a host can enter at any depth:

1. **Headless** — hooks and models with no markup: `useUdcCollection`,
   `useUdcDescribe`, `useDataViewState`, the table/kanban/calendar/tree/
   map/chart `model.ts` files, `transforms.ts`, `compose.ts`, filter and
   URL codecs. A host on Material or Ant can build its own renderer on these
   alone. Exported as `@jsudc/react/headless`.
2. **Primitives contract** — the renderers never import Radix directly;
   they take a `UiKit` from context: `Button`, `Input`, `Checkbox`,
   `Select`, `Dialog`, `DropdownMenu`, `Popover`, `Tooltip`, `Toast`,
   `Segmented`, `Spinner`. That is exactly the eleven files in
   `components/ui/` today, so the contract is already drawn; it only has to
   become an interface with a provider, `<UdcUiProvider kit={...}>`. The
   default kit (`@jsudc/react/ui`) is the current Radix + Tailwind one,
   which is the shadcn pattern (`cn`, variants, `Slot`). Alternative kits
   are small adapter packages: `@jsudc/ui-mui`, `@jsudc/ui-antd`, and a
   `ui-shadcn` adapter that points at the host's own generated shadcn
   components.
3. **Tokens and CSS** — every colour, radius and font the components use is
   a CSS variable (`--background`, `--primary`, `--sem-*`, `--chart-*`, as
   in `index.css` today). The library ships `styles.css` compiled by
   Tailwind at publish time, prefixed `udc-` (Tailwind v4 `prefix`), so it
   cannot collide with a host's Tailwind, and a host that has no Tailwind
   needs nothing. Restyling without touching code is redefining the
   variables; every structural element also carries a stable class
   (`udc-table`, `udc-cell`, `udc-kanban-column`) for plain CSS overrides.

Third-party renderer dependencies (react-table, leaflet, recharts, dnd-kit)
become optional peers behind subpath exports (`@jsudc/react/map`,
`@jsudc/react/chart`), so a host that never shows a map does not install
Leaflet. The registry of renderers stays a plain object a host can replace.

URL state: `useDataViewState` reads `useSearchParams` from react-router.
It gets a `UrlStateAdapter` (get/set of the search string) with a
react-router adapter and a plain `window.location` adapter, so react-router
is not a peer dependency.

i18n: the library dictionary (`APP.*`, renderer labels) is separated from
the example's collection descriptions; `<UdcI18nProvider locale messages>`
takes overrides and extra locales. `en` and `sr` ship.

Examples that prove the layers (in `jsudc-example`, one route each, phase 1
for the first two, phase 2 for the rest): default kit; CSS-variables-only
restyle (a "brand" theme switch); MUI kit; Ant kit; a headless table on
plain HTML.

### 4.4 What stays as it is

Zod schemas as the single protocol definition; Fastify as transport; Postgres
jsonb as the reference source; Tailwind v4 for the default kit; Vitest and
Cypress; Biome. Node 24.

## 5. Phases, milestones, tickets

Tickets T1 and T2 are NON-AI and are created on the board now. The rest are
proposals; each is created only when Igor says so, and needs a worktree.
The extraction (T3–T6) happens **inside this repository first**, so the
example keeps running against the packages at every step; the split into
repositories (T7) comes after and uses `git subtree split` to keep history.

### Phase 0 — decisions and accounts (Igor)

**T1 (NON-AI) Accounts, names, licence.** GitHub org, npm org `jsudc`,
licence, repository list, who publishes. Details on the ticket.

**T2 (NON-AI) Domain purchase.** Options and a recommendation on the ticket.

### Phase 1 — three packages, example app, website

**T3 `@jsudc/core` publishable.** In `packages/udc-core`: rename to
`@jsudc/core`, `private: false`, LICENSE, README (what the protocol is, the
envelope, the filter DSL, one example per action), move `client.ts` in as
`./client` subpath export with its tests, `exports` map with `types` first,
`npm pack --dry-run` lists only `dist`, LICENSE, README. Verify: `npm pack`
tarball installs into a scratch project and `import {ListRequestSchema}
from "@jsudc/core"` type-checks. Out of scope: publishing.

**T4 extract `packages/udc-server`.** Move the library part of
`backend/src` (everything except `main.ts`, `config.ts`, `cli/`,
`db/schema.ts` demo tables, `seed-rows.ts`) into `packages/udc-server` with
the API of §4.2; `buildApp` becomes `udcPlugin`; UDC SQL into
`packages/udc-server/migrations`; `tsc` build to `dist`; backend tests move
with the code they test; `backend/` becomes a thin app that imports the
package. Verify: `npm test` green in both workspaces, `npm run dev` serves
every collection unchanged, Cypress suite green.

**T5 extract `packages/udc-react`.** Move the library part of
`frontend/src` (all but `main.tsx`, `App.tsx`, `shell/`, `index.html`, demo
strings) into `packages/udc-react`, cut into the three layers of §4.3:
`UiKit` interface + provider + default kit; `UrlStateAdapter`; i18n
provider with overrides; Tailwind prefix `udc-` and a `styles.css` build;
subpath exports per optional renderer; Vite library build (ESM, `.d.ts`,
`sideEffects: ["*.css"]`). Verify: unit tests green in the package,
`frontend/` consumes the package through the workspace **without** source
aliases (the `vite.config.ts` and `tsconfig` aliases to `src` go), Cypress
green, `npm pack` tarball works in a scratch Vite app with the two-line
quick start. This is the largest ticket; it may be split in three (kit +
tokens, url/i18n adapters + build, optional renderer subpaths).

**T6 example consumes packages like a stranger.** `backend/` and
`frontend/` depend on `@jsudc/*` by version, not `*`; demo tables and
migrations live in `backend/drizzle`; `docs/demo.md` updated; a `brand`
theme route showing the CSS-variable restyle. Verify: delete
`packages/*/src`, keep `dist`, everything still runs.

**T7 split into repositories and set up CI/release.** For each of core,
server, react: `git subtree split` of its directory into the new GitHub
repo, Changesets, GitHub Actions (typecheck, lint, test, Postgres service
for server), publish workflow on tag with provenance, CONTRIBUTING, issue
templates, CODE_OF_CONDUCT. `jsudc-example` gets this repo's remaining
tree, `deploy/` included, and installs the packages from npm. First release
`0.1.0` of all three. Igor's parts (repo creation, npm org, secrets) are
in T1; this ticket is conditional on it.

**T8 website v1.** See §6. Repo `jsudc-website`.

**T9 package docs.** README per package is written in T3–T5; this ticket
is the reference docs on the site generated from code: the action payloads
and `view.yaml` / `schema.json` / `source.yaml` reference from the Zod
schemas (JSON Schema → MDX), the renderer option tables, the OpenAPI that
Fastify already emits at `/docs`.

### Phase 1 as filed (2026-10-29, after the repositories were created)

The eight repositories exist on `digital-cube` (private, empty). Phase 1 was
cut into six tickets on the `jsudc` worktree, chained so each waits for the
one before it. Scope changes against T3–T7 above, to reach "what we have now
through npm" with the least motion:

- **react-router stays a peer dependency** of `@jsudc/react` in phase 1; the
  `UrlStateAdapter` moves to phase 1b. Four library files use it
  (`useDataViewState`, `useKanbanBoard`, `useChartWindow`, `CalendarRenderer`).
- **The `UiKit` contract, the `udc-` Tailwind prefix and optional renderer
  subpaths move to phase 1b.** Phase 1 ships the library build, a compiled
  `styles.css`, and the i18n split (`APP` is the library's dictionary;
  `COLLECTIONS`, `ABOUT`, `MENU`, `TBL_*` are the example's, passed as an
  overlay).
- **Each package directory becomes a repo-ready tree before the split**: own
  README, LICENSE, `biome.json`, `.gitignore`, `.nvmrc`,
  `.github/workflows/ci.yml`, and a `prepare` script that builds `dist`, so
  `npm install github:digital-cube/jsudc-core#v0.1.0` works before any npm
  publish. The example installs from GitHub tags first and switches to
  npmjs.org when the npm org exists (TCKU2QEWWE).
- **Server tests split by what they test**: the generic machinery goes with
  the library and gets small fixture collections of its own; tests of the
  demo collections (appointments, metrics, trees, flights fixtures, the
  generators) stay in the example's `backend/test`.
- **History**: `git subtree split` keeps every commit that touched the
  prefix. `packages/udc-core` has history from the first commit; server and
  react start at their extraction commit. The staging branch must not live
  under a `libs/` path: the runner's guard refuses `git push … main` there.

| # | Ticket | Waits for |
|---|---|---|
| P1 | `@jsudc/core`: rename, client in, repo-ready package | — |
| P2 | extract `packages/udc-server`, repo-ready | P1 |
| P3 | extract `packages/udc-react`, repo-ready (phase-1 scope) | P2 |
| P4 | example consumes the three packages like a stranger | P3 |
| P5 | split and push core, server, react; tag `v0.1.0` | P4 |
| P6 | example installs from GitHub tags; push as `jsudc-example`; deploy | P5 |

### Phase 2 — more frameworks, more design systems

**T10 `@jsudc/ui-mui` and `@jsudc/ui-antd` adapters** with an example route
each in `jsudc-example`, plus the headless-table example.

**T11 `@jsudc/react-native`.** Hooks shared with react (extracted to
`@jsudc/react/headless` already), RN renderers for table (FlatList), cards,
calendar; map via react-native-maps; TanStack Query works in RN.

**T12 `jsudc-mobile-example`.** Expo app over the same backend as
`jsudc-example`, the companies, tickets and flights collections.

**T13 `@jsudc/angular`.** Services over `@jsudc/core/client`, signals-based
data view state, table and cards components first.

## 6. Website

**Audience:** a developer deciding in five minutes whether UDC solves their
"schema + view config → full data UI" problem, and then using the docs
daily.

**Content, v1:**

- Home: what a collection is (`schema.json`, `view.yaml`, `source.yaml`),
  the one-protocol-both-sides idea, the eight renderers as a visual strip,
  three quick starts (server, react, both), link to the live example.
- Get started: server in ten lines (Fastify + `udcPlugin`), react in ten
  lines (`UdcProvider` + `UdcDataView`), full stack with Postgres.
- Concepts: collections, sources, the envelope, filter DSL, schema
  revisions, views and renderers, theming (the three layers of §4.3).
- Reference: generated from the Zod schemas (T9).
- Examples: the live example app, one page per example route (default kit,
  brand restyle, MUI, Ant, headless).
- Packages: version table, changelogs, roadmap (react-native, angular).
- Blog / changelog feed.

**Tech (my call):** Astro + Starlight, MDX content, dark/light, search
built in, sidebar from the content tree; deployed to Cloudflare Pages (or
GitHub Pages) from `jsudc-website` on push to `main`; custom domain from
T2. The live example stays on DigitalCube's own infrastructure as today and
is linked, later `demo.<domain>`.

**Design:** its own visual identity derived from the example app's tokens
(the oklch palette and Inter in `index.css`) so the site and the components
look like one product; the renderer strip on the home page is real
screenshots from the example, regenerated by a script. A design pass
(frontend-design skill) before implementation; the home page is mocked up
and shown to Igor first.

## 7. Decisions for Igor, and calls I made

**Igor decides (on T1 and T2):** npm scope `@jsudc` vs unscoped; domain.
**Decided 2026-10-29:** GitHub org `digital-cube` (eight private repos exist,
`jsudc-website` among them); **licence MIT**, one for every package and the
example, copyright DigitalCube.

**My calls, change them if wrong:** scope `@jsudc`; client moves into
core; extraction inside this monorepo before the split; lockstep version
for the three packages; npmjs.org not GitHub Packages; Astro + Starlight
for the site; Tailwind prefix `udc-` and a shipped `styles.css`;
react-router out of the peer dependencies via an adapter; MUI and Ant
adapters in phase 2, not phase 1.

## 8. Risks

- **T5 is big.** Cutting 15k lines into layers while Cypress stays green.
  Mitigation: do it in three tickets, each leaving the example working.
- **Tailwind prefixing** touches every class string in 53 files. Mitigation:
  mechanical, Biome-checked, Cypress catches regressions.
- **Optional peers** confuse users when a renderer is listed but its peer is
  missing. Mitigation: a clear runtime error naming the package to install.
- **Lockstep releases** across three repositories need discipline.
  Mitigation: one release checklist, protocol version exported by core and
  asserted by server and react at startup.
