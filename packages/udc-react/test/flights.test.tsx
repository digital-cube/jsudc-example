import {
  type DescribeResponse,
  MapOptionsSchema,
  type Row,
  SchemaDocSchema,
  ViewConfigSchema,
} from "@jsudc/core";
import { UdcClient } from "@jsudc/core/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardRenderer } from "../src/cards/CardRenderer";
import { cardSlots, metricText } from "../src/cards/cardModel";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { Freshness, ttlText } from "../src/data-view/Freshness";
import { UdcI18nProvider } from "../src/i18n/i18n";
import { MapRenderer } from "../src/map/MapRenderer";
import {
  airplaneHtml,
  rotationOf,
  TRAILS_FOR_ALL_MAX,
  toMarkers,
  trailMarkers,
  trailOf,
} from "../src/map/model";
import type { RendererProps } from "../src/renderers/types";
import { CellValue, displayText } from "../src/table/cells";
import { HeadingGlyph, headingDegrees, Sparkline, sparkGeometry } from "../src/table/sparkline";
import { createUdcQueryClient, UdcProvider } from "../src/udc/provider";
import { listOf, mockUdcFetch, row } from "./fetchMock";

const map = (block: Record<string, unknown> = {}) =>
  MapOptionsSchema.parse({
    lat_field: "lat",
    lng_field: "lng",
    icon: "airplane",
    rotate_field: "heading",
    icon_size: 22,
    trail: { lat_history_field: "lat_history", lng_history_field: "lng_history" },
    ...block,
  });

const plane = (id: string, extra: Record<string, unknown> = {}) =>
  row(id, 1, {
    callsign: id.toUpperCase(),
    lat: 44.8,
    lng: 20.4,
    heading: 90,
    baro_alt: 10_000,
    lat_history: [44.7, 44.8],
    lng_history: [20.3, 20.4],
    baro_alt_history: [9800, 10_000],
    ...extra,
  });

describe("aeroplane markers", () => {
  it("turn by rotate_field, normalised to [0, 360); a missing track draws a circle", () => {
    const o = map();
    expect(rotationOf({ heading: 295.01 }, o)).toBeCloseTo(295.01);
    expect(rotationOf({ heading: -90 }, o)).toBe(270);
    expect(rotationOf({ heading: 450 }, o)).toBe(90);
    expect(rotationOf({ heading: "12.5" }, o)).toBe(12.5);
    expect(rotationOf({ heading: null }, o)).toBeNull();
    // The circle icon never turns; an aeroplane without rotate_field points north.
    expect(rotationOf({ heading: 90 }, map({ icon: "circle" }))).toBeNull();
    expect(rotationOf({ heading: 90 }, map({ rotate_field: undefined }))).toBe(0);
  });

  it("are an SVG turned by CSS and sized by icon_size", () => {
    const el = document.createElement("div");
    el.innerHTML = airplaneHtml(135, 30);
    const glyph = el.firstElementChild as HTMLElement;
    expect(glyph.style.transform).toBe("rotate(135deg)");
    expect(glyph.style.width).toBe("30px");
    expect(glyph.style.height).toBe("30px");
    expect(el.querySelector("svg")?.getAttribute("width")).toBe("30");
    expect(el.querySelector("path")).not.toBeNull();
  });

  it("carry their rotation and trail into the marker model", () => {
    const [m] = toMarkers([plane("a", { heading: 45 })], map(), undefined);
    expect(m).toMatchObject({
      rotation: 45,
      trail: [
        [44.7, 20.3],
        [44.8, 20.4],
      ],
    });
  });
});

