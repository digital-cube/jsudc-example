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
drift. In jsudc it lives once, in [`packages/udc-core`](packages/udc-core):
envelopes, the filter DSL and an in-memory evaluator, schema and view types,
row validation and every action payload, as Zod schemas with inferred types.
Both the server and the browser import it. The design is in
[`docs/superpowers/specs/2026-10-18-jsudc-design.md`](docs/superpowers/specs/2026-10-18-jsudc-design.md).

## Layout

```
packages/udc-core/   shared protocol (zod is its only runtime dependency)
backend/             Fastify + Drizzle server: UDC envelope RPC over Postgres jsonb
frontend/            React + Vite app (ticket 4)
docs/                design and plans
```

## Install and test

Requires Node 24 (pinned in `.nvmrc`).

```sh
nvm use            # Node 24
npm install
npm run typecheck  # tsc --noEmit in every workspace
npm run lint       # Biome, one config for the whole repo
npm test           # Vitest in every workspace
npm run build      # udc-core -> packages/udc-core/dist (ESM + .d.ts)
npm run format     # Biome, rewrites files
```

`npx vitest` at the root runs every workspace's tests as Vitest projects; inside
a workspace, `npm test` runs only that one.

## Backend

Needs Postgres on localhost with the role `jsudc` (password `123`, `CREATEDB`).
Defaults live in [`backend/.env.example`](backend/.env.example); copy it to
`backend/.env` to override `DATABASE_URL`, `TEST_DATABASE_URL` or `PORT` (5100).

```sh
npm run db:setup   # create jsudc + jsudc_test, apply the drizzle migrations to both
npm run seed       # companies: schema revision 1 + 200 rows (-- --reset, --limit N, --db <url|name>)
npm run dev        # http://localhost:5100, OpenAPI UI at /docs
npm test -w @jsudc/backend           # Vitest against the real jsudc_test database
npm run test:cov -w @jsudc/backend   # coverage, thresholds 80%
```

Every action is `POST /udc/<action>` with the payload as body; the answer is
always HTTP 200 with `{kind: "udc.<action>.ok" | "udc.<action>.err", id, payload}`.

```sh
curl -s localhost:5100/udc/list -H 'content-type: application/json' \
  -d '{"collection":"companies","sort":[{"field":"employees","dir":"desc"}],"page":{"limit":5}}'
```

Collections are directories under `backend/collections/<name>/` (`view.yaml`,
`schema.json`, `seed.json`), each served from a table of the same name with every
field in `data jsonb`. `backend/scripts/generate-companies.ts` regenerates the
synthetic `companies` seed deterministically.
