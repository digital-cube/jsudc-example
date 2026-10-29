# jsudc

jsudc re-implements the core of DigitalCube's **UDC (Universal Data Collection)**
in a single TypeScript codebase: a Node.js backend (Fastify + Drizzle), a React
frontend (Vite) and Postgres, with collection rows stored mostly as `jsonb`. A
collection is described by a schema document and a view config (`schema.json`
and `view.yaml`, the same dialect as dclabs). The server serves it through one
generic protocol: `describe`, `list` with server-side filter/sort/paging,
`mutate`, and schema edits that add a column from the UI.

The point of the exercise is the **shared interface**. In UDC today the
protocol is declared twice, once in Python and once in TypeScript, and the two
drift. In jsudc it lives once, in [`@jsudc/core`](packages/udc-core) (`packages/udc-core`):
envelopes, the filter DSL and an in-memory evaluator, schema and view types,
row validation and every action payload, as Zod schemas with inferred types.
Both the server and the browser import it. The server machinery — dispatcher,
collection registry, the five sources, schema revisions, the Fastify plugin —
is [`@jsudc/server`](packages/udc-server) (`packages/udc-server`); `backend/`
is the example server that serves the demo collections with it. The React side —
hooks, the data view and its seven renderers, the schema editor, i18n, theme and a
compiled stylesheet — is [`@jsudc/react`](packages/udc-react) (`packages/udc-react`);
`frontend/` is the example app around it. The three packages are libraries;
`backend/` and `frontend/` are the example, and they use the libraries the way an
outside project does (see [How the example uses the packages](#how-the-example-uses-the-packages)).
The design is in
[`docs/superpowers/specs/2026-10-18-jsudc-design.md`](docs/superpowers/specs/2026-10-18-jsudc-design.md).

## Layout

```
packages/udc-core/   @jsudc/core: the shared protocol and the transport client (zod is its only runtime dependency)
packages/udc-server/ @jsudc/server: dispatcher, registry, sources, schema store, seeding, the Fastify plugin
packages/udc-react/  @jsudc/react: hooks, <UdcDataView> and its renderers, the schema editor, i18n,
                     theme, UI primitives, styles.css / tokens.css
backend/             the example server: the demo collections (backend/collections), their eight
                     tables (src/db/schema.ts) and drizzle migrations (drizzle/), the generators
                     (scripts/), the seed CLI
frontend/            the example app (React 19 + Vite): the shell (menu, pickers, about page),
                     routes and the demo dictionary (src/i18n), around @jsudc/react
docs/                design, plans and the two-minute demo script (docs/demo.md)
```

## From a clean clone to a running app

Requires Node 24 (pinned in `.nvmrc`) and Postgres on localhost with the role
`jsudc` (password `123`, `CREATEDB`; see [Backend](#backend) to point elsewhere).

```sh
git clone <this repo> jsudc && cd jsudc
nvm use                    # Node 24
npm ci                     # also builds packages/*/dist: each package's `prepare` runs on install
npm run db:setup           # create jsudc + jsudc_test, apply the drizzle migrations to both
npm run seed -- --reset    # every database collection: schema revision 1 + its seed rows
npm run dev                # builds the packages, then watches them; backend :5100, Vite :5173
```

Open <http://localhost:5173/udc/companies>; every collection is in the sidebar.

## Install and test

```sh
npm run typecheck  # tsc --noEmit in every workspace (builds the packages first)
npm run lint       # Biome, one config for the whole repo
npm test           # Vitest in every workspace (builds the packages first; udc-server and backend need Postgres)
npm run build      # packages/*/dist (ESM + .d.ts; react also styles.css), then the frontend's vite build
npm run build:packages  # only @jsudc/core, server and react -> packages/*/dist
npm run format     # Biome, rewrites files
```

`npx vitest` at the root runs every workspace's tests as Vitest projects; inside
a workspace, `npm test` runs only that one. Neither builds the packages: run
`npm run build:packages` first if `dist` is missing or stale.

## How the example uses the packages

`backend/` depends on `@jsudc/core` and `@jsudc/server`, `frontend/` on
`@jsudc/core` and `@jsudc/react`, each as `^0.1.0` in its `package.json`. The npm
workspace links them into `node_modules/@jsudc/*`, and they resolve through each
package's `exports` to its built `dist` — the same files an install from npm or
GitHub gives. There is no path alias to a package's `src` anywhere in the example
(not in `vite.config.ts`, `vitest.config.ts` or any `tsconfig.json`), so:

- `dist` has to exist. `npm ci` builds it (`prepare`); `npm run dev`, `dev:backend`,
  `dev:web`, `test`, `typecheck` and `e2e` rebuild it first; `npm run build` builds
  the packages before the frontend.
- `npm run dev` keeps it current: next to the backend and Vite it runs
  `npm run dev:packages` — `tsc --watch` for core, server and react's `.d.ts`, and
  `vite build --watch` for react's JavaScript — so an edit in `packages/*/src`
  reaches the running app (Vite reloads, `tsx watch` restarts the backend) without
  a manual build. The watchers share `--incremental` build info under
  `node_modules/.cache/jsudc-dev` with the `predev` build, so their first pass emits
  nothing and the backend does not restart while it starts. `tokens.css` and
  `styles.css` are not watched: after editing them, `npm run build:packages`.
- The example's Tailwind scans `node_modules/@jsudc/react/dist` for the library's
  classes, as any Tailwind host would (`frontend/src/index.css`).

Deleting `packages/*/src` (keeping `dist`) leaves the example working: it
typechecks, its tests pass, the frontend builds and the Cypress suite is green.

## Backend

Needs Postgres on localhost with the role `jsudc` (password `123`, `CREATEDB`).
Defaults live in [`backend/.env.example`](backend/.env.example); copy it to
`backend/.env` to override `DATABASE_URL`, `TEST_DATABASE_URL` or `PORT` (5100).

```sh
npm run db:setup   # create jsudc + jsudc_test, apply the drizzle migrations to both
npm run seed       # companies: schema revision 1 + 200 rows (-- --reset, --limit N, --db <url|name>)
npm run dev        # http://localhost:5100, OpenAPI UI at /docs
npm test -w @jsudc/server            # the library's tests, on its own fixture collections, in jsudc_test
npm test -w @jsudc/backend           # the demo collections' tests, against the same database
npm run test:cov -w @jsudc/backend   # coverage, thresholds 80% (same script in @jsudc/server)
```

Every action is `POST /udc/<action>` with the payload as body; the answer is
always HTTP 200 with `{kind: "udc.<action>.ok" | "udc.<action>.err", id, payload}`.

```sh
curl -s localhost:5100/udc/list -H 'content-type: application/json' \
  -d '{"collection":"companies","sort":[{"field":"employees","dir":"desc"}],"page":{"limit":5}}'
```

The schema is editable at runtime: `schema.add_field`, `schema.update_field` and
`schema.soft_delete_field` each write a new active revision (`v2`, `v3`, …) into
`udc_schema_revisions` and create the expression index of every `index: true`
field; `seed -- --reset` returns a collection to its `schema.json` as `v1`.

```sh
curl -s localhost:5100/udc/schema.add_field -H 'content-type: application/json' \
  -d '{"collection":"companies","name":"website","fielddef":{"type":"string","length":120},"position":{"where":"after","anchor":"name"}}'
```

Collections are directories under `backend/collections/<name>/` (`view.yaml`,
`schema.json`, `seed.json`), each served from a table of the same name with every
field in `data jsonb`. `backend/scripts/generate-companies.ts` regenerates the
synthetic `companies` seed deterministically.

## Frontend

```sh
npm run dev        # package watchers, backend (:5100) and Vite (:5173) together; open /udc/companies
npm run dev:web    # Vite only (after a package build), proxying POST /udc/* and /healthz to 127.0.0.1:5100
npm test -w @jsudc/react      # the library's Vitest + Testing Library (jsdom) tests, no backend needed
npm test -w @jsudc/frontend   # the shell's tests (menu, sidebar groups, about page)
npm run e2e        # Cypress headless against a reseeded jsudc_test (see below)
```

Vite listens on `VITE_PORT` (5173; it moves to the next free port if that one is
taken). The dev proxy targets `UDC_PROXY_TARGET` (default `http://127.0.0.1:5100`);
setting `VITE_UDC_URL` instead makes the browser call that backend directly.
Only POSTs under `/udc` are proxied: `GET /udc/<collection>` is an app route.

`packages/udc-react/src/` (`@jsudc/react`, see [its README](packages/udc-react/README.md)):

```
udc/          UdcProvider, createUdcQueryClient, TanStack Query hooks over @jsudc/core/client
data-view/    <UdcDataView>: URL state, search, chips, filter builder, paging toggle
renderers/    the registry: table, cards, kanban, calendar, tree, map, chart
table/ …      one directory per renderer (TanStack Table, dnd-kit, Leaflet, Recharts)
i18n/         UdcI18nProvider, t(section, term), the library's APP strings in en + sr
components/ui shadcn-style primitives on Radix (popover, select, tooltip, toast, …)
tokens.css    the design tokens; styles.css compiles them with Tailwind into dist/styles.css
```

`frontend/src/`: `main.tsx`, `App.tsx` (providers and routes), `shell/` (AppShell,
MenuTree, TimezonePicker, AboutPage) and `i18n/messages.ts`, the example's strings
(`COLLECTIONS`, `ABOUT`, `MENU`, `TBL_<collection>`, the shell's own `APP` terms),
passed to `<UdcI18nProvider messages>`. Vite and `tsc` resolve `@jsudc/core` and
`@jsudc/react` to their built `dist` (see above); `src/index.css` runs Tailwind over
the shell and the library's `dist` with `@jsudc/react/tokens.css`.

Everything the user picks lives in the URL (`?q=` search, `?cf=` chips and `?f=`
filter tree as base64url JSON, `?sort=field:dir,…`, `?mode=pages|infinite`, `?p=`,
`?tab=`). The paging mode defaults from the view's `pagination`; the user's choice
is remembered per collection in `localStorage` (`udc:paging:<collection>`).

`npm run e2e` (`scripts/e2e.mjs`) builds the packages, migrates and reseeds the test database
(`TEST_DATABASE_URL`, 200 rows), starts the backend on it at `E2E_BACKEND_PORT`
(5110) and Vite at `E2E_WEB_PORT` (5310), runs `cypress run`, and stops both. Spec
files that edit rows reseed first. Extra arguments go to Cypress, e.g.
`npm run e2e -- --spec frontend/cypress/e2e/edit.cy.ts`.

## Deploy on igor.digitalcube.work

<http://jsudc.igor.digitalcube.work> is the **dev stack with HMR**, on purpose: no
production build, no `vite preview`, no static files. Everything it needs is in
[`deploy/`](deploy):

```
nginx :80 (TLS upstream)  ->  Vite 127.0.0.1:5101  ->  POST /udc/*, /healthz  ->  Fastify 127.0.0.1:5100
deploy/nginx/jsudc.igor.digitalcube.work.conf   the vhost; /etc/nginx/sites-enabled/ links to it
deploy/systemd/jsudc-dev.service                user unit running `npm run dev`; ~/.config/systemd/user/ links to it
```

Vite is on 5101, not 5173: podman's `rootlessport` holds 5170–5189 on this machine.
The unit runs from the root checkout `/home/digital/work/jsudc` on `main` (never a
worktree), with Node v24.19.0 from nvm hardcoded, and starts at boot through linger.

- `deploy/deploy.sh [--branch jsudc] [--reset-seed] [--no-merge]` — a normal deploy,
  from the root checkout: `git merge --ff-only jsudc`, stop the unit, `npm ci`,
  `npm run build` (the packages' `dist`, then the frontend), migrate, `npm run seed` (new collections only; `--reset-seed`
  reseeds everything and loses edits made on the site), start the unit, then waits
  for `/healthz` through nginx and lists one row of every database collection.
- `deploy/install.sh [--dry-run]` — once, and again whenever the unit or the vhost
  file is renamed or a link is lost: links both files into the checkout, enables the
  unit, reloads nginx and checks linger. It refuses to run from anywhere but
  `/home/digital/work/jsudc`.

```sh
systemctl --user restart jsudc-dev
systemctl --user status jsudc-dev
journalctl --user -u jsudc-dev -f
tail -f /var/log/nginx/jsudc.igor.access.log /var/log/nginx/jsudc.igor.error.log
```

`DATABASE_URL` or `PORT` overrides, if ever needed, go into `backend/.env` in the
root checkout (see [`backend/.env.example`](backend/.env.example)). The unit's own
`Environment=` lines win over that file, though (the environment beats `.env`), so
moving the backend off 5100 under the unit means editing `PORT` in
`deploy/systemd/jsudc-dev.service` (and `UDC_PROXY_TARGET` for Vite's proxy).
