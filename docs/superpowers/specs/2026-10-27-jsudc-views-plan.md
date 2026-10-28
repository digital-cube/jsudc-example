# jsudc views: analysis and implementation plan

Written 2026-10-27 for ticket TCKMC65N7J ("proširenje view-a"). Status:
**answered** — the owner answered the question ticket (TCKYX3EPKW) on
2026-10-27; the answers are in section 5 and the ticket order in section 4
follows them.

Companion to `2026-10-18-jsudc-design.md` (phase 1: table + cards over Postgres
jsonb). This document covers phase "views": more renderers (map, kanban,
calendar) and more data sources (files, the internet), with the variety the
owner asked for: one example whose source is the database, one whose source is
files on disk, and several whose source is data fetched from the net.

## 1. What the reference implementation has

Reference: `/home/digital/work/dclabs` (Python lib `libs/udc`, React lib
`libs/udc-js`, example collections under
`backend/services/svc_examples/collections_assets/`), live at
`https://examples.dclabs.digitalcube.work`.

### 1.1 Renderers (udc-js)

The React library registers eight renderers, chosen by the active tab name
(`UdcDataView.tsx:299-308`): `table`, `cards`, `kanban`, `calendar`, `map`,
`tree`, `chart`, `dropdown`. The Python side does **not** type their options:
`kanban_options`, `calendar_options`, `map_options`, `tree_options`,
`chart_options`, `card_options` and `dropdown_options` are untyped dicts passed
through verbatim (`core/view_config.py:252-332`). The real keys live only in
udc-js. That is exactly the drift jsudc exists to remove: in jsudc every option
block gets a Zod schema in `udc-core`.

| Renderer | Production LOC in udc-js | Library | Writes | Notes |
|---|---|---|---|---|
| kanban | 4,121 (+5,400 tests) | native HTML5 drag + own touch hook | `mutate update` with order/bucket fields, `reindex` on order collision, `mutate insert` quick-add, bucket rename/add/delete | windowed mode needs the `board` action (no Python adapter implements it; the fallback mode lists tickets filtered by board) |
| calendar | 3,928 (+4,500 tests) | `Intl.DateTimeFormat`, no date lib | `mutate update` with `{start, end}` patch (field names hardcoded, a known bug), delete | presets day/ndays/workweek/week/biweekly/month, viewer timezone, snap 15 min, optimistic cache patch, overridable validation errors |
| map | 327 | `leaflet` 1.9, OSM tiles, imperative | none | `lat_field`/`lng_field` required; `radius_field`, `popup_fields`, `center`, `zoom`, `icon: circle\|airplane`, `rotate_field`, `trail`, `regions`; no clustering, no GeoJSON |
| tree | 1,410 | own DnD | `mutate update {parent, order}` (no version, no reindex) | lazy children, server-side expand state and stars via REST side routes |
| chart | 577 | `recharts` | none | line/area/bar/pie, time-window presets as relative `gte` |
| cards | 860 | | none | jsudc already has its own |
| dropdown | 205 | | none | local combobox |

Shared: `UdcDataView.tsx` is 2,361 lines (tabs doc / renderers / schema / source
/ config, filter composition, edit mode, bulk bar). jsudc's data view is 291
lines and already does the parts that matter (URL state, search, chips, filter
builder, paging toggle, tab switch).

Order math (`kanban/orderMath.ts`): GAP 100; middle = `floor((prev+next)/2)`,
end = `prev+100`, start = `next-100`, empty = 100; collision when
`next-prev <= 1` triggers `udc.reindex {collection, scope, order_field, gap}`
which renumbers `ROW_NUMBER() * gap` server-side (postgres only).

### 1.2 Data sources (udc-py)

`Source` protocol: `describe / list / read / mutate / reindex / subscribe /
add_schema_field / update_schema_field / soft_delete_schema_field / rate`,
plus `capabilities {mutate, subscribe, total_count, schema_edit, config_edit,
reindex, source_yaml, board_snapshot, supported_filter_ops}`. Declared in yaml
as `source: {kind, options}`.

