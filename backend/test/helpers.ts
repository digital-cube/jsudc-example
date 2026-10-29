import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Row, UdcError } from "@jsudc/core";
import { connect } from "@jsudc/server";
import { afterAll, expect } from "vitest";
import { COLLECTIONS_DIR, config } from "../src/config.js";

export const companiesSeed = JSON.parse(
  readFileSync(join(COLLECTIONS_DIR, "companies", "seed.json"), "utf8"),
) as Record<string, unknown>[];

/** One pool per test file, closed when the file is done. */
export function useTestDb() {
  const handle = connect(config.testDatabaseUrl);
  afterAll(() => handle.close());
  return handle;
}

export async function rejectsWith(p: Promise<unknown>, code: string): Promise<UdcError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `expected a ${code} UdcError`).toBeInstanceOf(UdcError);
  expect((err as UdcError).code).toBe(code);
  return err as UdcError;
}

export const ids = (rows: Row[]) => rows.map((r) => r.__meta.id);
