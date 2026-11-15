# jsudc — lookups (level 1) and drill-down

Design spec, 2026-11-11, updated 2026-11-15 to what was built. Status:
implemented on the branches `feat/lookups` of `jsudc-core`, `jsudc-server` and
`jsudc-react`, waiting for review and a lockstep release (0.3.0). Source
tickets: TCK3HWDQYU (fabian-demo1), TCKKRHCYDE (this project).

Decided on the ticket: `row_link` goes in `view.yaml` (not as a phase-2
`row_action_def`); display and drill-down come first, cross-collection
filtering (level 2) later.

## 1. Types (`@jsudc/core`)

```ts
type LookupDef = {
  collection: string;      // target collection
  key_field?: string;      // default: the target's row id (__meta.id)
  label_field: string;     // shown in the cell, the chip and the combobox
  extra_fields?: string[]; // fetched with the label; the link's tooltip
};

// FieldDef for type "lookup" | "lookup_array" gets `lookup: LookupDef`.
// lookup:        value is string | integer (the key)
// lookup_array:  value is (string | integer)[]

type RowLink = {
  collection: string;
  filter: { field: string; value_from: string }; // value_from: a field of the row, or "id"
};
// ViewConfig gets `row_link?: RowLink`.
```

Zod in core checks the shape only (names are `FIELD_NAME_RE` names, a
`lookup` block on any other type is an error). The server checks that the
names exist when it loads the registry, because only the server sees the other
collection's schema. Core exports the checks themselves (`lookupProblems`,
`lookupFieldProblems`, `rowLinkProblems`) so any server can run them, plus the
helpers both sides use: `lookupOf`, `lookupKeyField`, `lookupKeyOf`,
`lookupKeysFilter`, `rowLinkValue`, `rowLinkCondition`, `isRowIdField`,
`isLookupKey`, `LOOKUP_FIELD_TYPES`, `STORABLE_FIELD_TYPES`,
`LOOKUP_FILTER_OPS`, `LOOKUP_ARRAY_FILTER_OPS`.

**Legacy spelling.** The dclabs/udc-py form is flat: `"ref": "boards",
"label_field": "name"`. Core accepts it for `lookup` / `lookup_array` and
normalises it to `lookup: {collection, label_field}` (the flat keys are
dropped), so dclabs files keep parsing and `describe` always sends the nested
form. A `ref` without `label_field` is a dc-lookups path (`"ref":
"Books.Genre"` in the dclabs `books` fixture) and is left alone: it parses, and
a jsudc server refuses to *serve* it (`a lookup field needs lookup:
{collection, label_field}`). `relation` is not normalised: it is level 2.

## 2. Example `schema.json` (tickets)

```json
"board_id":  { "type": "lookup", "required": true, "index": true,
               "lookup": { "collection": "boards",  "label_field": "name" } },
"bucket_id": { "type": "lookup", "required": true, "index": true,
               "lookup": { "collection": "buckets", "label_field": "name" } },
"assignees": { "type": "lookup_array",
               "lookup": { "collection": "org", "label_field": "name",
                           "extra_fields": ["title"] } }
```

`buckets.board_id` keeps the flat spelling (`"type": "lookup", "ref":
"boards", "label_field": "name"`) on purpose: the example shows both forms
work.

The example used `relation` (the level-2 type) for `board_id` / `bucket_id`.
Moving them to `lookup` is a schema-type change, which `schema.update_field`
refuses, so it goes in through `schema.json` plus a reseed (`npm run seed --
--reset`), not through the API. `assignees` held names; `generate-kanban.ts`
now draws them from the first ten people of `org` (by id, from
`generate-trees.ts`), the rest of the seed is byte-for-byte the same.

## 3. Example `view.yaml` (drill-down)

```yaml
# backend/collections/boards/view.yaml
row_link:
  collection: tickets
  filter: {field: board_id, value_from: id}
```

Clicking a board row opens
`/udc/tickets?f=<base64url {field: board_id, op: eq, value: <row id>}>`.
`row_link` needs no `lookup` field. Any two collections that share a value
can be linked this way, which covers the "aggregate → details" reports.

## 4. Server (`@jsudc/server`)

- **Storage.** The key sits in `data` as it came. Sort and filter run on the
  key as text (by code point, like every text sort since 0.2.1), so `7` and
  `"7"` are the same key and `"b-10"` sorts before `"b-2"`. An indexed
  `lookup` gets an expression index like a string.
- **Ops.** `lookup`: `eq neq in not_in is_null is_not_null`. `lookup_array`:
  `in` (any key of the row in the list), `not_in` (none), `is_null`,
  `is_not_null`. Anything else on these types is `unsupported_op`, in every
  source; `describe.filterable.fields[].ops` lists exactly these sets
  (`filterableForType`). `capabilities.supported_filter_ops` stays the
  collection-wide list: per-type ops already live in `filterable`, so the
  ticket's "supported_filter_ops per field type" is served there instead of
  growing `capabilities`.
- **The row id in a filter.** A condition on `id`, in a collection whose
  schema has no live `id` field, means the row id (`isRowIdField`), with the
  lookup ops. This is what makes a lookup keyed by id resolvable in one call
  (`{field: "id", op: "in", value: keys}`) and what a lookup link opens. It
  adds no syntax to the filter DSL and no rule for field names. Sorting by
  `id` is still refused: the id is already every sort's tiebreaker.