| kind | options | filter | sort | paging | write |
|---|---|---|---|---|---|
| `postgres_jsonb` | `table`, `schema_table`, `core_fields` | SQL pushdown, 14 ops | SQL, numeric casts | keyset cursor | full, versioned, `reindex` |
| `memory` | `schema` | in memory | in memory | cursor | full |
| `filesystem` | `root`, `allow_mutations`, `trash_dir`, `follow_symlinks`, `blob_max_inline_bytes` | synthetic `path` predicate picks the directory, rest in memory | by name | offset | rename / trash / mkdir |
| `http_api` | `base_url`, `list_endpoint`, `item_endpoint`, `id_field`, `schema`, `headers` (`${ENV}`), `field_map` (dotted, `[N]`, `[*]`), `list_unwrap`, `timeout`, `history`, `response_format json\|xml`, `mutate`, `expand_items`, `list_response_is_ids` | client-side after fetch (`eq, contains, in`) | ignored | `Link: rel=next` | update only when configured |
| `sse_stream` | `url`, `schema`, `buffer_size` | client-side | newest first | none | none |
| `yaml_menu` | `file` | `parent_id` only | file order | none | none |
| `opensearch` | `url`, `index`, … | term/terms | none | none | none |

**No server-side TTL cache for HTTP sources exists** in udc-py: every list call
hits the upstream. The examples site bounds the damage with timeouts, a
deadline, concurrency limits and documentation; rate-limit errors surface in a
banner. jsudc should do better (section 3.2).

Schema types: no geo type. A map is two numeric fields. `datetime` must carry
an offset.

### 1.3 The examples site

Menu of the `examples` tenant (verified live on 2026-10-27):

- **Local DB tables**: tasks, serbian_companies, countries (+ dropdown view),
  books (editable, bulk delete), movies, products (editable), tree_comments
  (tree), street_lights (table) and **Street lights — map** (a bespoke Leaflet
  page over REST endpoints, not the UDC map renderer).
- **Filesystem**: files (filesystem source over a bundled 19-file sample
  directory, drill-down by folder, preview modal), tree_files (postgres path
  tree), menu_simple and menu_sidebar (yaml_menu, tree renderer).
- **HTTP source**: repos (GitHub), **quakes (USGS, map + table + cards)**,
  tickers (CoinGecko, 30 s polling), **flightradar (OpenSky, map with airplane
  icons and trails; needs credentials)**, hn_top (Hacker News, id list +
  expand), pokemons (PokeAPI), mb_artists / mb_releases (MusicBrainz, offset
  paging, query pushdown), papers (arXiv, XML), recent_changes (Wikimedia
  SSE), issues (GitHub issues as a **kanban** over a static `issue_states`
  bucket collection).
- **Tickets kanban**: `boards` (3), `buckets` (15), `tickets` (36),
  `assignees` (77), all postgres jsonb. Per board: **Board / Table / Calendar
  / Board config** tabs. The calendar tab reads `calendar_options` on
  `tickets` (`starts_at` / `ends_at`, colour by priority).
- Calendars elsewhere: dental `appointments` (893 rows, colour per dentist,
  business hours 8–20, overridable "outside shift" error, detail panel with
  editable fields) and install `orders` (colour per team). The install map is
  again a bespoke react-leaflet page over REST, not the UDC map renderer.

Each example page has tabs **Doc** (README.md in the collection directory, en
+ sr), the renderers from `available_renderers`, **Schema**, and for static
sources **Source** (the yaml).

## 2. What jsudc has today

Branch `jsudc` (5 commits, phase 1 complete, all in Review):

- `packages/udc-core`: envelope, filter DSL + evaluator, `SchemaDoc`,
  `ViewConfig` (loose: dclabs views parse verbatim; the renderer option blocks
  are untyped today), the 8 actions `collections, describe, list, read, mutate,
  schema.add_field, schema.update_field, schema.soft_delete_field`.
- `backend`: Fastify `POST /udc/:action`, dispatcher, `Source` interface
  (`describe/list/read/mutate/addField/updateField/softDeleteField`,
  `capabilities`), `PostgresJsonbSource` (SQL pushdown, keyset + offset paging,
  revisions, expression indexes), `MemorySource` (array + `evaluateFilter`,
  offset paging), registry over `backend/collections/<name>/{view.yaml,
  schema.json, seed.json}`. Every collection is a Postgres table; `main.ts`
  makes a `PostgresJsonbSource` for each asset. There is no `source.yaml`.
