import type { CollectionListing } from "@jsudc/core";
import { describe, expect, it } from "vitest";
import { groupCollections } from "../src/shell/AppShell";

const caps = {
  mutate: false,
  subscribe: false,
  total_count: true,
  schema_edit: false,
  config_edit: false,
  reindex: false,
  tree_reparent: false,
  source_yaml: false,
  paging: ["offset" as const],
  supported_filter_ops: [],
};

const listing = (name: string, extra: Partial<CollectionListing>): CollectionListing => ({
  name,
  default_renderer: "table",
  capabilities: caps,
  source_kind: "postgres_jsonb",
  ...extra,
});

describe("sidebar groups", () => {
  it("groups by group, database / files / internet, in server order; empty groups go", () => {
    const groups = groupCollections([
      listing("repos", { source_kind: "http_api", group: "internet" }),
      listing("companies", { group: "database" }),
      listing("quakes", { source_kind: "http_api", group: "internet" }),
      listing("tickets", {}),
    ]);
    expect(groups.map((g) => [g.group, g.collections.map((c) => c.name)])).toEqual([
      ["database", ["companies", "tickets"]],
      ["internet", ["repos", "quakes"]],
    ]);
  });

  it("places a listing without group by its source_kind", () => {
    const groups = groupCollections([listing("files", { source_kind: "filesystem" })]);
    expect(groups).toEqual([
      { group: "files", collections: [expect.objectContaining({ name: "files" })] },
    ]);
    expect(groupCollections([])).toEqual([]);
  });
});
