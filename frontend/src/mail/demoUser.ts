import { storage } from "@jsudc/react";
import { useCallback, useSyncExternalStore } from "react";

/*
 * The demo identity of the mailbox example. There is no login: the user
 * switcher in the header picks who the app plays, the UdcClient sends that
 * name in `x-demo-user` on every request (its per-call `headers` function),
 * and the backend's `context` reads it; the row scope then holds the
 * mailbox collections to that user's rows. `none` sends no header at all, so
 * the mailbox answers "not signed in" (forbidden, reason unauthenticated).
 */

export const DEMO_USERS = ["ana", "marko", "jelena"] as const;
export type DemoUserId = (typeof DEMO_USERS)[number];
export type DemoUserChoice = DemoUserId | "none";

export const DEMO_USER_HEADER = "x-demo-user";
export const DEMO_USER_KEY = "example:demo-user";

export const isDemoUserChoice = (v: unknown): v is DemoUserChoice =>
  v === "none" || DEMO_USERS.includes(v as DemoUserId);

let current: DemoUserChoice = loadDemoUser();
const listeners = new Set<() => void>();

/** The stored choice; Ana before the first one. */
export function loadDemoUser(): DemoUserChoice {
  const v = storage.get(DEMO_USER_KEY);
  return isDemoUserChoice(v) ? v : "ana";
}

export function getDemoUser(): DemoUserChoice {
  return current;
}

export function setDemoUser(user: DemoUserChoice): void {
  if (user === current) return;
  current = user;
  storage.set(DEMO_USER_KEY, user);
  for (const l of listeners) l();
}

export function subscribeDemoUser(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The UdcClient's `headers` function, called before every request: the
 * header names whoever is picked at that moment, so a switch needs no new
 * client.
 */
export function demoUserHeaders(): Record<string, string> {
  return current === "none" ? {} : { [DEMO_USER_HEADER]: current };
}

export function useDemoUser(): [DemoUserChoice, (user: DemoUserChoice) => void] {
  const user = useSyncExternalStore(subscribeDemoUser, getDemoUser);
  return [user, useCallback(setDemoUser, [])];
}