- `frontend`: `UdcClient`, TanStack Query hooks (`useUdcCollection` infinite +
  pages, `useUdcMutate` optimistic, `useUdcSchema`), `<UdcDataView>` with URL
  state, search, chips, filter builder, paging toggle, tab switch between
  `table` and `cards` (hardcoded two-way branch), `TableRenderer`,
  `CardRenderer`, schema editor, i18n en/sr, light/dark. One collection:
  `companies` (200 rows).
- No polling (`refresh_interval_ms` parses but is ignored), no doc tab, no
  renderer registry, no `reindex`.

Gap to the goal, in one line: **two of eight renderers, one of seven source
kinds, one example collection.**

## 3. Target

### 3.1 Views and examples

Not every dclabs example; variety across renderers × sources. Proposed
catalogue (the owner may swap entries; see the question ticket):

| Collection | Source | Renderers | Why |
|---|---|---|---|
| `companies` (exists) | postgres_jsonb | table, cards, **map** | add `lat`/`lng` (city coordinate + jitter) to the seed so a **DB-backed map** exists and chips/filters visibly move the markers |
| `files` | **filesystem** (bundled sample dir, `UDC_FILES_ROOT` override) | table, cards | the "source is files" example: folder drill-down, size/mtime/ext, type colours, read-only |
| `quakes` | **http_api** USGS GeoJSON, no key, 60 s TTL | **map**, table, cards, **chart** | the "source is the net" example that also exercises the map: `radius_field: mag`, popups, `row_color` by magnitude |
| `flights` (TCKXM3D22D) | **http_api** OpenSky `/api/states/all` over a 5° × 5° Balkans box, anonymous (400 credits/day, 1 credit a call), 4 min TTL; optional OAuth2 client credentials (`UDC_OPENSKY_CLIENT_ID` / `_SECRET`) → 15 s | **map**, table, cards | the positional-array row (`id_field: "[0]"`, field_map by index, lng before lat), `epoch_seconds`, a server-side sliding `history` (`<field>_history` added to the described schema), `icon: airplane` turned by `rotate_field` with `trail`, table `sparkline` / `heading_glyph`, card `metric` / `sparkline`, auth and TTL in the freshness tooltip |
| `repos` | **http_api** GitHub `users/digital-cube/repos`, no key (60 req/h anonymous, so cache matters) | table, cards, **chart** | a second net example with nested `field_map`, avatars, topics as chips |
| `boards`, `buckets`, `tickets` | postgres_jsonb | boards: table; tickets: **kanban**, table, cards, **calendar** | the kanban example, dclabs data model, writable (drag, reorder, quick-add, bucket add/rename), `reindex` |
| `menu` | **yaml_menu** (`data/menu.yaml`, a `udc:collections` branch per group) | **tree**, table, Source | the application's own sidebar, as data: the same rows the sidebar is drawn from (TCKHPW6JRN) |
| `appointments` | postgres_jsonb | **calendar**, table | a dedicated calendar dataset: 8 "doctors" with a `color_map`, business hours 8–20, ~600 rows around today, drag to move/resize persists |
| `tree_comments` (or a yaml menu) | postgres_jsonb | **tree**, table | a threaded tree with `parent` + `order`, reusing the kanban's order math and `reindex` for sibling order; drag to re-parent |
| `metrics` (TCKMQ39XMT; no `tickers`, it needs a key) | postgres_jsonb, generated at seed time (3 hosts × 15 min × 30 days, ~8,640 rows, `SEED_TODAY` pins the end to noon in Belgrade) | **chart**, table | the chart example: cpu / mem lines on a left axis in %, load on a right axis framed on its own values; window presets 1h / 6h / 24h / 7d + custom sent as an absolute `between` on `ts` computed in the header's zone (no relative `gte`, the server stays dumb), `?win=` / `?from=&to=` in the URL and applied to the table tab too; rows from `useUdcAllRows` merged per instant and bucketed past ~600 points. Also a **chart** tab on `repos` (pie of stars, 10 slices + Other) and on `quakes` (bars of magnitude, 7d) |

