# jsudc in two minutes

A demo script for the phase-1 build: one collection (`companies`, 200
synthetic Serbian companies) served from Postgres jsonb through the generic
UDC path, shown as a table and as cards, with columns added from the UI.

## Before you start

```sh
nvm use
npm install
npm run db:setup
npm run seed -- --reset     # 200 companies, schema back to revision 1
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

## What is behind it

- One protocol package, `packages/udc-core`, holds the Zod schemas the server
  validates with and the browser types against.
- One endpoint, `POST /udc/:action`, serves `describe`, `list`, `mutate` and
  `schema.*`. The new column shows up because `describe` derives a column for
  every schema field that `view.yaml` does not list.
- Schema edits are revisions in `udc_schema_revisions`. A soft delete marks
  the field `deleted: true` and keeps its values.
