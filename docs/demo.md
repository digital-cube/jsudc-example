# jsudc in two minutes

A demo script for the phase-1 build: one collection (`companies`, 200
synthetic Serbian companies) served from Postgres jsonb through the generic
UDC path, shown as a table and as cards, with columns added from the UI.

## Before you start

```sh
nvm use
npm install
npm run db:setup
npm run seed -- --reset     # 200 companies, 3 boards / 15 buckets / 60 tickets, schemas back to revision 1
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

## What is behind it

- One protocol package, `packages/udc-core`, holds the Zod schemas the server
  validates with and the browser types against.
- One endpoint, `POST /udc/:action`, serves `describe`, `list`, `mutate` and
  `schema.*`. The new column shows up because `describe` derives a column for
  every schema field that `view.yaml` does not list.
- Schema edits are revisions in `udc_schema_revisions`. A soft delete marks
  the field `deleted: true` and keeps its values.
