# @jsudc/core

The UDC (Universal Data Collection) protocol in TypeScript. One package holds
everything that crosses the wire between a UDC server and its clients, as Zod
schemas with inferred types: the message envelope, the filter DSL and an
in-memory evaluator, schema, view and source documents, every action's request
and response, row validation, and a small HTTP transport client.

A server validates what it receives with these schemas; a client builds its
requests with the same types. Neither side declares the protocol again, so the
two cannot drift. `zod` is the only runtime dependency; there is no React and no
Node API in the package, so it runs in the browser, in Node, in React Native and
in Angular alike.

```sh
npm install @jsudc/core
# before the npm release, from a tag:
npm install github:digital-cube/jsudc-core#v0.1.0
```

Two entry points:

| Import               | What                                       |
| -------------------- | ------------------------------------------ |
| `@jsudc/core`        | the protocol: schemas, types, helpers      |
| `@jsudc/core/client` | `UdcClient`, the envelope RPC over `fetch` |

## The envelope

Every action is one `POST <base>/udc/<action>` with the request payload as the
body. The answer is an envelope whose `kind` says how it went:

```json
{ "kind": "udc.list.ok",  "id": "…", "payload": { "rows": [], "next_cursor": null, "total": 0 } }
{ "kind": "udc.list.err", "id": "…", "payload": { "code": "not_found", "message": "no collection books" } }
```

`requestKind`, `okKind`, `errKind` and `parseKind` build and split the kinds.
An error payload carries one of a closed set of codes (`not_found`,
`validation_error`, `version_conflict`, `forbidden`, `unsupported_op`,
`internal`); `UdcError` is the matching exception, with `toPayload()` and
`UdcError.fromPayload()` to cross the wire, and `isUdcError` /
`isVersionConflict` as guards.

## Actions

`ACTIONS` maps every action name to its request and response schema, so a
server can dispatch generically and a client is typed per action
(`ActionRequest<"list">`, `ActionResponse<"list">`).

| Action                     | Request                                                                              | Answer                                                            |
| -------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `collections`              | `{}`                                                                                 | `{ collections }`, what the server serves                         |
| `describe`                 | `{ collection }`                                                                     | schema, view config, capabilities, filterable fields, source info |
| `list`                     | `{ collection, filter?, sort?, page? }`                                              | `{ rows, next_cursor, total }`                                    |
| `read`                     | `{ collection, id }`                                                                 | `{ row }`                                                         |
| `mutate`                   | `{ collection, op: "insert" \| "update" \| "delete", id?, row?, expected_version? }` | `{ row }`                                                         |
| `schema.add_field`         | `{ collection, name, fielddef, position }`                                           | `{ schema }`                                                      |
| `schema.update_field`      | `{ collection, name, fielddef }`                                                     | `{ schema }`                                                      |
| `schema.soft_delete_field` | `{ collection, field }`                                                              | `{ schema }`                                                      |
| `reindex`                  | `{ collection, scope, order_field?, gap? }`                                          | `{ updated }`                                                     |
| `tree.reparent`            | `{ collection, id, parent, order, fields, expected_version? }`                       | `{ row, updated }`                                                |
| `source.read`              | `{ collection }`                                                                     | the source file as written                                        |

A row is flat: `{ __meta: { id, version }, ...fields }`. `update` and `delete`
take `expected_version`; a stale one fails with `version_conflict`. Paging is
either a `cursor` (keyset) or an `offset`, never both.

```ts
import { ListRequestSchema, MutateRequestSchema } from "@jsudc/core";

const list = ListRequestSchema.parse({
  collection: "books",
  sort: [{ field: "year", dir: "desc" }],
  page: { limit: 50 },
});

MutateRequestSchema.parse({
  collection: "books",
  op: "update",
  id: "42",
  row: { title: "Na Drini ćuprija" },
  expected_version: 3,
});
```

## Filter DSL

A filter is a condition `{ field, op, value?, case_insensitive? }` or a group
`{ and: [...] }`, `{ or: [...] }`, `{ not: ... }`. The `filter` builders write
them for you, and `evaluateFilter(node, row)` runs one in memory with the same
semantics as the server's SQL compiler (useful for tests and optimistic
updates). One example per operator family:

```ts
import { evaluateFilter, filter } from "@jsudc/core";

filter.eq("status", "open"); // eq, neq
filter.in("country", ["RS", "HR"]); // in, not_in
filter.contains("title", "drina"); // contains, starts_with, ends_with (case-insensitive by default for contains)
filter.gte("year", 1945); // gt, gte, lt, lte
filter.between("price", 10, 20); // between, both ends inclusive
filter.isNull("deleted_at"); // is_null, is_not_null
filter.and(filter.eq("status", "open"), filter.not(filter.lt("year", 1900))); // and, or, not

evaluateFilter(filter.gte("year", 1945), { year: 1961 }); // true
```

The same JSON goes over the wire, so `{ "field": "year", "op": "gte", "value": 1945 }`
is exactly what `filter.gte("year", 1945)` returns; `FilterNodeSchema` validates
it.

## Schema, view and source documents

`SchemaDocSchema` (`{ version, core_fields, fields, field_order }` with one
`FieldDef` per field), `ViewConfigSchema` (renderers, columns, filters, search,
and the options of every renderer: cards, kanban, calendar, tree, map, chart)
and `SourceConfigSchema` parse the `schema.json`, `view.yaml` and `source.yaml`
files a collection is described by. `isValidFieldName` / `FIELD_NAME_RE` hold
the field-name rule (`^[a-z][a-z0-9_]{0,62}$`).

## validateRow

`validateRow(schema, row, { mode })` checks a row (`mode: "insert"`) or a
partial patch (`mode: "patch"`) against a schema and returns every problem; an
empty list means valid. The server runs it before writing, a form runs it
before sending.

```ts
import { SchemaDocSchema, validateRow } from "@jsudc/core";

const schema = SchemaDocSchema.parse({
  version: "1",
  fields: { title: { type: "string", required: true }, year: { type: "integer" } },
  field_order: ["title", "year"],
});

validateRow(schema, { year: "soon" }, { mode: "insert" });
// [{ field: "year", message: "must be an integer" }, { field: "title", message: "is required" }]
```

## The client

```ts
import { UdcClient } from "@jsudc/core/client";

const udc = new UdcClient({ httpUrl: "https://api.example.com" });
const { rows, total } = await udc.list({ collection: "books", page: { limit: 20 } });
```

`UdcClient({ httpUrl, headers?, fetch? })` has one method per action
(`collections`, `describe`, `list`, `read`, `mutate`, `reindex`,
`treeReparent`, `schemaAddField`, `schemaUpdateField`,
`schemaSoftDeleteField`, `sourceRead`) and a generic `call(action, payload)`.
It returns the `.ok` payload and throws `UdcError` on `.err`; a transport
failure (network, a non-200 from a proxy) is a plain `Error`, so a retry policy
can tell the two apart. Every request carries an `x-udc-message-id` header for
log correlation. It needs only a global `fetch` (browsers, Node 18+, React
Native); pass `fetch` to inject one.

## Develop

Requires Node 24 (`.nvmrc`).

```sh
npm ci              # also builds dist (the prepare script)
npm run typecheck   # tsc --noEmit over src and test
npm run lint        # Biome
npm test            # Vitest
npm run build       # tsc -> dist (ESM + .d.ts)
```

## License

MIT, see [LICENSE](LICENSE).