Not planned now: an SSE source (`recent_changes`).

### 3.2 Architecture additions

**udc-core**

- `SourceConfig` Zod schema: `{kind: "postgres_jsonb" | "memory" | "filesystem"
  | "http_api" | "yaml_menu", options}` with a typed options object per kind.
- Typed option blocks: `MapOptions`, `KanbanOptions`, `CalendarOptions` (the
  keys udc-js actually reads, section 1.1; declared-but-unread keys are
  dropped). `ViewConfig` keeps `looseObject` so dclabs files still parse, but
  the three blocks are validated when present.
- `reindex` action: `{collection, scope: Record<field, value>, order_field?,
  gap?}` → `{updated}`.
- `collections` listing gains `source_kind` and an optional `group` so the
  sidebar can group Database / Files / Internet.
- Renderer name set: `table | cards | kanban | calendar | tree | map | chart` for
  `available_renderers` (others still parse, the UI shows them disabled).

**backend**

The source kinds jsudc serves (compare udc-py's in section 1.2):

| kind | options | filter | sort | paging | write | sidebar group |
|---|---|---|---|---|---|---|
| `postgres_jsonb` | `table` | SQL pushdown, every op | SQL, typed casts | keyset cursor and offset | full, versioned, `reindex`, `tree.reparent` | database |
| `memory` | — (`seed.json`) | `ArraySource`, every op | `ArraySource` | offset | full | database |
| `filesystem` | `root`, `follow_symlinks`, `max_entries` | `path eq` picks the folder, rest `ArraySource` | `ArraySource` | offset | none | files |
| `http_api` | `base_url`, `list_endpoint`, `id_field`, `list_unwrap`, `field_map`, `headers`, `timeout_ms`, `cache_ttl_ms`, `env_required`, `max_rows` | `ArraySource` over the cached copy | `ArraySource` | offset | none | internet |
| `yaml_menu` | `file` (in the collection directory, no `..`), `dynamic`, `collection_icons` | `ArraySource`, every op (udc-py: `eq` / `is_null` on `parent_id`) | file order, or `ArraySource` | offset | none; `source.read` serves the file (`capabilities.source_yaml`) | files |

`yaml_menu` (TCKHPW6JRN) flattens a nested YAML into `MENU_SCHEMA` rows with
udc-py's rules (id = sha1 of the code path, `order`, `depth`,
`ancestor_ids`, `children_count`), re-reads the file when its mtime or size
changes and keeps the last good read (`stale`) when it breaks. A branch whose
`children` is `udc:collections[?group=…]` is resolved inside the server from
the live registry (`is_dynamic: true`); udc-py's `api:` HTTP self-call is
refused at startup. The `menu` collection is this application's sidebar.