- **Checks at start.** `loadRegistry` checks every lookup field and every
  view's `row_link` against the served collections' `schema.json`; `udcPlugin`
  (given `registry`) checks again against the active schemas, because a
  revision may have dropped a field (`checkLinks: false` skips this). The
  target must be served and have `label_field`, `key_field` and
  `extra_fields`; `row_link.filter.field` must exist in the linked collection,
  `value_from` must be `id` or a field of this one. A collection the factory
  does not serve (an http_api one with `UDC_HTTP_SOURCES=off`) counts as
  missing. Any problem stops the start, one line each:
  `tickets.board_id: lookup target boards has no field title`.
- **Schema edits.** `schema.add_field` accepts `lookup` / `lookup_array`
  (`STORABLE_FIELD_TYPES`) and checks the target against its active schema
  first; `schema.update_field` checks the same. A mismatch is a
  `validation_error`.
- No JOIN, no `expand`.

## 5. React (`@jsudc/react`)

- `useUdcLookup(target, keys)` makes one `list` with an `in` filter over the
  key field. The query key is `["udc", "lookup", collection, sortedKeys]`
  (plus the key field when it is not `id`). More than 1000 keys go in several
  calls (the page limit). `useUdcMutate` invalidates the lookups and the
  pickers of the collection it wrote, so a renamed board shows at once.
- **Batching.** The table and the kanban board call `useLookupBatch(rows,
  schema)`: one `useUdcLookup` per lookup field over the rows on screen, handed
  down by `<UdcLookupBatch>`. A table page costs one extra call per lookup
  field. A `LookupValue` outside a batch (or whose key the batch did not ask
  for) resolves its own keys.
- **Cell.** `CellValue` draws `LookupValue` for a lookup field (unless the
  column sets `render`): the `label_field` as a link to
  `<target>?f=<{field: <key field>, op: eq, value: key}>`, the bare key (mono,
  muted) until the label arrives or when the target has no such row,
  `extra_fields` as the tooltip. `lookup_array` renders as chips. Cards, the
  kanban card detail and the calendar event detail use the same cell; the
  kanban card's avatars read the labels of an `assignees_field` that is a
  `lookup_array`.
- **Chip.** A `select` chip over a lookup field (`LookupSelectChip`) loads its
  options from the target, by `label_field`, 50 at most. When the target has
  more than 50 rows it shows a search box that asks the server (`contains` on
  `label_field`, case-insensitive). The chip state stays a list of key strings
  in `?cf=`; the summary shows labels.
- **Inline edit.** An `editable` lookup column edits with `LookupCombobox`: a
  search over the target under the cell, arrow keys, Enter picks, Escape
  cancels. On `lookup` a pick writes the key ("— none —" clears it). On
  `lookup_array` a pick adds or removes a key, Backspace removes the last,
  Enter on an empty search (or Tab, or leaving the editor) writes the list.
  The stored key keeps its type (a number stays a number).
- **`row_link`.** A click on a row navigates; Cmd/Ctrl-click and the middle
  button open a new tab. Rows show a pointer cursor. A click in an editable
  cell, on a link or on a control stays where it is, so double-click still
  edits there.
- **Where links go.** The library has no routes of its own. The host says
  where a collection's view is: `UdcReactRouterUrlState collectionPath={(c) =>
  \`/udc/${c}\`}` under react-router (navigates through the router), or
  `UdcProvider links={{href, navigate}}`. The default is `/c/<collection>`,
  followed with `history.pushState` plus a `popstate` event.

## 6. Level 2 — what level 1 must not rule out

- `relation` keeps its name, reserved for the server-side JOIN:
  `list.expand: [field]` and dotted paths (`board_id.name`) in filter and sort.
  This changes the field-name rule `^[a-z][a-z0-9_]{0,62}$` and goes out as
  its own lockstep version.
- Level 1 adds no dot to field names and no `expand`. A schema that already
  has `relation` keeps parsing. The server still refuses to *add* one
  (`unsupported_op`), as it does today.
- Many-to-many and depth > 1 are decided when a project asks for them.

## 7. Differences from the ticket text (to confirm)

1. The ticket names `tickets.assignee` and `tickets.board`. The real fields
   are `assignees` (a `string_array`, so it became `lookup_array`) and
   `board_id`. The `assignees` seed held names, not `org` ids, so `seed.json`
   was regenerated.
2. The ticket puts a `row_link` from `metrics` to `tickets`. `metrics`
   (host, cpu, …) shares no field with `tickets`, so that link has nothing
   to filter on. Built instead: `boards → tickets`.
3. `value_from: id` is allowed explicitly, because the id is in `__meta`, not
   among the fields; so is a filter on `id` (§4), which the lookup by id needs.
4. The ticket's link target `/c/<collection>` is the library default; the
   example app's route is `/udc/<collection>`, set through `collectionPath`.

## 8. Not done in level 1

- The schema editor (`FieldFormDialog`) does not offer `lookup` /
  `lookup_array`: its type list is still `PHASE1_FIELD_TYPES`. The server
  accepts them through `schema.add_field`; a form for "which collection, which
  label" is its own small ticket.
- The filter builder (`?f=` tree) has no lookup widget: a lookup condition
  there takes keys as text. The chip is the way to filter by label.
- Soft-deleting a field that another collection's lookup uses as
  `label_field` is not refused at edit time; the next start reports it.
