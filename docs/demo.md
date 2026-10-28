# jsudc in two minutes

A demo script for the phase-1 build: one collection (`companies`, 200
synthetic Serbian companies) served from Postgres jsonb through the generic
UDC path, shown as a table and as cards, with columns added from the UI.

## Before you start

```sh
nvm use
npm install
npm run db:setup
npm run db:migrate -w @jsudc/backend   # once after pulling: new collection tables (0003 appointments … 0005 metrics)
npm run seed -- --reset     # 200 companies (with lat / lng), 3 boards / 15 buckets / 60 tickets, ~640 appointments around today, 30 days of metrics up to now
npm run dev                 # backend :5100 + Vite (it prints its port)
```

Open `http://localhost:<vite port>/udc/companies`. Light/dark and EN/SR are in
the top bar; both are remembered. Every choice below lands in the address bar,
so a link (or a reload) reproduces the screen.

Re-run `npm run seed -- --reset` before showing the demo again: it also drops
the column added in step 6.

## The eight steps

1. **Browse.** The table opens with 50 of 200 rows and loads more as you
   scroll. PIB and Name are pinned; scroll sideways and a shadow appears at
   their edge. Inactive companies are muted (`row_color` in `view.yaml`).

2. **Sort.** Click the **Employees** header: ascending, again for
   descending, a third time to clear. Shift-click a second header to add it as
   a secondary sort. The sort runs on the server over the numeric jsonb cast,
   so 10 comes after 9.

3. **Filter.** Type `Beograd` in the search box: name, PIB, MB and city are
   searched, and "Showing X of Y" follows the server's total. Add the
   **Active → No** chip, then **Filter → Employees between 100 and 200**.
   Reload: the filter survives, because it is encoded in `?f=`.

4. **Switch paging.** In the top right, switch **Infinite** to **Pages**. A
   pager appears with the total and page count. Go to page 3, then switch back
   to **Infinite**. The choice is remembered per collection.

5. **Edit a cell.** Double-click a City cell (or focus it and press Enter),
   type a new value, press Enter. Escape cancels, and Tab moves to the next
   editable cell. The save carries the row version: if someone changed the row
   in the meantime, a toast says so and the cell shows their value.

6. **Add a column.** Hover the **Name** header and open its **⋮** menu, then
   **Add column after**. Type the English label `Website`; the field name
   `website` is suggested from it. Type the Serbian label `Veb sajt` and click
   **Add column**. The column appears right after Name, with no reload. Other
   things to try from here:
   - type `Web Site` as the name to see the live validation;
   - **Edit column** → **Required** shows a red star in the header;
   - **Delete column** asks first; the data stays in the database.

7. **Fill it.** Double-click a Website cell of the first row, type
   `https://orao.rs`, press Enter. Switch the language to **SR**: the header
   now reads **Veb sajt**.

8. **See it in cards.** Click **Cards**. The search, chips, filter, sort and
   paging carry over. The first company's card now has a **Website** line.
   The view lists `website` in `card_options.meta_fields`, and the cards only
   show it once the field exists. Each card has the name as title, the PIB as
   subtitle, an initials avatar, and the same formatting as the table
   (thousands separators, the ✓/✗ for Active).

## The kanban: `tickets`

Open `http://localhost:<vite port>/udc/tickets`. The **Board** tab is the
view's default; **Table** and **Cards** show the same rows.

1. **The board.** It opens on the first board, *Product roadmap*: five
   columns (Backlog, Ready, In progress, Review, Done) with their counts, cards
   with a priority edge and dot, tags, due date (red when past), assignee
   initials and the key. The toolbar says *Showing 20 of 20*: cards on this
   board. There is no paging toggle here; the board loads every card of the
   filter.
2. **Drag.** Drag the first Backlog card to the top of *In progress*. It
   stays there after a reload: the move is one `mutate update {bucket_id,
   order}` with `expected_version`. Drag a card within a column, or drag a
   column by its header to reorder the columns.
