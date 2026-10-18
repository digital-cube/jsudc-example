import type { ActionName, ActionRequest, ActionResponse, FilterNode } from "@jsudc/udc-core";

declare global {
  namespace Cypress {
    interface Chainable {
      /** `POST /udc/<action>` through the dev proxy; yields the `.ok` payload. */
      udc<A extends ActionName>(action: A, payload: ActionRequest<A>): Chainable<ActionResponse<A>>;
      /** Reset the test database to the 200 seeded companies (only under `npm run e2e`). */
      reseed(): Chainable<void>;
      /** Visit the companies table and wait until its first rows are on screen. */
      openCompanies(query?: string): Chainable<void>;
    }
  }
}

Cypress.Commands.add("udc", (action, payload) =>
  cy.request({ method: "POST", url: `/udc/${action}`, body: payload }).then((res) => {
    expect(res.body.kind, `udc.${action} reply`).to.eq(`udc.${action}.ok`);
    return res.body.payload;
  }),
);

Cypress.Commands.add("reseed", () => {
  cy.task("reseed", null, { timeout: 120_000 });
});

Cypress.Commands.add("openCompanies", (query = "") => {
  cy.visit(`/udc/companies${query}`);
  cy.get('[data-testid="row"]', { timeout: 15_000 }).should("have.length.at.least", 1);
});

/** The `?f=` / `?cf=` value of the current URL, decoded. */
export function decodeParam(search: string, name: string): unknown {
  const raw = new URLSearchParams(search).get(name);
  if (!raw) return null;
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

export type { FilterNode };
