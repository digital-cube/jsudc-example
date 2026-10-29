import { MapOptionsSchema, type RowColorConfig } from "@jsudc/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UdcI18nProvider } from "../src/i18n/i18n";
import { MapRenderer, MapToolbar } from "../src/map/MapRenderer";
import {
  boundsOf,
  coordsOf,
  initialView,
  markerRadius,
  markerTone,
  regionAt,
  toMarkers,
} from "../src/map/model";
import { rendererEntry, rendererTabs, resolveTab } from "../src/renderers/registry";
import { row } from "./fetchMock";

const opts = (block: Record<string, unknown> = {}) =>
  MapOptionsSchema.parse({ lat_field: "lat", lng_field: "lng", ...block });

const companies = opts({
  radius_field: "employees",
  radius_scale: 0.02,
  radius_max: 24,
  center: [44.2, 20.9],
  zoom: 7,
  regions: [
    { id: "serbia", label: "Serbia", center: [44.2, 20.9], zoom: 7 },
    { id: "vojvodina", label: "Vojvodina", center: [45.4, 19.9], zoom: 8 },
    { id: "south", label: "South", center: [43.15, 21.9], zoom: 8 },
  ],
});

describe("the registry", () => {
  it("resolves the map tab, with no paging and no edit mode", () => {
    expect(rendererEntry("map")).toMatchObject({
      component: MapRenderer,
      labelKey: "TAB_MAP",
      paging: false,
      editMode: false,
    });
    expect(rendererTabs(["table", "cards", "map"]).map((t) => t.entry !== undefined)).toEqual([
      true,
      true,
      true,
    ]);
    expect(resolveTab("map", ["table", "cards", "map"], "table")).toBe("map");
    // A collection without the tab falls back, a bookmarked ?tab=map notwithstanding.
    expect(resolveTab("map", ["table", "cards"], "table")).toBe("table");
  });
});

describe("markers", () => {
  it("radius: radius_min + value * radius_scale, capped at radius_max", () => {
    expect(markerRadius({ employees: 100 }, companies)).toBe(6);
    expect(markerRadius({ employees: 5000 }, companies)).toBe(24);
    // No value, a zero, a negative or junk: the minimum.
    for (const employees of [undefined, null, 0, -5, "many"]) {
      expect(markerRadius({ employees }, companies)).toBe(4);
    }
    // A numeric string counts (a decimal may arrive as one).
    expect(markerRadius({ employees: "150" }, companies)).toBe(7);
    // Without radius_field every marker has the minimum.
    expect(markerRadius({ employees: 100 }, opts({ radius_min: 6 }))).toBe(6);
    // Quakes: magnitude * 2.2 on top of 5.
    expect(
      markerRadius({ mag: 6 }, opts({ radius_field: "mag", radius_min: 5, radius_scale: 2.2 })),
    ).toBeCloseTo(18.2);
  });

  it("colour: the first row_color rule that matches, the accent otherwise", () => {
    const active: RowColorConfig = { field: "active", rules: [{ value: false, color: "muted" }] };
    expect(markerTone({ active: false }, active)).toBe("muted");
    expect(markerTone({ active: true }, active)).toBe("accent");
    expect(markerTone({ active: false }, undefined)).toBe("accent");
    const mag: RowColorConfig = {
      field: "mag",
      rules: [
        { min: 7, color: "danger" },
        { min: 6, max: 6.999, color: "warning" },
        { else: true, color: "default" },
      ],
    };
    expect(markerTone({ mag: 7.3 }, mag)).toBe("danger");
    expect(markerTone({ mag: 6.2 }, mag)).toBe("warning");
    // `default` is no colour on a circle: the accent.
    expect(markerTone({ mag: 4.6 }, mag)).toBe("accent");
  });

  it("places only rows with a position in range, largest first", () => {
    expect(coordsOf({ lat: "44.8", lng: 20.4 }, companies)).toEqual([44.8, 20.4]);
    expect(coordsOf({ lat: 95, lng: 20 }, companies)).toBeNull();
    expect(coordsOf({ lat: 44, lng: null }, companies)).toBeNull();
    const rows = [
      row("small", 1, { lat: 43.3, lng: 21.9, employees: 10 }),
      row("nowhere", 1, { lat: null, lng: null, employees: 900 }),
      row("big", 1, { lat: 44.8, lng: 20.4, employees: 900 }),
    ];
    const markers = toMarkers(rows, companies, undefined);
    expect(markers.map((m) => m.id)).toEqual(["big", "small"]);
    expect(markers[0]).toMatchObject({ lat: 44.8, lng: 20.4, radius: 22, tone: "accent" });
    expect(boundsOf(markers)).toEqual([
      [43.3, 20.4],
      [44.8, 21.9],
    ]);
    expect(boundsOf([])).toBeNull();
  });
});

describe("regions", () => {
  it("opens on the default region, else on center / zoom, else on the world", () => {
    expect(initialView(companies)).toEqual({ center: [44.2, 20.9], zoom: 7, region: null });
    expect(initialView({ ...companies, default_region: "south" })).toEqual({
      center: [43.15, 21.9],
      zoom: 8,
      region: "south",
    });
    expect(initialView(opts())).toEqual({ center: [20, 0], zoom: 2, region: null });
  });

  it("knows which region a view shows, and none after a pan or a zoom by hand", () => {
    expect(regionAt(companies, [44.2, 20.9], 7)).toBe("serbia");
    expect(regionAt(companies, [45.4001, 19.8999], 8)).toBe("vojvodina");
    expect(regionAt(companies, [45.4, 19.9], 9)).toBeNull();
    expect(regionAt(companies, [45.0, 19.9], 8)).toBeNull();
    expect(regionAt(opts(), [20, 0], 2)).toBeNull();
  });

  it("the toolbar presses the current region and flies to the one clicked", () => {
    const onRegion = vi.fn();
    const onFitAll = vi.fn();
    render(
      <UdcI18nProvider>
        <MapToolbar
          opts={companies}
          region="serbia"
          onRegion={onRegion}
          onFitAll={onFitAll}
          canFit
        />
      </UdcI18nProvider>,
    );
    expect(screen.getByTestId("map-region-serbia")).toHaveAttribute("data-state", "on");
    expect(screen.getByTestId("map-region-south")).toHaveAttribute("data-state", "off");
    fireEvent.click(screen.getByTestId("map-region-south"));
    expect(onRegion).toHaveBeenCalledWith("south");
    fireEvent.click(screen.getByTestId("map-fit-all"));
    expect(onFitAll).toHaveBeenCalledOnce();
  });

  it("draws no region buttons without regions, and no fit without markers", () => {
    render(
      <UdcI18nProvider>
        <MapToolbar
          opts={opts()}
          region={null}
          onRegion={vi.fn()}
          onFitAll={vi.fn()}
          canFit={false}
        />
      </UdcI18nProvider>,
    );
    expect(screen.queryByTestId("map-regions")).toBeNull();
    expect(screen.getByTestId("map-fit-all")).toBeDisabled();
  });
});
