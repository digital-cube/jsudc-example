import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { createDatabases, databaseName, runMigrations } from "../src/db/admin.js";
import * as schema from "../src/db/schema.js";

describe("the demo tables", () => {
  it("are the eight jsonb collection tables, the three mailbox tables and the library's revisions table", () => {
    const tables = Object.values(schema).map((t) => getTableName(t));
    expect(tables.sort()).toEqual([
      "appointments",
      "boards",
      "buckets",
      "comments",
      "companies",
      "mail_audit",
      "mail_folders",
      "mail_messages",
      "metrics",
      "org",
      "tickets",
      "udc_schema_revisions",
    ]);
    expect(Object.keys(getTableColumns(schema.companies))).toEqual([
      "id",
      "data",
      "version",
      "createdAt",
      "updatedAt",
    ]);
    // The mailbox is relational: typed columns, not one jsonb document.
    expect(Object.keys(getTableColumns(schema.mailMessages))).toEqual([
      "id",
      "owner",
      "folderId",
      "senderName",
      "senderEmail",
      "subject",
      "preview",
      "body",
      "receivedAt",
      "seen",
      "sizeBytes",
      "version",
      // 0.5.0: the generated full-text document the search is answered from (migration 0007).
      "tsv",
    ]);
  });
});

describe("db admin", () => {
  it("takes the database name of a URL and refuses one that is not an identifier", () => {
    expect(databaseName("postgresql://u:p@localhost/jsudc_test")).toBe("jsudc_test");
    expect(() => databaseName("postgresql://u:p@localhost/x;drop")).toThrow(/refusing/);
  });

  it("creates nothing that exists and re-applies no migration", async () => {
    expect(await createDatabases([config.testDatabaseUrl])).toEqual([]);
    await expect(runMigrations(config.testDatabaseUrl)).resolves.toBeUndefined();
  });
});
