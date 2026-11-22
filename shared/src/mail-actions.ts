import { defineHostAction, FilterNodeSchema } from "@jsudc/core";
import { z } from "zod";

/*
 * The mailbox's own actions, next to jsudc's built-in ones: defined once
 * here, with `defineHostAction`, and imported by both sides. The backend
 * registers them on its dispatcher (backend/src/mail/actions.ts), which
 * validates the payload with `request` and serves them at
 * `POST /udc/<name>`; the browser calls them through `useUdcAction`
 * (frontend/src/mail/MailPage.tsx), the payload typed from `request` and the
 * answer checked against `response`.
 */

/**
 * Move messages into one of the caller's folders: by `ids` (a selection, one
 * row, the open message) or by `filter` minus `except_ids` ("select all that
 * match"). The server holds both the messages and the folder to the demo
 * user's own rows: another user's message is reported in `failed`, another
 * user's folder is `not_found`.
 */
export const moveToFolder = defineHostAction({
  name: "mail.move_to_folder",
  request: z
    .object({
      folder_id: z.uuid(),
      ids: z.array(z.string().min(1)).min(1).optional(),
      filter: FilterNodeSchema.optional(),
      except_ids: z.array(z.string().min(1)).optional(),
    })
    .refine((r) => (r.ids === undefined) !== (r.filter === undefined), {
      message: "give either ids or filter",
    }),
  response: z.object({
    /** How many messages are now in the folder that were not before. */
    moved: z.number().int().min(0),
    /** The ids that were not the caller's (or not there). */
    failed: z.array(z.string()),
  }),
});

/**
 * "Simulate incoming mail": the backend delivers one new message into the
 * caller's Inbox, written outside jsudc (as a mail server would), and tells
 * the change feed — only that user's open screens hear of it.
 */
export const simulateIncoming = defineHostAction({
  name: "mail.simulate_incoming",
  request: z.object({}),
  response: z.object({
    id: z.string(),
    folder_id: z.string(),
    subject: z.string(),
  }),
});

export type MoveToFolderRequest = z.input<typeof moveToFolder.request>;
