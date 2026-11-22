/**
 * The demo identity of the mailbox example: no login, three fixed users. The
 * frontend names the one it plays in a header on every request (the user
 * switcher in the shell); `demoContext` turns that header into the request
 * context, and the row scope holds each mailbox request to its owner.
 */

export interface DemoUser {
  id: string;
  name: string;
  email: string;
}

export const DEMO_USERS: readonly DemoUser[] = [
  { id: "ana", name: "Ana Petrović", email: "ana@mail.example" },
  { id: "marko", name: "Marko Jovanović", email: "marko@mail.example" },
  { id: "jelena", name: "Jelena Nikolić", email: "jelena@mail.example" },
];

/** The header the frontend sends the demo user in (lowercase: Node's `IncomingHttpHeaders`). */
export const DEMO_USER_HEADER = "x-demo-user";

/** The collections that belong to a user: a request on them needs one. */
export const MAIL_COLLECTIONS: ReadonlySet<string> = new Set([
  "mail_folders",
  "mail_messages",
  "mail_audit",
]);

export function demoUser(id: unknown): DemoUser | undefined {
  return typeof id === "string" ? DEMO_USERS.find((u) => u.id === id) : undefined;
}
