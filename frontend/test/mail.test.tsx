import type { Row } from "@jsudc/core";
import { type CellProps, cellComponent, UdcI18nProvider } from "@jsudc/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EXAMPLE_MESSAGES } from "../src/i18n/messages";
import { EXAMPLE_CELLS, UnreadDotCell } from "../src/mail/cells";
import {
  DEMO_USER_HEADER,
  DEMO_USER_KEY,
  demoUserHeaders,
  getDemoUser,
  isDemoUserChoice,
  loadDemoUser,
  setDemoUser,
  subscribeDemoUser,
} from "../src/mail/demoUser";

describe("the demo user", () => {
  it("is Ana until one is picked; the pick is stored and announced", () => {
    expect(loadDemoUser()).toBe("ana");
    let calls = 0;
    const stop = subscribeDemoUser(() => {
      calls += 1;
    });
    setDemoUser("marko");
    setDemoUser("marko"); // the same choice is not a change
    expect(calls).toBe(1);
    expect(getDemoUser()).toBe("marko");
    expect(localStorage.getItem(DEMO_USER_KEY)).toBe("marko");
    expect(loadDemoUser()).toBe("marko");
    stop();
    setDemoUser("ana");
    expect(calls).toBe(1);
  });

  it("is the header of every request, and none at all for nobody", () => {
    setDemoUser("jelena");
    expect(demoUserHeaders()).toEqual({ [DEMO_USER_HEADER]: "jelena" });
    setDemoUser("none");
    expect(demoUserHeaders()).toEqual({});
    setDemoUser("ana");
    expect(isDemoUserChoice("eve")).toBe(false);
    localStorage.setItem(DEMO_USER_KEY, "eve");
    expect(loadDemoUser()).toBe("ana");
  });
});

describe("the unread_dot cell", () => {
  const props = (value: unknown, surface: "table" | "card" = "table"): CellProps => ({
    value,
    row: { __meta: { id: "m1", version: 1 }, seen: value } as Row,
    column: { field: "seen", render: "unread_dot" },
    def: { type: "bool" },
    collection: "mail_messages",
    locale: "en",
    intlLocale: "en",
    editable: false,
    surface,
  });
  const draw = (p: CellProps) =>
    render(
      <UdcI18nProvider messages={EXAMPLE_MESSAGES}>
        <UnreadDotCell {...p} />
      </UdcI18nProvider>,
    );

  it("draws a dot for an unread message and nothing for a read one", () => {
    draw(props(false));
    expect(screen.getByTestId("unread-dot")).toHaveAttribute("data-unread", "true");
    expect(screen.getByRole("img", { name: "Unread" })).toBeInTheDocument();
  });

  it("is blank for a read message, in a card too", () => {
    draw(props(true, "card"));
    expect(screen.getByTestId("unread-dot")).toHaveAttribute("data-unread", "false");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("is registered under the name the view names", () => {
    expect(cellComponent(EXAMPLE_CELLS, "unread_dot")).toBe(UnreadDotCell);
  });
});
