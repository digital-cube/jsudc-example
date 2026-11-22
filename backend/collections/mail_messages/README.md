# Mail messages

The messages of the mailbox example (jsudc 0.4.0): three demo users — Ana,
Marko and Jelena — with about three hundred messages each, in their own
folders. There is no login: the user switcher at the top right of the shell
sends the user in the `x-demo-user` header, and the server's request
`context` reads it.

- **Rows per user.** The dispatcher's `rowScope` holds every request on this
  collection to `owner = <the user asking>`. The scope is the server's: no
  client can send, see or lift it. `owner` is hidden from `describe` and
  from every row; a filter naming it is refused like an unknown field.
  Another user's message is `not_found` — read, update and delete alike.
- **No user, no mailbox.** Without a known user the request is refused with
  `forbidden`, `details.reason: "unauthenticated"`, and the view shows
  "You are signed out". The other collections need no user.
- **A relational table** (`postgres_table`): typed columns and UUID ids, not
  jsonb. In code the collection reads `mail_messages` joined to
  `mail_folders`, so `folder_name` comes from the join (read-only: a column
  of the other table); `received_at` and `size_bytes` are read-only too.
- **No count.** `total_count: false`: a page is fetched without a
  `count(*)` beside it, the toolbar shows no "of M". A mailbox can be large.
- **`onMutate`.** Every insert, update and delete writes a row into
  `mail_audit` in the same transaction, after the message's own statement
  and before COMMIT. A refused change (another user's message, a stale
  version, a read-only field) writes nothing. The reading pane of `/mail`
  lists that trail under the message.
- **A custom cell.** `seen` is drawn by `render: unread_dot`, a cell the
  example registers (`frontend/src/mail/cells.tsx`): a dot for unread.

The `/mail` screen embeds this view between its folder list and a reading
pane. Here it is the same rows as data, for the user picked in the shell.
