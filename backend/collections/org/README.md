# Organisation

An invented software company: the company, 6 departments, 2–4 teams in
each, 4–8 people in each team — 134 rows. The source is the database
(Postgres jsonb), seeded from `seed.json`, which
`backend/scripts/generate-trees.ts` writes deterministically with every
structure field filled: `parent_id`, `order`, `depth`, `ancestor_ids`
(root first) and `children_count`.

- **One level at a time** (`tree_options.lazy: true`). The tree asks the
  server for the roots (`parent_id is_null`), and for a node's children only
  when it is opened (`parent_id eq <id>`, sorted by `sibling_sort`). The
  expander shows where `children_count` is above zero, a spinner while a
  branch loads. It opens with the company expanded one level
  (`expand.default_depth: 1`); what you open is remembered in this browser
  (`udc:tree:org`).
- **Filters and search go to the server.** With a chip, a filter or a
  search the tree lists the matching rows; one whose parent did not match is
  drawn as a root with a muted marker, and labels highlight the searched
  text. *Kind = person* plus a search finds people by name or title.
- **Rename** (`interactive.rename`): double-click a name, or *Rename* in the
  `⋮` menu; Enter saves (`mutate update` with the row's version).
- **Move** (`interactive.reparent`): drag a node onto another one (it
  becomes its last child) or onto the gap between two siblings. A node
  cannot be dropped into itself or its own subtree — the target is refused
  in the browser and the server refuses it too. The move is one
  `tree.reparent` call: the server writes `parent_id` and `order`,
  recomputes `depth` and `ancestor_ids` for the whole moved subtree and
  recounts both parents' `children_count`, in one transaction. A drop
  between two orders with no integer left renumbers the siblings
  (`reindex`) and tries again.
- The **table** tab shows the same rows flat, coloured by kind.