describe("trails", () => {
  it("pair the histories from the newest end, drop bad pairs, keep the last max_points", () => {
    const o = map({
      trail: { lat_history_field: "lat_history", lng_history_field: "lng_history", max_points: 3 },
    });
    expect(trailOf({ lat_history: [1, 2, 3, 4, 5], lng_history: [10, 20, 30, 40, 50] }, o)).toEqual(
      [
        [3, 30],
        [4, 40],
        [5, 50],
      ],
    );
    // A longer lat history: the extra oldest values have no partner.
    expect(trailOf({ lat_history: [0, 1, 2], lng_history: [10, 20] }, map())).toEqual([
      [1, 10],
      [2, 20],
    ]);
    expect(trailOf({ lat_history: [1, 95, 2], lng_history: [1, 1, "x"] }, map())).toEqual([[1, 1]]);
    expect(trailOf({ lat_history: null }, map())).toEqual([]);
    expect(
      trailOf({ lat_history: [1, 2], lng_history: [1, 2] }, map({ trail: undefined })),
    ).toEqual([]);
  });

  it("are drawn for every marker up to the limit, above it for the hovered and selected only", () => {
    const few = toMarkers(
      [plane("a"), plane("b"), plane("c", { lat_history: [44.8] })],
      map(),
      undefined,
    );
    expect(trailMarkers(few, null, null).map((m) => m.id)).toEqual(["a", "b"]);
    const many = toMarkers(
      Array.from({ length: TRAILS_FOR_ALL_MAX + 1 }, (_, i) => plane(`p${i}`)),
      map(),
      undefined,
    );
    expect(trailMarkers(many, null, null)).toEqual([]);
    expect(trailMarkers(many, "p3", "p7").map((m) => m.id)).toEqual(["p3", "p7"]);
  });
});