3. **Keyboard.** Tab to a card, press **Space**, move it with the arrow keys,
   press **Space** again. **Enter** opens the card.
4. **Quick-add.** *Add ticket* at the bottom of *Review*, type a title, press
   Enter. A placeholder shows until the server row arrives. Its order is the
   last card's + 100 (at the top: the first card's − 100).
5. **Columns.** The `⋯` menu of a column renames it inline; *Delete bucket*
   only works on an empty column. *Add bucket* after the last column adds
   one at the end.
6. **Boards.** Switch boards with the select in the toolbar. The board is
   `?board=<id>` in the address bar, so a link opens the same board.
7. **Search and chips.** Type `export` in the search, or pick a Priority or
   Tags chip: the board narrows to the matching cards (*Showing 1 of 20*).
8. **Collisions.** Orders are sparse (100, 200, …). If two neighbours end up
   one apart (say 100 and 101), a drop between them first calls `reindex`,
   which renumbers that column to 100, 200, …. Then the move is tried once
   more. To see it, set two orders with `mutate` and drop between them. The
   Cypress spec `kanban.cy.ts` does exactly that.

Everything the board does comes from `kanban_options` in
`backend/collections/tickets/view.yaml`, typed by `KanbanOptionsSchema` in
`udc-core`.

## The calendar: `appointments` and the time zone switch

`npm run seed` generates the appointments around the day it runs (six weeks
either side, Belgrade working hours). To show exactly the screens below, seed
with the day pinned: `SEED_TODAY=2026-10-27 npm run seed -- --reset`, then
open `http://localhost:<vite port>/udc/appointments?date=2026-10-27`.

1. **The work week.** The calendar opens on the work week (the view's
   `default_preset`), scrolled to 07:30, one colour per doctor. Overlapping
   appointments share the column in lanes; the grey bands are outside
   `business_hours` (8–20); a red line marks now. *Showing N of N* counts the
   appointments of the visible week: the calendar asked the server for just
   that window (`between` on `start`, from 00:00 Monday to 23:59:59.999 Friday
   in the active zone; see the `list` call in the network tab).
2. **Navigate.** Prev / Next / Today and Day · Work week · Week · Month. The
   window is `?preset=&date=` in the address bar. In Month, a day shows four
   chips and *+N more*; click it for the whole day, or click the day number to
   open that day.
3. **Move and resize.** Drag an appointment one hour down: it snaps to 15
   minutes and is saved at once (`mutate update {start, end}` with the row's
   version; the fields come from `start_field`/`end_field`). Drag it to another
   day column, or drag its bottom edge to make it longer. Escape during a drag
   puts it back. In Month, drag a chip to another day: same time, new day.
4. **Details.** Click an appointment: its time in the active zone, the doctor
   and patient, and room, status and notes editable in place. *Delete* asks
   once more. Click empty time to add one: type a title, Enter (the doctor is
   the one picked in the *Doctor* chip, else the first).
5. **Filter.** Pick *Ana Vuković* in the Doctor chip: one colour left on the
   grid. Search and chips combine with the window.
