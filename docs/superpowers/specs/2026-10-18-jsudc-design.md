# jsudc — Universal Data Collection, all in TypeScript

Design document, 2026-10-18. Status: draft for review.

## 1. Intent

jsudc is a small test project. It re-implements the core idea of DigitalCube's
**UDC (Universal Data Collection)** — today a Python backend library (`udc`)
plus a React library (`@udc/react`), both exercised in the `dclabs` template —
as a single TypeScript codebase: Node.js backend, React/Vite frontend, Postgres
with data stored mostly as **jsonb**.

Why one language: today the data protocol (envelope, filter DSL, schema
document, view config) is declared twice, once in Python and once in
TypeScript, and the two drift (e.g. `row_actions_display` exists only on the
TS side). jsudc puts that protocol in **one shared package** that both the
server and the browser import. That shared interface is the main thing the
test has to prove, alongside a table that looks good and is pleasant to use.

The reference implementation lives in `/home/digital/work/dclabs` (Python lib
`libs/udc`, React lib `libs/udc-js`, example collections under
`backend/services/svc_examples/collections_assets/`). jsudc is **not** a port
of dclabs and does not copy its tenants or examples wholesale; it borrows the
protocol, the asset format (`view.yaml` + `schema.json` + `seed.json`) and one
example dataset shape (`serbian_companies`).

## 2. Goals, non-goals, anti-goals

### Goals (phase 1 = "a good demo")

1. **System set up**: monorepo, backend, frontend, database, tests and scripts
   all run from a fresh clone with a handful of commands.
2. **One shared data interface** between backend and frontend: protocol types
   and their runtime validators live in one package used by both.
3. **A collection of companies** served from Postgres jsonb with server-side
   sort, filter, search and both paging styles.
4. **The user chooses the table paging style**: classic pages or infinite
   scroll, switchable at runtime, not only in the view config.
5. **New columns through the UI**, as udc-py supports: a user adds a field to
   the schema from the table header and it appears as a column immediately.
6. **Attractive table and card renderers**: the look matters; this is a demo.
7. **TDD on the backend, Cypress on the frontend**, both against small seeded
   datasets of 20–200 rows.

### Phase 2 (designed for, not built now)

- Row actions in a context menu (typed `row_action_defs` with `when`).
- Column layout preferences: visibility, order, width, per user.
- Multiselect and bulk actions.

### Phase 3

- Scale: a generated dataset of ~200,000 companies, expression indexes on
  jsonb paths, latency measurements. Postgres is expected to handle it; the
  owner has good experience with this and defers it deliberately.

### Non-goals (phase 1)

- Authentication, users, tenants. Single anonymous user.
- WebSocket push / live subscriptions.
- Renderers other than table and cards (kanban, tree, map, calendar, chart,
  dropdown).
- Docs tab, config editor/revisions, source YAML, lookups, ratings, image
  cache, proxy, non-Postgres sources.
- Deployment, containers, CI pipelines beyond local scripts.

### Anti-goals (would make it a failure even if it "works")

- Protocol types declared twice (one in the server, one in the browser).
- A hand-rolled list endpoint and a bespoke `<table>`; everything that is a
  collection goes through the generic UDC path.
- Field names from the client reaching SQL without an allowlist check.
- A `total` that ignores the active filter (a known bug in udc-py's
  `PostgresJSONBSource`).

## 3. Constraints

- Local machine: Node 24 via nvm (24.19 present), Postgres 18.6 on localhost,
  role `jsudc` with `LOGIN CREATEDB`, password `123`. The app creates its own
  databases `jsudc` and `jsudc_test`.
