# Mail folders

The folders of the mailbox example, per demo user: Inbox, Sent, Drafts,
Archive, Trash and one of the user's own. Served by `postgres_table` from
the `mail_folders` table, held to the user asking by the server's row scope
(the owner is hidden), like `mail_messages`.

`unread_count` and `message_count` are **computed fields**: correlated
subqueries over `mail_messages`, written in code
(`backend/src/mail/sources.ts`). They list, sort and filter like columns,
and a write naming them is refused (`validation_error`, "is read-only").
Mark a message seen on `/mail` and the folder's count drops on the next
read. The name is editable here.