6. **The time zone.** The header has a zone switch next to the language and
   theme (it starts on the browser's zone). Find the 08:00 *Check-up · Aleksa
   Jović* on Tuesday 27th and switch the header to **America/New_York**: it
   moves to **3:00 AM** at once, without a reload. (On most dates of the year
   it would be 2:00; on 2026-10-27 Europe has left summer time and New York
   has not yet, so the gap is five hours.) **Asia/Tokyo** shows it at 4:00 PM;
   **UTC** at 7:00 AM. The days now run from midnight in that zone, so the
   next `list` call asks for a different window, ending in `-04:00`. The
   **Table** tab shows the same shifted times in the *Start* column. Reload:
   the zone is remembered (this browser, `localStorage`), and it is not part
   of the link. A drag made while New York is active writes New York's offset
   (`2026-10-27T04:00:00-04:00`); the server stores the instant, so Belgrade
   sees it at 09:00.
7. **Tickets.** `tickets` has a **Calendar** tab too: about 40% of the
   tickets have a slot in the current or next week, coloured by priority. The
   board select stays in the toolbar and `?board=` carries over from the
   board tab.

Everything the calendar does comes from `calendar_options` in each
`view.yaml`, typed by `CalendarOptionsSchema` in `udc-core`; the server
refuses to start if `start_field` / `end_field` are not `datetime` fields.

## The tree: `comments` and `org`

Two collections share one `tree` renderer, driven only by `tree_options` in
their `view.yaml` (typed by `TreeOptionsSchema` in `udc-core`; the server
refuses to start when a field it names is not in the schema, or when a lazy
tree has no `children_count_field`).

1. **A thread.** Open **Comments**: one discussion of 80 comments, read in
   one page and built in the browser (`lazy: false`), fully expanded
   (`default_depth: 99`). The toolbar counts *80 nodes*. Up / Down move
   between comments, Left closes one, Right opens it, Enter shows every
   field.
2. **Search.** Type *Beograd*: the matching words are marked, every comment
   on the way to a match opens and the rest of the thread closes
   (`on_search: highlight_and_expand`, `collapse_others`). Nothing went to the
   server: the whole thread is still loaded. Clear the search and the tree is
   back as you left it.
3. **Reply.** `⋮` on a comment → *Reply*, write, Enter. The reply appears
   under it (by "You"), with `parent_id`, `depth` one deeper and the next
   sparse `order`.
4. **Chips.** Pick an author in the *Author* chip: the filter runs on the
   server; a reply whose parent did not match is drawn as a root with a small
   muted arrow, so nothing disappears just because its parent was filtered.
5. **One level at a time.** Open **Organisation** (`lazy: true`): the company
   with its six departments; *1 of 134 nodes*. Open *Inženjering*: one more
   `list` with `parent_id eq <id>` brings its teams, with a spinner while it
   loads; the badge is the stored `children_count`. What you open is
   remembered (`udc:tree:org` in `localStorage`).
6. **Rename.** Double-click *Podaci*, type, Enter: saved with the row's
   version; reload, it stays.
7. **Move.** Drag *Platforma* onto *Prodaja*: it becomes Prodaja's last team.
   Drop it on the thin gap above a sibling instead to place it between two.
   One `tree.reparent` call moves it: the server writes `parent_id` and
   `order`, recomputes `depth` and `ancestor_ids` for the team and every
   person in it, and recounts both departments' `children_count` — in one
   transaction (badges: *Inženjering 3*, *Prodaja 4*). Try to drag
   *Inženjering* onto one of its own teams: the target is refused while you
   drag and nothing is sent (the server would refuse the cycle too).
8. **Filters.** *Kind = person* plus a search for *Vođa* lists the matching
   people as roots (their teams did not match); the **Table** tab shows the
   same rows flat.

## The map: `companies` on OpenStreetMap

The same 200 companies, placed: each has a `lat` / `lng` a few km from the
centre of its city (`backend/scripts/generate-companies.ts`). A database
seeded before this ticket has no coordinates (and schema revision 1 without
the two fields): run `npm run seed -- --reset` once. The `map` renderer is
driven only by `map_options` in `view.yaml` (typed by `MapOptionsSchema` in
`udc-core`; a view that lists `map` without `map_options`, or names a field
the schema lacks, stops the server at start).

1. **Open the map.** On **Companies** pick the **Map** tab (`?tab=map`). One
   circle per company over Serbia, sized by head count
   (`radius_min + employees * radius_scale`, capped at `radius_max`),
   inactive companies in grey (the view's `row_color`, the same rule that
   dims them in the table). The toolbar reads *200 on map of 200*. The tiles
   come from `tile.openstreetmap.org`, straight from the browser.
2. **Hover and click.** A circle gets an outline on hover; click one and its
   popup shows `popup_fields` (name, city, industry, employees) formatted as
   the table formats them, and the circle stays highlighted until the popup
   closes.
3. **Regions.** *Serbia* is pressed: it is the view the map opened on.
   *Vojvodina* and *South* fly there; *Fit all* frames every company, and no
   region button is pressed any more (the same happens when you pan by hand).
4. **Chips move the markers.** *City = Niš*: only the Niš companies stay,
   *N on map of N*. Add *Employees ≥ 500* or search a name: the circles
   follow, as the table rows would. The map keeps where you put it.
5. **Same filter, any tab.** Reload: still the map, still Niš. Switch to
   **Table**: the same rows, the `lat` / `lng` columns at the end. Search for
   something that does not exist: the table's empty state, over the map.
6. **Dark.** Switch the theme: the tiles are inverted by a CSS filter on the
   tile pane, the circles take the dark theme's colours.

## Files and the internet: `files`, `quakes`, `repos`

Not every collection is a table. A `source.yaml` next to `view.yaml` says
where the rows come from (`backend/collections/<name>/source.yaml`; without
one, Postgres). The sidebar groups the collections that way: **Database**,
**Files**, **Internet**. Each of the three new ones has a **Doc** tab, its
`README.md` (or `README.sr.md` in Serbian).

1. **Files.** Open **Files**: the entries of `backend/collections/files/sample/`,
   folders first, sizes as `167 B` / `29.6 KB`, read-only (no inline edit,
   no column menus, no `+`). Click `docs`, then `archive`: the address bar's
   `?f=` holds `path eq docs/archive`, the breadcrumb above the table is that
   condition, and a reload (or the link sent to someone) opens the same
   folder. `..` and the breadcrumb go back up. *Ext = csv* and the search box
   work inside the open folder. Click `notes.md` or `logo.png`: a preview
   (`GET /udc/files/blob`, text and images up to 256 KB). Point it elsewhere
   with `UDC_FILES_ROOT=/some/folder npm run dev`.
2. **Earthquakes.** Opens on the **map**: every M4.5+ earthquake of the last
   month, live from USGS, sized by magnitude and coloured by class (the same
   `row_color` tints the table). *Europe* / *Pacific* fly there. *Mag* is a
   range chip (6 – 8 leaves the strong ones), *Alert* a select. The toolbar
   reads *updated N s ago*: the server keeps the feed for 60 s and the page
   polls every minute (`refresh_interval_ms`), without moving the map. Switch
   to **Table**: the same filter, alert and status as coloured badges.
3. **Repositories.** The public repositories of `digital-cube`, from the
   GitHub API, as cards with the owner's avatar, the language and the topics.
   Without `UDC_GITHUB_TOKEN` GitHub allows 60 calls an hour; the five-minute
   cache keeps this collection at 12 at most.
4. **Offline.** If an upstream fails after a good fetch, the last copy is
   served with a **stale** pill; if it never answered, the view shows the
   error. `UDC_HTTP_SOURCES=off npm run dev` leaves the Internet group out;
   `UDC_HTTP_FIXTURES=backend/test/fixtures/http` serves recorded answers
   (what `npm run e2e` does, so Cypress never needs the network).

## Charts: `metrics`, the `repos` pie, the `quakes` bars

The **chart** tab draws whatever `chart_options` in `view.yaml` says (typed by
`ChartOptionsSchema` in `udc-core`; the server refuses to start when a series
is not a number field or a field is missing). `metrics` is a dedicated
dataset: three servers sampled every 15 minutes for the 30 days before
`npm run seed` ran (generated at seed time, ~8,600 rows). The short windows
end at the seed, so reseed (`npm run seed -- --reset`) before showing it on
another day.

1. **The 24h window.** Open **Server metrics**: CPU and memory as lines on the
   left axis (0–80 %, round ticks), the load average on the right axis framed
   on its own numbers. Without a host chip each point is the mean of the three
   hosts at that quarter hour; the spike three hours before the end is
   `web-1`'s incident. The toolbar reads *N points in window of 8,640*: the
   chart asked the server only for its window — in the network tab the
   `list` call carries `{"field":"ts","op":"between","value":[…]}` from 24
   hours ago to now, written with the header zone's offset, ANDed with the
   chips and the filter tree.
2. **Presets.** 1h · 6h · 24h · 7d sit in the toolbar row; the choice is
   `?win=7d` in the address bar. 7d is the last seven *calendar days* in the
   active zone (midnight six days ago to the end of today): the axis turns to
   days, the weekend dips show, and the rows are averaged into half hours so
   the line stays readable. *Custom* opens a from / to pair (`?from=&to=`,
   wall times read in the header's zone).
3. **Hover and legend.** Hover the plot: a tooltip with the time and each
   series formatted as the table formats them (`27.10.2026 18:30`, `50.4`).
   Click *Memory %* in the legend to hide it; the left axis re-frames on what
   is left.
4. **One host.** Pick *db-1* in the **Host** chip: the lines are now one
   server's samples (the database's memory sits nearly flat, 71–74 %), and the
   tooltip shows that row's values exactly.
5. **The time zone and the window.** With 6h picked, switch the header zone
   from **Europe/Belgrade** to **Asia/Tokyo**. The axis relabels at once
   (at noon in Belgrade, 06:00–12:00 becomes 14:00–20:00), and the next `list` call's `between`
   reads `…T14:00:00.000+09:00` – `…T20:00:00.000+09:00`: the hour presets
   are the same instants in every zone, written in its offset. Pick **7d**:
   now the zone moves the instants themselves — Tokyo's week starts at
   `2026-10-21T00:00:00.000+09:00`, seven hours before Belgrade's
   `…+02:00` (dates as with `SEED_TODAY=2026-10-27`). Reload: the zone
   (`localStorage`) and the preset (the URL) are both kept.
6. **The same window in the table.** Switch to **Table** with a preset picked:
   the table asks for the same `between` and shows those rows (the window
   control stays in the toolbar, with a × to drop it and see all 8,640).
7. **Repositories as a pie.** Open **Repositories** → **Chart**: stars per
   repository, the ten largest as slices with their percentage and the rest
   folded into **Other** (`max_slices: 10`). The recorded fixture has star
   counts set on sixteen repositories for this; the live GitHub account has
   only three starred ones, so live it is a three-slice pie.
8. **Earthquakes as bars.** **Earthquakes** → **Chart**: one bar per quake
   over the last 7 days, height = magnitude, the axis framed on the
   magnitudes (`baseline: data`) rather than on zero. 24h · 7d · 30d move the
   window; the page polls every minute as the map does.

Light and dark use the categorical palette `--chart-1 … --chart-8` in
`index.css`, a validated order with its own dark steps. Cypress
(`frontend/cypress/e2e/chart.cy.ts`) freezes the browser clock at the
seed's noon, so every `between` above is checked to the millisecond.

## What is behind it

- One protocol package, `packages/udc-core`, holds the Zod schemas the server
  validates with and the browser types against.
- One endpoint, `POST /udc/:action`, serves `describe`, `list`, `mutate`,
  `schema.*`, `reindex` and `tree.reparent`. The new column shows up because `describe` derives a column for
  every schema field that `view.yaml` does not list.
- Schema edits are revisions in `udc_schema_revisions`. A soft delete marks
  the field `deleted: true` and keeps its values.
- Files and the internet go through the same `list`: `FilesystemSource` and
  `HttpApiSource` produce an array and `ArraySource` filters it with the
  same `evaluateFilter`, sorts it by schema type and pages it by offset.
