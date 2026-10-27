import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  ACTIONS,
  isRendererName,
  KanbanOptionsSchema,
  RENDERER_NAMES,
  ViewConfigSchema,
} from "../src/index.js";

const minimal = {
  bucket_collection: "buckets",
  bucket_filter_field: "board_id",
  ticket_board_field: "board_id",
  ticket_bucket_field: "bucket_id",
  card: { title_field: "title" },
};

describe("KanbanOptions", () => {
  it("fills every default from a minimal block", () => {
    expect(KanbanOptionsSchema.parse(minimal)).toEqual({
      ...minimal,
      bucket_order_field: "order",
      bucket_label_field: "name",
      ticket_order_field: "order",
      cards: {
        title_lines: 3,
        body_lines: 2,
        show_priority_left_border: true,
        tags_max_visible: 4,
        density: "comfortable",
      },
      buckets: {
        max_visible_tickets: 50,
        show_count: true,
        show_add_ticket_button: true,
        min_width_px: 280,
      },
      board: { extendable_with_buckets: true, buckets_sortable: true },
      permissions: { read_only: false },
    });
  });

  it("keeps a partial sub-block's own values and defaults the rest", () => {
    const opts = KanbanOptionsSchema.parse({ ...minimal, cards: { density: "compact" } });
    expect(opts.cards).toMatchObject({ density: "compact", title_lines: 3 });
  });

  it.each([
    ["bucket_collection"],
    ["bucket_filter_field"],
    ["ticket_board_field"],
    ["ticket_bucket_field"],
    ["card"],
  ])("requires %s", (key) => {
    const { [key as keyof typeof minimal]: _, ...rest } = minimal;
    expect(KanbanOptionsSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a bad density", () => {
    expect(KanbanOptionsSchema.safeParse({ ...minimal, cards: { density: "airy" } }).success).toBe(
      false,
    );
  });

  it("parses the tickets view of the backend", () => {
    const raw = parse(
      readFileSync(
        new URL("../../../backend/collections/tickets/view.yaml", import.meta.url),
        "utf8",
      ),
    );
    const view = ViewConfigSchema.parse(raw);
    expect(view.default_renderer).toBe("kanban");
    expect(view.available_renderers).toEqual(["kanban", "table", "cards", "calendar"]);
    expect(view.kanban_options).toMatchObject({
      bucket_collection: "buckets",
      ticket_bucket_field: "bucket_id",
      card: { title_field: "title", assignees_field: "assignees" },
    });
  });

  it("a view with a broken block does not parse", () => {
    expect(ViewConfigSchema.safeParse({ kanban_options: { card: {} } }).success).toBe(false);
  });
});

describe("renderer names", () => {
  it("knows the seven", () => {
    expect(RENDERER_NAMES).toEqual([
      "table",
      "cards",
      "kanban",
      "calendar",
      "tree",
      "map",
      "chart",
    ]);
    expect(isRendererName("kanban")).toBe(true);
    expect(isRendererName("gantt")).toBe(false);
  });

  it("an unknown name still parses in available_renderers", () => {
    const view = ViewConfigSchema.parse({ available_renderers: ["kanban", "gantt"] });
    expect(view.available_renderers).toEqual(["kanban", "gantt"]);
  });
});

describe("reindex payloads", () => {
  it.each([
    [{ collection: "tickets", scope: { bucket_id: "b1" } }],
    [
      {
        collection: "tickets",
        scope: { board_id: "x", is_done: false },
        order_field: "rank",
        gap: 10,
      },
    ],
    [{ collection: "tickets", scope: {} }],
  ])("accepts %j", (req) => {
    expect(ACTIONS.reindex.request.safeParse(req).success).toBe(true);
  });

  it.each([
    [{ scope: {} }],
    [{ collection: "tickets" }],
    [{ collection: "tickets", scope: { bucket_id: null } }],
    [{ collection: "tickets", scope: { bucket_id: ["a"] } }],
    [{ collection: "tickets", scope: {}, gap: 1 }],
    [{ collection: "tickets", scope: {}, gap: 2.5 }],
    [{ collection: "tickets", scope: {}, order_field: "" }],
  ])("rejects %j", (req) => {
    expect(ACTIONS.reindex.request.safeParse(req).success).toBe(false);
  });

  it("answers the count", () => {
    expect(ACTIONS.reindex.response.safeParse({ updated: 3 }).success).toBe(true);
    expect(ACTIONS.reindex.response.safeParse({ updated: -1 }).success).toBe(false);
  });
});
