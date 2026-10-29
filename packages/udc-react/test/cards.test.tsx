import {
  type DescribeResponse,
  SchemaDocSchema,
  type ViewConfig,
  ViewConfigSchema,
} from "@jsudc/core";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardRenderer } from "../src/cards/CardRenderer";
import { avatarTone, cardSize, cardSlots, initials } from "../src/cards/cardModel";
import { UdcI18nProvider } from "../src/i18n/i18n";
import type { UdcCollectionResult } from "../src/udc/hooks";
import { row } from "./fetchMock";

const view = (extra: Record<string, unknown> = {}): ViewConfig =>
  ViewConfigSchema.parse({
    available_renderers: ["table", "cards"],
    columns: [
      { field: "pib", pin: "left" },
      { field: "name", transform: "titlecase" },
      { field: "revenue_eur", render: "number_format" },
      { field: "active", render: "bool" },
    ],
    card_options: {
      title_field: "name",
      subtitle_field: "pib",
      meta_fields: ["city", "revenue_eur", "active"],
      size: "lg",
    },
    ...extra,
  });

const schema = SchemaDocSchema.parse({
  version: "v1",
  fields: {
    pib: { type: "string" },
    name: { type: "string" },
    city: { type: "string" },
    revenue_eur: { type: "integer" },
    active: { type: "bool" },
    logo: { type: "string" },
  },
});

function describeOf(v: ViewConfig): DescribeResponse {
  return {
    collection: "companies",
    capabilities: {
      mutate: true,
      subscribe: false,
      total_count: true,
      schema_edit: true,
      config_edit: false,
      reindex: false,
      tree_reparent: false,
      source_yaml: false,
      supported_filter_ops: [],
    },
    schema,
    view: v,
    filterable: { fields: [] },
    source_kind: "postgres_jsonb",
  } as DescribeResponse;
}

function result(rows: ReturnType<typeof row>[], extra: Partial<UdcCollectionResult> = {}) {
  return {
    rows,
    total: rows.length,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: () => {},
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => {},
    fetchedAt: null,
    stale: false,
    ...extra,
  } satisfies UdcCollectionResult;
}

function renderCards(v: ViewConfig, data: UdcCollectionResult) {
  return render(
    // A host's own label, as the example passes its TBL_* sections.
    <UdcI18nProvider messages={{ TBL_COMPANIES: { PIB: { en: "PIB", sr: "PIB" } } }}>
      <CardRenderer
        collection="companies"
        describe={describeOf(v)}
        data={data}
        mode="infinite"
        page={1}
        limit={50}
        onPage={() => {}}
        filtered={false}
        onClearFilters={() => {}}
        resetKey=""
      />
    </UdcI18nProvider>,
  );
}

describe("cardSlots", () => {
  it("takes title, subtitle, image and meta fields from card_options, formatted by their columns", () => {
    const slots = cardSlots(
      view({ card_options: { ...view().card_options, image_field: "logo" } }),
    );
    expect(slots.title).toEqual({ field: "name", transform: "titlecase" });
    expect(slots.subtitle?.field).toBe("pib");
    expect(slots.image).toBe("logo");
    // `city` has no column: a bare one; the others carry their render.
    expect(slots.meta).toEqual([
      { field: "city" },
      { field: "revenue_eur", render: "number_format" },
      { field: "active", render: "bool" },
    ]);
    expect(slots.size).toBe("large");
  });

  it("falls back to the first left-pinned column for the title and medium for the size", () => {
    const slots = cardSlots(view({ card_options: {} }));
    expect(slots.title.field).toBe("pib");
    expect(slots.subtitle).toBeNull();
    expect(slots.image).toBeNull();
    expect(slots.meta).toEqual([]);
    expect(slots.size).toBe("medium");
  });

  it("reads both spellings of the size", () => {
    expect(cardSize("sm")).toBe("small");
    expect(cardSize("small")).toBe("small");
    expect(cardSize("lg")).toBe("large");
    expect(cardSize("large")).toBe("large");
    expect(cardSize(undefined)).toBe("medium");
  });
});

describe("initials", () => {
  it("uses the first letters of the first two words", () => {
    expect(initials("Orao Elektro DOO")).toBe("OE");
    expect(initials("đerdap mlekara")).toBe("ĐM");
    expect(initials("  Šumadija-Trans  ")).toBe("ŠT");
  });

  it("uses two letters of a single word, and ? for nothing", () => {
    expect(initials("Delta")).toBe("DE");
    expect(initials("x")).toBe("X");
    expect(initials("")).toBe("?");
    expect(initials("—")).toBe("?");
  });

  it("gives a title the same avatar colour every time", () => {
    expect(avatarTone("Orao Elektro")).toBe(avatarTone("Orao Elektro"));
  });
});

describe("<CardRenderer>", () => {
  const rows = [
    row("a", 1, {
      name: "orao elektro doo",
      pib: "012345678",
      city: "Niš",
      revenue_eur: 1234567,
      active: true,
    }),
    row("b", 1, { name: "delta", pib: "1", city: "Beograd", revenue_eur: 5, active: false }),
  ];

  it("renders one card per row: title through the transform, subtitle and the meta fields", () => {
    renderCards(view(), result(rows));
    const cards = screen.getAllByTestId("card");
    expect(cards).toHaveLength(2);
    const first = within(cards[0] as HTMLElement);
    expect(first.getByTestId("card-title")).toHaveTextContent("Orao Elektro Doo");
    expect(first.getByTestId("card-subtitle")).toHaveTextContent("PIB 012345678");
    expect(first.getByTestId("card-meta-city")).toHaveTextContent("CityNiš");
    expect(first.getByTestId("card-meta-revenue_eur")).toHaveTextContent("1,234,567");
    expect(
      first.getByTestId("card-meta-active").querySelector("[data-bool='true']"),
    ).not.toBeNull();
    expect(
      within(cards[1] as HTMLElement)
        .getByTestId("card-meta-active")
        .querySelector("[data-bool='false']"),
    ).not.toBeNull();
    expect(screen.getByTestId("card-grid")).toHaveAttribute("data-size", "large");
  });

  it("shows an initials avatar without an image field, a cover with one", () => {
    const { unmount } = renderCards(view(), result(rows));
    expect(screen.getAllByTestId("card-avatar")[0]).toHaveTextContent("OE");
    expect(screen.queryByTestId("card-cover")).toBeNull();
    unmount();

    const withImage = view({ card_options: { title_field: "name", image_field: "logo" } });
    renderCards(withImage, result([row("c", 1, { name: "Delta", logo: "https://x/logo.png" })]));
    expect(screen.getByTestId("card-cover")).toHaveAttribute("src", "https://x/logo.png");
    expect(screen.queryByTestId("card-avatar")).toBeNull();
  });

  it("paints row_color as the left accent bar", () => {
    renderCards(
      view({ row_color: { field: "active", rules: [{ value: false, color: "muted" }] } }),
      result(rows),
    );
    const [on, off] = screen.getAllByTestId("card");
    expect(on).not.toHaveAttribute("data-accent");
    expect(off).toHaveAttribute("data-accent", "muted");
    expect(within(off as HTMLElement).getByTestId("card-accent")).toBeInTheDocument();
  });

  it("shows skeleton cards while loading and the shared empty state when there are no rows", () => {
    const { unmount } = renderCards(view(), result([], { isLoading: true, total: null }));
    expect(screen.getAllByTestId("skeleton-card").length).toBeGreaterThan(0);
    unmount();
    renderCards(view(), result([]));
    expect(screen.getByTestId("table-empty")).toBeInTheDocument();
  });
});
