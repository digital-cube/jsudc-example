# Mail audit

What the `onMutate` hook of `mail_messages` writes: one row per insert,
update or delete of a message, in the same transaction as the change, so it
commits with the row and rolls back with it. `changes` is the patch (on a
delete, the subject of the message that went). Read-only
(`readOnly: true`), scoped to the user asking like the rest of the mailbox.