describe("sparklines", () => {
  it("are framed on their own min and max, oldest left, newest right", () => {
    const g = sparkGeometry([100, 300, 200], 100, 20, 2);
    expect(g).toEqual({
      min: 100,
      max: 300,
      points: [
        [2, 18],
        [50, 2],
        [98, 10],
      ],
    });
    // Flat: the middle. One value: a point at the right edge. None: nothing.
    expect(sparkGeometry([5, 5], 100, 20)?.points).toEqual([
      [2, 10],
      [98, 10],
    ]);
    expect(sparkGeometry([5], 100, 20)?.points).toEqual([[98, 10]]);
    expect(sparkGeometry([], 100, 20)).toBeNull();
  });

  it("draw a polyline and the last value as a dot, the range in the tooltip", () => {
    render(<Sparkline value={[9800, null, 10_000, "x", 10_100]} width={96} height={22} />);
    const svg = screen.getByTestId("sparkline");
    expect(svg).toHaveAttribute("data-points", "3");
    expect(svg).toHaveAttribute("data-min", "9800");
    expect(svg).toHaveAttribute("data-max", "10100");
    expect(svg.querySelector("polyline")?.getAttribute("points")?.split(" ")).toHaveLength(3);
    expect(screen.getByTestId("sparkline-last")).toHaveAttribute("cx", "94");
    expect(svg.querySelector("title")?.textContent).toBe("9800 – 10100 · 10100");
  });

  it("is a table cell kind; one value is a dot without a line, none a dash", () => {
    const column = { field: "h", render: "sparkline", render_options: { width: 60, height: 16 } };
    const { rerender } = render(
      <CellValue
        value={[1, 2]}
        column={column}
        def={{ type: "json" }}
        locale="en"
        intlLocale="en-US"
      />,
    );
    expect(screen.getByTestId("sparkline")).toHaveAttribute("width", "60");
    rerender(
      <CellValue
        value={[1]}
        column={column}
        def={{ type: "json" }}
        locale="en"
        intlLocale="en-US"
      />,
    );
    expect(screen.getByTestId("sparkline").querySelector("polyline")).toBeNull();
    rerender(
      <CellValue
        value={[]}
        column={column}
        def={{ type: "json" }}
        locale="en"
        intlLocale="en-US"
      />,
    );
    expect(screen.queryByTestId("sparkline")).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("heading glyph", () => {
  it("turns an arrow by the degrees, which the tooltip says; a missing track is a dash", () => {
    expect(headingDegrees(-45)).toBe(315);
    expect(headingDegrees("x")).toBeNull();
    const { rerender } = render(<HeadingGlyph value={295.4} />);
    const glyph = screen.getByTestId("heading-glyph");
    expect(glyph).toHaveAttribute("title", "295°");
    expect(glyph.querySelector("svg")?.style.transform).toBe("rotate(295.4deg)");
    rerender(<HeadingGlyph value={null} />);
    expect(screen.queryByTestId("heading-glyph")).toBeNull();
  });
});

describe("number_format precision and suffix", () => {
  it("reads precision (or decimals) and appends the suffix", () => {
    const col = (o: Record<string, unknown>) => ({
      field: "x",
      render: "number_format",
      render_options: o,
    });
    expect(
      displayText(10972.8, col({ precision: 0, suffix: " m" }), "number_format", "en", "en-US"),
    ).toBe("10,973 m");
    expect(
      displayText(-0.98, col({ precision: 1, suffix: " m/s" }), "number_format", "en", "en-US"),
    ).toBe("-1.0 m/s");
    expect(
      displayText(44.8167, col({ decimals: 2, suffix: "°" }), "number_format", "sr", "sr-Latn-RS"),
    ).toBe("44,82°");
  });
});

const flightsSchema = SchemaDocSchema.parse({
  version: "v1",
  fields: {
    callsign: { type: "string" },
    country: { type: "string" },
    icao24: { type: "string" },
    heading: { type: "decimal" },
    baro_alt: { type: "decimal" },
    lat: { type: "decimal" },
    lng: { type: "decimal" },
    baro_alt_history: { type: "json" },
    lat_history: { type: "json" },
    lng_history: { type: "json" },
  },
});

const flightsView = ViewConfigSchema.parse({
  default_renderer: "map",
  available_renderers: ["map", "table", "cards"],
  map_options: {
    lat_field: "lat",
    lng_field: "lng",
    icon: "airplane",
    rotate_field: "heading",
    icon_size: 22,
    trail: { lat_history_field: "lat_history", lng_history_field: "lng_history" },
    center: [44, 21],
    zoom: 6,
  },
  columns: [{ field: "callsign" }, { field: "heading", render: "heading_glyph" }],
  card_options: {
    title_field: "callsign",
    subtitle_field: "country",
    meta_fields: ["icao24", "heading"],
    metric: { field: "baro_alt", label: "Altitude", unit: " m", precision: 0 },
    sparkline: { field: "baro_alt_history" },
  },
});

const describeFlights = (): DescribeResponse =>
  ({
    collection: "flights",
    capabilities: {
      mutate: false,
      subscribe: false,
      total_count: true,
      schema_edit: false,
      config_edit: false,
      reindex: false,
      tree_reparent: false,
      source_yaml: false,
      supported_filter_ops: [],
      paging: ["offset"],
    },
    source_kind: "http_api",
    source: { auth: "anonymous", cache_ttl_ms: 240_000 },
    schema: flightsSchema,
    view: flightsView,
    filterable: { fields: [] },
  }) as DescribeResponse;

describe("cards", () => {
  it("format the metric with its precision and unit", () => {
    const metric = { field: "baro_alt", unit: " m", precision: 0 };
    expect(metricText(10972.8, metric, "en-US")).toBe("10,973 m");
    expect(metricText("1234.5", { field: "x", precision: 1 }, "sr-Latn-RS")).toBe("1.234,5");
    expect(metricText(null, metric, "en-US")).toBeNull();
    expect(cardSlots(flightsView)).toMatchObject({
      metric: { field: "baro_alt", label: "Altitude" },
      sparkline: { field: "baro_alt_history", width: 240, height: 36 },
    });
  });

  it("show the metric block and the sparkline under the meta fields", () => {
    const rows = [
      plane("a", { baro_alt: 10972.8 }),
      plane("b", { baro_alt: null, baro_alt_history: [] }),
    ];
    render(
      <UdcI18nProvider>
        <CardRenderer
          collection="flights"
          describe={describeFlights()}
          data={{
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
          }}
          mode="infinite"
          page={0}
          limit={50}
          onPage={() => {}}
          filtered={false}
          onClearFilters={() => {}}
          resetKey=""
        />
      </UdcI18nProvider>,
    );
    const [a, b] = screen.getAllByTestId("card");
    expect(a?.querySelector('[data-testid="card-metric-value"]')?.textContent).toBe("10,973 m");
    expect(a?.querySelector('[data-testid="card-metric"]')?.textContent).toContain("Altitude");
    expect(
      a?.querySelector('[data-testid="card-sparkline"] [data-testid="sparkline"]'),
    ).not.toBeNull();
    expect(b?.querySelector('[data-testid="card-metric-value"]')?.textContent).toBe("—");
    // The sparkline sits after the meta fields.
    const meta = a?.querySelector('[data-testid="card-meta-icao24"]');
    const spark = a?.querySelector('[data-testid="card-sparkline"]');
    expect(
      meta && spark && meta.compareDocumentPosition(spark) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("the freshness pill", () => {
  it("says the credential and the server cache in its tooltip", async () => {
    expect(ttlText(240_000, "en-US")).toBe("4 min");
    expect(ttlText(15_000, "en-US")).toBe("15 sec");
    render(
      <UdcI18nProvider>
        <TooltipProvider delayDuration={0}>
          <Freshness
            fetchedAt={new Date().toISOString()}
            stale={false}
            source={{ auth: "anonymous", cache_ttl_ms: 240_000 }}
          />
        </TooltipProvider>
      </UdcI18nProvider>,
    );
    const pill = screen.getByTestId("updated-ago");
    expect(pill).toHaveAttribute("data-auth", "anonymous");
    expect(pill).toHaveAttribute("data-cache-ttl", "240000");
    fireEvent.focus(pill);
    expect((await screen.findAllByTestId("freshness-auth"))[0]).toHaveTextContent(
      "Upstream access: anonymous",
    );
    expect(screen.getAllByTestId("freshness-cache")[0]).toHaveTextContent("Server cache: 4 min");
  });
});

describe("the map across a poll", () => {
  function setup(first: Row[]) {
    let rows = first;
    const mock = mockUdcFetch({ list: () => ({ ok: listOf(rows) }) });
    const client = new UdcClient({ httpUrl: "http://api", fetch: mock.fetch });
    const qc = createUdcQueryClient();
    const props = {
      collection: "flights",
      describe: describeFlights(),
      filter: undefined,
      sort: [],
      filtered: false,
      onClearFilters: () => {},
      onCount: () => {},
    } as unknown as RendererProps;
    const utils = render(
      <UdcI18nProvider>
        <UdcProvider client={client}>
          <QueryClientProvider client={qc}>
            <MapRenderer {...props} />
          </QueryClientProvider>
        </UdcProvider>
      </UdcI18nProvider>,
    );
    return {
      ...utils,
      poll: async (next: Row[]) => {
        rows = next;
        await act(() => qc.refetchQueries());
      },
    };
  }

  const marker = (id: string) =>
    document.querySelector<HTMLElement>(`[data-testid="map-marker"][data-id="${id}"]`);

  it("moves the markers in place, keeps the viewport and the selection, draws the trails", async () => {
    const { poll } = setup([plane("a", { heading: 90 }), plane("b", { heading: 180 })]);
    await waitFor(() => expect(marker("a")).not.toBeNull());
    const el = marker("a") as HTMLElement;
    expect(el).toHaveAttribute("data-icon", "airplane");
    expect(el).toHaveAttribute("data-rotation", "90");
    expect(el.querySelector<HTMLElement>(".udc-map-plane-glyph")?.style.transform).toBe(
      "rotate(90deg)",
    );
    expect(el.style.width).toBe("22px");
    expect(el.className).toContain("udc-map-plane");
    const trails = document.querySelectorAll('[data-testid="map-trail"]');
    expect([...trails].map((t) => t.getAttribute("data-points"))).toEqual(["2", "2"]);

    const view = screen.getByTestId("map");
    fireEvent.click(el);
    await waitFor(() => expect(screen.getByTestId("map-popup")).toHaveAttribute("data-id", "a"));
    fireEvent.mouseOver(el);
    // After the click's own (animated) pan to fit the popup has settled.
    await act(() => new Promise((r) => setTimeout(r, 500)));
    const before = { zoom: view.dataset.zoom, center: view.dataset.center };

    await poll([
      plane("a", {
        heading: 100,
        lat: 44.9,
        lat_history: [44.7, 44.8, 44.9],
        lng_history: [20.3, 20.4, 20.5],
      }),
      plane("c", { heading: 0 }),
    ]);
    await waitFor(() => expect(marker("c")).not.toBeNull());
    // The same element, turned; b is gone, c is new.
    expect(marker("a")).toBe(el);
    expect(el).toHaveAttribute("data-rotation", "100");
    expect(el.querySelector<HTMLElement>(".udc-map-plane-glyph")?.style.transform).toBe(
      "rotate(100deg)",
    );
    expect(marker("b")).toBeNull();
    expect(view.dataset.zoom).toBe(before.zoom);
    expect(view.dataset.center).toBe(before.center);
    // Still selected, its popup still open; its trail grew and is the active one.
    expect(screen.getByTestId("map-popup")).toHaveAttribute("data-id", "a");
    expect(el.classList).toContain("is-selected");
    const trailA = document.querySelector('[data-testid="map-trail"][data-id="a"]');
    expect(trailA).toHaveAttribute("data-points", "3");
    expect(trailA).toHaveAttribute("data-active", "true");
  });
});
