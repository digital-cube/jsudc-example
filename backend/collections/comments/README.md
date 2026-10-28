# Comments

One discussion — *working from home or from the office?* — of 80 comments:
8 top-level comments and their replies, up to six levels deep. Ten invented
authors with Serbian names; the text is synthetic. The source is the
database (Postgres jsonb), seeded from `seed.json`, which
`backend/scripts/generate-trees.ts` writes deterministically.

- **One page, built in the browser** (`tree_options.lazy: false`). The tree
  tab reads the whole (filtered) collection — `page_size_default: 200`, one
  page holds the thread — and builds the thread from `parent_id`. Replies
  sit under a comment oldest first (`sibling_sort: created_at asc`).
- **Opens fully expanded** (`expand.default_depth: 99`). What you open or
  close is remembered in this browser (`localStorage`, `udc:tree:comments`).
- **Search highlights** (`on_search.mode: highlight_and_expand`). Type
  *Beograd*: the whole thread stays loaded, the matching text is marked,
  every comment on the way to a match opens and the other branches close
  (`collapse_others`). Clearing the search restores what was open before.
- **Chips filter server-side.** *Author* or *Score* narrows the rows; a
  reply whose parent was filtered out is drawn as a root with a muted
  marker, so a filter never hides a whole branch.
- **Reply** (`interactive.reply`). The `⋮` menu of a comment has *Reply*:
  write in the box under it and press Enter. The reply is inserted with
  `parent_id`, `depth` (parent + 1), the next sparse `order` and `created_at`
  now, by "You".
- **Keyboard.** Up / Down move, Right opens, Left closes, Enter shows the
  comment with every field.
- The **table** tab shows the same rows flat, coloured by score.