- Language: **TypeScript everywhere** (owner's decision). Strict mode.
- Owner chose: Node.js backend, React + Vite frontend, Postgres, an ORM that
  is comfortable with jsonb, Cypress for frontend tests.
- Wire compatibility with udc-py/udc-js is a **should**, not a must: where
  jsudc implements an action it uses the same payload and response shape, so
  the existing `@udc/react` client could in principle talk to it. jsudc may
  omit actions and fields; it must not redefine the ones it keeps.

## 4. Decisions

| Area | Decision | Why |
|---|---|---|
| Repo layout | npm workspaces monorepo: `packages/udc-core`, `backend`, `frontend` | Shared package is the point; npm is already there, no extra tool |
| Node | 24 LTS, pinned in `.nvmrc` | Installed, current LTS |
| Language | TypeScript 5.x, strict, ESM | Owner's choice |
| HTTP server | **Fastify 5** | Closest to FastAPI ergonomics: schema validation, plugins, OpenAPI via `@fastify/swagger`, fast |
| Validation | **Zod 4** in `udc-core`; `fastify-type-provider-zod` on the server | Same validators run in browser and server; Fastify gets typed routes from them |
| DB access | **Drizzle ORM** + `drizzle-kit` migrations, `pg` driver | Typed `jsonb()` columns, first-class dynamic query building (needed to turn a filter tree into WHERE/ORDER BY), `sql` template for `->>`, casts and expression indexes. Prisma rejected (weak jsonb filtering, awkward dynamic queries, separate schema language); TypeORM/Objection rejected (maintenance) |
| Frontend | React 19, Vite, Tailwind 4, TanStack Query 5, TanStack Table, Radix primitives (shadcn-style components), lucide icons, react-router 7 | Same family as dclabs so the two can be compared; shadcn-style gives the "attractive" baseline cheaply |
| Tests | Vitest (backend + udc-core + frontend unit), Cypress (frontend e2e) | Owner's choice for Cypress; Vitest matches Vite |
| Lint/format | Biome | One tool; my call, swap for ESLint+Prettier if the owner prefers |
| Collection assets | Directory per collection: `view.yaml`, `schema.json`, `seed.json` | Same dialect as dclabs so definitions are comparable one to one |

## 5. Architecture

```
jsudc/
  package.json              # workspaces: packages/*, backend, frontend
  .nvmrc                    # 24
  packages/udc-core/        # the shared interface (no runtime deps besides zod)
  backend/                  # Fastify + Drizzle
    collections/<name>/     # view.yaml, schema.json, seed.json
    src/
  frontend/                 # React + Vite
  docs/
```

### 5.1 `packages/udc-core` — the shared interface

The single source of truth for everything that crosses the wire. Exports:

- **Envelope**: `UdcMessage {kind, id, payload}`; responses `kind: "udc.<action>.ok" | "udc.<action>.err"`; `ErrorPayload {code, message, details?}` with the closed code set `not_found | validation_error | version_conflict | forbidden | unsupported_op | internal`.
- **Filter DSL** (identical to udc-py/udc-js): `Condition {field, op, value?, case_insensitive?}`, groups `{and:[]} | {or:[]} | {not:}`; the 14 ops `eq neq in not_in contains starts_with ends_with gt gte lt lte between is_null is_not_null`. Plus `evaluateFilter(node, row)` — a pure in-memory evaluator used by tests on both sides and by the frontend for optimistic updates.
- **Sort**: `SortKey {field, dir: "asc" | "desc"}` (dir defaults to `asc`).
- **Paging**: `PageRequest {limit?, cursor?, offset?}`. `cursor` and `offset` are mutually exclusive. Response always `{rows, next_cursor, total}`.
- **Row**: `{__meta: {id, version}, ...fields}` (flat; jsonb fields spread at top level).
- **SchemaDoc** `{version, core_fields, fields: Record<name, FieldDef>, field_order}` and `FieldDef`. Phase-1 field types: `string text integer decimal year bool date datetime json`. The type union keeps the full udc-py list (`image relation string_array rating enum lookup lookup_array`) so documents from dclabs parse, but the server refuses to **add** a field of a type it cannot store/sort yet with `unsupported_op`.
- **ViewConfig** with the phase-1 keys: `default_renderer`, `available_renderers` (`table | cards`), `columns[]` (`field, id?, pin?, editable?, width?, render?, render_options?, align?, transform?, color?, bg?`), `page_size_default`, `pagination` (`infinite | pages`, the default style), `row_height`, `search {fields, placeholder, case_insensitive}`, `filters[]` (chips: `field, kind: select|range|bool, label?, options?, min?, max?, step?`), `filterable {fields, default_op}`, `card_options {title_field, subtitle_field, image_field?, meta_fields, size}`, `row_color`. Phase-2 keys (`row_action_defs`, `bulk_actions`, `multiselect`, `row_actions_display`) are **declared in the type now** and ignored by the renderers until phase 2, so view files from dclabs parse without edits.
- **Request/response payloads** for every phase-1 action (below), as Zod schemas with inferred TS types.
- **Field name rule**: `^[a-z][a-z0-9_]{0,62}$`, exported as a validator; used by the server allowlist and by the schema form.

No React, no Node APIs in this package. It must build for both targets.

### 5.2 Backend

**Transport.** One route: `POST /udc/:action`. Body is the payload. The server wraps it as `{kind: "udc.<action>", id: x-udc-message-id header or "", payload}` and dispatches. Response is **always HTTP 200** with the `.ok` / `.err` envelope (as udc-py). `GET /healthz` for liveness. `@fastify/swagger` serves OpenAPI at `/docs` generated from the Zod schemas.

**Actions (phase 1).**

| action | payload → ok payload |
|---|---|
| `collections` | `{}` → `{collections: [{name, default_renderer, capabilities}]}` |
| `describe` | `{collection}` → `{collection, capabilities, schema: SchemaDoc, view: ViewConfig, filterable: {fields: [{field, type, ops, default_op, widget, label?}]}}` |
| `list` | `{collection, filter?, sort?, page?}` → `{rows, next_cursor, total}` |
| `read` | `{collection, id}` → `{row}` |
| `mutate` | `{collection, op: insert\|update\|delete, id?, row?, expected_version?}` → `{row}`; update merges a partial patch, bumps `version`; mismatch → `version_conflict` with `details.current_version` |
| `schema.add_field` | `{collection, name, fielddef, position: {where: before\|after\|end, anchor?}}` → `{schema}` |
| `schema.update_field` | `{collection, name, fielddef}` → `{schema}`; a changed `type` → `unsupported_op` |
| `schema.soft_delete_field` | `{collection, field}` → `{schema}` |

`capabilities` for the jsonb source: `{mutate: true, subscribe: false, total_count: true, schema_edit: true, config_edit: false, supported_filter_ops: [all 14]}`.

**Collection registry.** At startup the server scans `backend/collections/*/`, parses `view.yaml` through the udc-core Zod schema (fail fast on an invalid view), reads `schema.json` as the *initial* schema, and registers `name → {source, view}`. A `Source` interface (`describe/list/read/mutate/addField/updateField/softDeleteField`, `capabilities`) is kept even though phase 1 has one implementation, so an in-memory source can serve unit tests of the dispatcher and the frontend evaluator stays honest.

**Postgres jsonb source.** One table per collection, created by a Drizzle migration:

```sql
create table companies (
  id          uuid primary key default gen_random_uuid(),
  data        jsonb not null default '{}'::jsonb,
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

Phase 1 stores **every field in `data`**; `core_fields` must be empty (the server refuses a schema with core fields with `unsupported_op`). This is the deliberate jsonb-first choice; typed core columns are a later addition the `Source` interface already allows.

Query compilation, from a `ListRequest`:

- Every `field` in filter, sort and search is checked against the active schema's non-deleted fields (allowlist) **and** the field-name regex. Unknown → `validation_error`.
- Field reference: `data->>'f'` for text ops; cast by schema type for ordering/comparison: `integer|decimal|year → (data->>'f')::numeric`, `date → ::date`, `datetime → ::timestamptz`, `bool → ::boolean`.
- Ops: `eq/neq/gt/gte/lt/lte/between` compare on the cast expression; `in/not_in` → `= ANY(...)`; `contains/starts_with/ends_with` → `LIKE`/`ILIKE` with escaped `%` and `_`; `is_null` → `data->>'f' IS NULL`.
- Sort: the requested keys, then **`id asc` always appended** as tiebreaker.
- Paging: `offset` → `LIMIT/OFFSET` (pages mode). `cursor` → keyset: base64url JSON of `[sort values…, id]`, `WHERE (sortexpr…, id) > (…)`; mixed asc/desc with a cursor is rejected with `unsupported_op`, exactly as udc-py, unless the builder finds the row-comparison expansion trivial. `limit` 1..1000, default `view.page_size_default`.
- `total` is `count(*)` **over the same WHERE** as the rows (fixes the udc-py bug). Rows and count run in one round trip where convenient.
- `mutate` validates the row against the active schema (`validate_row`: types, required, unknown fields rejected), merges the patch into `data`, bumps `version`, sets `updated_at`.

**Schema revisions.** One table for all collections:

```sql
create table udc_schema_revisions (
  id          bigserial primary key,
  collection  text not null,
  version     integer not null,
  schema      jsonb not null,
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (collection, version)
);
create unique index on udc_schema_revisions (collection) where active;
```

Seeding writes `schema.json` as revision 1 (active). Every `schema.*` action inserts a new revision, activates it and deactivates the previous one in one transaction. `soft_delete_field` sets `deleted: true` (data stays). On activation, every field with `index: true` of a sortable type gets `CREATE INDEX IF NOT EXISTS <table>_data_<field>_idx ON <table> ((<cast expr>))`. `describe` always serves the active revision; `field_order` is maintained by `position`.

**Schema version on the wire vs in the table** (my call, keeps wire compat): the table stores `version integer`; the `SchemaDoc.version` sent and received on the wire is the string `"v<n>"`, exactly as udc-py bumps `v1 → v2`. dclabs schema files with `"version": "v1"` parse verbatim. `schema.soft_delete_field` takes `{collection, field}` (udc-py/udc-js spelling), not `name`.

**Schema edits vs existing rows** (my call):

- `schema.update_field` **may not change `type`** → `unsupported_op`. Existing `data` was validated against the old type, so the cast expressions in sort/filter stay safe. The field form hides the type control in edit mode. Changing a type means soft-deleting and adding a new field.
- `schema.add_field` with `required: true` is allowed. `required` is enforced on **insert** and whenever the patch **touches that field**; an `update` that patches other fields of a row where the required field is still empty succeeds. (udc-py validates the merged row and locks every existing row after such an add; jsudc does not.)
- Rows that predate a field simply have no key in `data`; `is_null` matches them and they sort last (`NULLS LAST`) in both directions.

**Columns for fields that are not in `view.columns`** (my call): the derivation happens **server-side in `describe`**, so any client, including an unmodified `@udc/react`, sees the new column. Starting from `view.columns` in file order, every non-deleted schema field that is not listed is inserted as a default column (`width: default_column_width`, `editable: true`) **next to its `field_order` neighbour**: right after the nearest preceding field in `field_order` that already has a column, or first if there is none. `position: before|after` on `schema.add_field` therefore has a visible effect in the table without persisting a view revision. `view.columns` keeps its dclabs meaning: the styled, ordered base layout. Per-user reordering is phase 2.

**CLI** (`backend` scripts): `db:create`, `db:migrate`, `seed [--reset] [--db jsudc|jsudc_test] [--limit N]` (seeds schema revision 1 and the `seed.json` rows), `dev`, `test`.

**Configuration** through env: `DATABASE_URL` (default `postgresql://jsudc:123@localhost/jsudc`), `TEST_DATABASE_URL`, `PORT` (default 5100). A `.env.example` is committed; `.env` is not.

### 5.3 Frontend

- **Client** `UdcClient({httpUrl, headers?})` with one method per action; posts `${httpUrl}/udc/<action>`, unwraps `.ok`, throws `UdcError(code, message, details)` on `.err`. Typed by udc-core.
- **Provider/hooks** on TanStack Query, keys prefixed `["udc", ...]`: `useUdcCollections`, `useUdcDescribe(collection)` (staleTime 5 min), `useUdcCollection({collection, filter, sort, pagination, pageLimit, page})` (`useInfiniteQuery` following `next_cursor` for infinite; `useQuery` with `offset` for pages), `useUdcMutate(collection)` (optimistic row patch, invalidates list, surfaces `version_conflict`), `useUdcSchema(collection)` (add/update/softDelete, invalidates describe).
- **`<UdcDataView collection>`** owns: active tab (`table | cards` from `available_renderers`), search text, chip state, filter tree, sort, paging mode, page number / loaded pages. URL state via react-router search params: `?f=` base64url filter node, `?q=` search, `?cf=` chips, `?sort=field:dir,...`, `?tab=`, `?p=` page, `?mode=pages|infinite`. Paging mode defaults from `view.pagination`, the user toggles it in the toolbar, the choice persists per collection in `localStorage` (phase 2 moves it to server-side user prefs).
- **TableRenderer** (TanStack Table): columns from `view.columns` with width, pin, align, `render` kinds `text | number_format | bool | date`, `transform` (`titlecase`, `truncate:N`, `date_format:PATTERN`), semantic `color`/`bg` tokens, `row_color` rules, `row_height`. Click a header to sort (asc → desc → none), inline edit on `editable` cells by field type (text input, number input, checkbox, date picker, select for `enum`), Escape cancels, Enter/blur saves with `expected_version`; conflict shows a toast and reloads the row. Pages mode: pager with page size from `page_size_default`, total and page count. Infinite mode: sentinel row fetches the next page; total shown in the toolbar.
- **CardRenderer**: grid of cards from `card_options` (`title_field, subtitle_field, image_field, meta_fields, size`), same data hooks, infinite scroll only (pages also acceptable; builder's call, say which).
- **Toolbar**: search box (debounced, `contains` over `search.fields`, `or`-ed), filter chips from `view.filters`, a filter builder for `filterable.fields` (one condition per row: field, op, value), paging-mode toggle, tab switch, row count.
- **Schema editor**: a menu on every column header (add field before/after, edit field, soft-delete field) and on a trailing `+` header (add at end). The field form edits `name, type, label (i18n), required, index, length, min, max, values`; in edit mode `name` and `type` are read-only. After save, `describe` is invalidated and the column appears without reload at the position chosen, because the server derives columns for unlisted fields (see 5.2). Soft-deleting a field removes its column.
- **i18n**: `t(section, term)` with a flat map `{TBL_COMPANIES: {NAME: {en, sr}}, APP: {...}}`, locales `en` and `sr`, persisted in `localStorage` (`udc-locale`), fallback `SECTION.TERM`.
- **Look**: Tailwind 4 design tokens, light and dark theme, Radix-based components (dropdown menu, dialog, popover, tooltip, checkbox, select) styled shadcn-style, lucide icons, compact density, sticky header, pinned columns with shadow, zebra off, hover highlight, skeleton rows while loading, empty and error states designed, not default.

### 5.4 The example collection: `companies`

`backend/collections/companies/` with the dclabs `serbian_companies` schema (`pib, name, mb, legal_form, city, industry, employees, revenue_eur, founded, active`), a `view.yaml` with table + cards, `search.fields: [name, pib, mb, city]`, chips on `city` (select), `industry` (select), `active` (bool), `employees` (range), and a `seed.json` of **200 synthetic rows** (names, cities and industries Serbian; `pib`/`mb` as strings with leading zeros possible; no real registry data). Columns `name, city, industry, employees, revenue_eur, founded, active` are `editable: true` so inline edit is demonstrable.

## 6. Verification

**Backend (TDD).** Vitest against the real `jsudc_test` database — no mocked SQL. Each test file truncates its tables and seeds what it needs (20–200 rows from `seed.json`, or hand-built rows). Covered: every action's happy path and error codes; filter compilation for all 14 ops × field types (including `%`/`_` escaping, case-insensitivity, numeric vs text ordering: 10 after 9); keyset and offset paging agree with each other and with `evaluateFilter` in memory; `total` honours the filter; version conflicts; field allowlist rejection; schema revision activation, `field_order` maintenance, index creation, soft-delete hides the field from describe and refuses it in filters. Dispatcher tests on the in-memory source. Coverage target 80% on `backend/src` and `packages/udc-core`.

**udc-core.** Vitest: Zod schemas accept the dclabs `books` and `serbian_companies` view/schema files verbatim; `evaluateFilter` property-style tests over a small row set.

**Frontend.** Vitest + Testing Library for hooks and pure render helpers (transforms, URL codec). Cypress e2e against a running backend on `jsudc_test` seeded with 200 rows (a `npm run seed:test` task Cypress calls in `before`): table renders columns from the view; header click sorts and the first cell changes; search narrows and the count matches; chip filter; filter builder condition encoded in `?f=` survives reload; switch to pages mode, paginate to page 3, switch back to infinite and scroll loads more; inline edit persists after reload; version conflict toast when the row was changed underneath (via `cy.request` to `/udc/mutate`); add a field from the header, fill it inline, see it in cards too; soft-delete the field removes the column; cards tab renders `title_field` and `meta_fields`; locale switch changes headers.

**Scripts** from the root: `npm run dev` (backend + Vite concurrently), `npm test` (all workspaces), `npm run e2e`, `npm run lint`, `npm run typecheck`. A fresh clone reaches a running app with: `nvm use && npm install && npm run db:setup && npm run seed && npm run dev`.

## 7. Left to the builder

- Exact Drizzle schema file layout and migration naming.
- Whether rows and `count(*)` run as one statement or two.
- Keyset cursor with mixed sort directions: reject (as udc-py) or implement; document the choice.
- Component file structure in the frontend; whether to use shadcn's generator or write the few primitives by hand.
- Seed generator implementation (a committed `seed.json` is required; a script that produced it is welcome).
- Debounce and staleTime values, skeleton/empty-state visuals, exact toolbar layout.
- Biome configuration details.

## 8. Phasing into tickets

1. **Scaffold + udc-core**: monorepo, toolchain, `udc-core` with Zod schemas, types, filter evaluator, tests; dclabs view/schema files parse.
2. **Backend core**: Fastify transport, dispatcher, in-memory source, Postgres jsonb source with list/read/mutate, collection registry, `companies` assets and seed, CLI, TDD suite.
3. **Backend schema revisions**: `schema.*` actions, revisions table, index creation, describe from the active revision.
4. **Frontend core**: client, hooks, app shell, TableRenderer with sort, search, chips, filter builder, both paging modes with toggle, inline edit, URL state, i18n, Cypress baseline.
5. **Frontend cards + schema editor**: CardRenderer, column header menu, field form, Cypress for both; visual polish pass across table, cards, toolbar, light/dark.

Phase 2 and 3 tickets are written when phase 1 is demoable.
