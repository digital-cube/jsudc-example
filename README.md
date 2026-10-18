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
backend/             Fastify + Drizzle server (ticket 2)
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