- `source.yaml` per collection directory, optional; absent means
  `postgres_jsonb` (today's behaviour). `makeSource(asset)` dispatches on
  `kind`. Capabilities are honest: read-only sources answer `mutate: false,
  schema_edit: false`, and the UI hides edit affordances accordingly (already
  the case for `schema_edit`).
- A shared **`ArraySource`** core (lift from `MemorySource`): filter through
  `evaluateFilter`, sort with type-aware comparison, offset paging, `total`.
  `FilesystemSource` and `HttpApiSource` both produce an array and delegate to
  it, so filter/sort/paging behave identically across the three non-SQL
  sources and the dispatcher tests cover all of them.
- `FilesystemSource`: `root`, `follow_symlinks: false`, read-only in this
  phase. Rows: `path, name, kind (file|dir), ext, size, mtime`; a `path eq
  <dir>` condition in the filter selects the directory (as udc-py), the rest
  of the filter applies in memory; `..` row for navigation. Path traversal is
  refused (`validation_error`). Optional `GET /udc/files/blob?collection&path`
  for a text/image preview (small, builder's call).
- `HttpApiSource`: `base_url`, `list_endpoint`, `id_field`, `field_map`
  (dotted paths, `[N]`, `[*]`), `list_unwrap`, `headers` with `${ENV}`
  interpolation (a header with an unset variable is dropped), `timeout`,
  **`cache_ttl_ms`** (server-side, per source, default 60 s, serves stale on
  upstream error with a `stale: true` hint in `__meta`), `env_required`
  (refuse to call upstream without the credential). Rows are normalised
  against the schema (types coerced where the schema says `integer`/
  `datetime`). `refresh_interval_ms` in the view drives frontend polling.
  Env flag `UDC_HTTP_SOURCES=off` hides the internet group for a deployment
  without egress.
- `reindex` on `PostgresJsonbSource`: `scope` fields must be in the schema
  (allowlist), `UPDATE … SET data = jsonb_set(data, '{order}', …) FROM (SELECT
  id, ROW_NUMBER() OVER (ORDER BY (data->>'order')::numeric, id) * gap …)`.
  Other sources answer `unsupported_op`.
- Fixture mode for tests: `HttpApiSource` accepts an injectable `fetch`; the
  e2e script starts the backend with `UDC_HTTP_FIXTURES=<dir>` so Cypress never
  touches the internet (recorded JSON responses committed under
  `backend/test/fixtures/http/`).

**frontend**

- A **renderer registry** `{name → component}` replacing the `table | cards`
  branch; `available_renderers` drives the tab control, with an icon per
  renderer. Tabs keep sharing search, chips, filter tree, sort, paging and
  URL state.
- **Doc tab**: `README.md` / `README.sr.md` in the collection directory served
  by `describe` (`view.docs` or a small `docs` action), rendered with `marked`;
  shown first when present, as on the examples site. Small; makes the catalogue
  self-describing.
- Sidebar grouped by `source_kind` (Database / Files / Internet) with a
  per-collection icon; the internet group shows a "cached · refreshed X s ago"
  hint from `__meta.fetched_at`.
- `useUdcCollection` gains `refetchInterval` from `view.refresh_interval_ms`.
- `MapRenderer`: `leaflet` (as udc-js) with OSM tiles, circle markers sized by
  `radius_field`, popups from `popup_fields` using the table's cell formatting,
  `row_color` → marker colour, `center`/`zoom`/`regions`, fit-to-rows when no
  center, a "rows on map / total" counter; marker click opens a small card
  (the cards renderer's card). Loads all rows of the current filter in pages
  until `total` (capped, e.g. 2,000) rather than only the first page.
- `KanbanRenderer`: columns from `bucket_collection` filtered by
  `bucket_filter_field eq board`, cards from the collection filtered by
  `ticket_board_field`, sorted by order; drag between and within columns
  (`@dnd-kit`, answer 6), order math and `reindex` on collision,
  optimistic overlay through the TanStack cache (`useUdcMutate` already patches
  every cached list), quick-add card, add / rename bucket, board switcher
  (`?board=`), card: title, body (2 lines), priority left border, tags chips,
  due date, assignee initials. No per-board config override, no windowed
  `board` action, no assignees collection in this phase.
- `CalendarRenderer`: presets day / workweek / week / month (biweekly if cheap),
  Today / prev / next, `?preset=&date=` in the URL, hour grid with
  `business_hours` shading and now-line, month grid with chips, colour by
  `color_field` + `color_map`, drag to move and resize with `snap_minutes` and
  `min_event_minutes`, writes through `useUdcMutate` using `start_field` /
  `end_field` **from the options** (fixes the udc-js bug), detail popover with
  title + start + end + delete. **The visible window is sent to the server as
  a `between` filter on `start_field`** (udc-js filters client-side over loaded
  rows, which breaks past the first page). Timezone: a header switch that
  changes the display zone live (answer 7), defaulting to the browser zone.

### 3.3 Non-goals for this phase

WebSocket push (polling instead), the dropdown renderer, SSE and
OpenSearch sources, per-board config editor and `board_config.*` actions,
`board` snapshot action, assignees as a collection, calendar validators (no
double booking) and overridable errors, filesystem writes, image proxy/cache,
auth. Phase-2 items from the design doc (row actions, column prefs,
multiselect/bulk) stay separate tickets after this phase.

### 3.4 Anti-goals

Renderer options typed in two places (they live in udc-core only). A renderer
that reads the wire shape of a specific example (every renderer is driven by
its options block, every example is only yaml + schema + seed). An HTTP source
that hits the upstream on every request. Cypress that depends on the internet.

## 4. Phases → tickets

Each ticket is one session on the `jsudc` worktree, model Opus 5.5. Order as
the owner set it (answer 1), all before the phase-2 tickets (answer 10):

| # | Ticket | Scope | Size |
|---|---|---|---|
| 1/6 | **Kanban** (TCK2KN2HP7) | **renderer registry** and **`useUdcAllRows`** (moved here from the map ticket, because this ticket now runs first), udc-core `KanbanOptions` + `reindex` action + shared order math, backend `reindex`, `boards`/`buckets`/`tickets` collections + generator, renderer with `@dnd-kit` DnD, quick-add, bucket add/rename, board switcher (`?board=`); Cypress | L |
| 2/6 | **Calendar** (TCK397MK2R) | udc-core `CalendarOptions`, `appointments` collection + generator, renderer with presets, server-side window filter, drag/resize, detail popover, header timezone switch that re-renders live (answer 7); calendar tab on `tickets` (uses its `starts_at`/`ends_at`); Cypress | L |
| 3/6 | **Tree** | udc-core `TreeOptions`, tree renderer over `parent` + `order` using the shared order math and `reindex`, drag to reorder / re-parent, lazy expand; an example collection; Cypress | M |
| 4/6 | **Map** (TCK2JP6DQ9) | udc-core `MapOptions`, Leaflet renderer registered in the existing registry and fed by `useUdcAllRows`, `companies` gets `lat`/`lng` and a map tab; the `quakes` map tab lands with the sources ticket; Cypress | M |
| 5/6 | **Sources: filesystem + http_api** (TCKF3U9HCC) | udc-core `SourceConfig`, backend `ArraySource`, `FilesystemSource`, `HttpApiSource` with TTL cache and fixture mode, registry dispatch, `files` / `quakes` (with a map tab) / `repos` with README, sidebar groups, doc tab, polling via `refresh_interval_ms`; TDD + Cypress | L |
| 6/6 | **Charts** | udc-core `ChartOptions`, a chart renderer (line/area/bar/pie) over `useUdcAllRows`, time-window presets; an example; Cypress | M |

Moved deliverables: the renderer registry and `useUdcAllRows` go from the map
ticket to the kanban ticket (1/6); the `quakes` map tab goes with the sources
ticket (5/6), which now runs after the map. Each later renderer registers
itself in `renderers/registry.ts` and, when it needs every row of the current
filter, reads them through `useUdcAllRows`.

## 5. Owner's answers (TCKYX3EPKW, 2026-10-27)

1. Order: kanban, calendar, tree, map, file + internet sources, charts (section 4).
2. Files example: as proposed (bundled sample directory, `UDC_FILES_ROOT` override, read-only).
3. Net APIs: `quakes` (USGS) and `repos` (GitHub), no API keys; they come after the map.
4. Caching and fixtures: as proposed (server-side TTL cache, stale on error, `UDC_HTTP_FIXTURES` for Cypress).
5. Map: Leaflet, and `lat`/`lng` on `companies`.
6. Kanban: as proposed — `boards`/`buckets`/`tickets` jsonb collections, `reindex`, drag between and within columns, quick-add, add/rename bucket, `?board=`, assignees as a `string_array`, no per-board config editor — with `@dnd-kit`.
7. Calendar: timezones matter — a header switch that changes the zone live.
8. Doc tab and grouped sidebar: yes.
9. Live updates: polling, no WebSocket.
10. These view tickets run before the phase-2 tickets (row actions, column prefs, multiselect).

## 6. Verification across the phase

`npm test`, `npm run typecheck`, `npm run lint`, `npm run e2e` green from a
fresh clone with no network access (HTTP fixtures). Each ticket attaches
light/dark screenshots of its renderer. The demo script `docs/demo.md` gets a
section per view.
