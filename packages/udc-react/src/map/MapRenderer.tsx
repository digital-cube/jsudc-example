import "leaflet/dist/leaflet.css";
import type { DescribeResponse, MapOptions, Row } from "@jsudc/core";
import L from "leaflet";
import { Maximize } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/misc";
import { Segmented } from "../components/ui/segmented";
import { tableSection, useI18n } from "../i18n/i18n";
import { AllRowsStatus } from "../renderers/AllRowsStatus";
import type { RendererProps } from "../renderers/types";
import { CellValue } from "../table/cells";
import { EmptyState, ErrorState } from "../table/states";
import { useUdcAllRows } from "../udc/hooks";
import {
  airplaneHtml,
  boundsOf,
  initialView,
  type MapMarker,
  regionAt,
  regionById,
  toMarkers,
  trailMarkers,
} from "./model";

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const FIT_PADDING: L.PointExpression = [32, 32];
/** Fitting a single marker (or a tight cluster) should not zoom to a street. */
const FIT_MAX_ZOOM = 12;

/** Frame every marker (no-op without one). */
function fitMarkers(map: L.Map | null, list: readonly MapMarker[], animate: boolean) {
  const bounds = boundsOf(list);
  if (bounds && map)
    map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, animate });
}

/** A marker on the map: a circle, or an aeroplane (a divIcon) turned along its track. */
type MarkerLayer = L.CircleMarker | L.Marker;

const isPlane = (layer: MarkerLayer): layer is L.Marker => layer instanceof L.Marker;

/** The element a test and the selection styles read: the circle's path, the plane's icon. */
const markerElement = (layer: MarkerLayer): Element | undefined =>
  isPlane(layer) ? layer.getElement() : layer.getElement();

function planeIcon(m: MapMarker, size: number): L.DivIcon {
  return L.divIcon({
    html: airplaneHtml(m.rotation ?? 0, size),
    // No leaflet-div-icon: its white box and border would frame the plane.
    className: `udc-map-plane tone-${m.tone}`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Turn and recolour a plane in place: its element (and a hover on it) stays. */
function updatePlane(layer: L.Marker, m: MapMarker) {
  const el = layer.getElement();
  if (!el) return;
  for (const c of [...el.classList]) if (c.startsWith("tone-")) el.classList.remove(c);
  el.classList.add(`tone-${m.tone}`);
  el.setAttribute("data-rotation", String(m.rotation ?? 0));
  const glyph = el.querySelector<HTMLElement>(".udc-map-plane-glyph");
  if (glyph) glyph.style.transform = `rotate(${m.rotation ?? 0}deg)`;
}

/** The `map` tab: every row with a position as a circle (or an aeroplane), over OpenStreetMap tiles. */
export function MapRenderer(props: RendererProps) {
  const opts = props.describe.view.map_options;
  const { t } = useI18n();
  if (!opts) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground" data-testid="map-missing">
        {t("APP", "MAP_NO_OPTIONS")}
      </div>
    );
  }
  return <MapView {...props} opts={opts} />;
}

/** The view a toolbar and a test read: centre to 4 decimals and zoom. */
interface ViewState {
  center: [number, number];
  zoom: number;
}

function MapView({
  collection,
  describe,
  filter,
  sort,
  filtered,
  onClearFilters,
  onCount,
  opts,
}: RendererProps & { opts: MapOptions }) {
  const { t } = useI18n();
  const q = useUdcAllRows({
    collection,
    filter,
    sort,
    capabilities: describe.capabilities,
    max: opts.max_rows,
    refetchInterval: describe.view.refresh_interval_ms,
  });
  const rowColor = describe.view.row_color;
  const markers = useMemo(() => toMarkers(q.rows, opts, rowColor), [q.rows, opts, rowColor]);

  useEffect(() => {
    onCount(
      q.total === null
        ? null
        : {
            shown: markers.length,
            total: q.total,
            unit: "map",
            fetchedAt: q.fetchedAt,
            stale: q.stale,
          },
    );
  }, [onCount, markers.length, q.total, q.fetchedAt, q.stale]);
  useEffect(() => () => onCount(null), [onCount]);

  // --- the Leaflet map: one per mount -----------------------------------------------
  const containerRef = useRef<HTMLElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const trailLayerRef = useRef<L.LayerGroup | null>(null);
  const trailRendererRef = useRef<L.Renderer | null>(null);
  const popupRef = useRef<L.Popup | null>(null);
  const byId = useRef(new Map<string, MarkerLayer>());
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const [popupEl] = useState(() => document.createElement("div"));
  const [view, setView] = useState<ViewState>(() => initialView(opts));
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const start = initialView(optsRef.current);
    const map = L.map(el, { center: start.center, zoom: start.zoom, worldCopyJump: true });
    L.tileLayer(OSM_TILES, { attribution: OSM_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    // Trails under every marker (circles are in the overlay pane, z 400; planes above it).
    map.createPane("udc-trails").style.zIndex = "350";
    trailRendererRef.current = L.svg({ pane: "udc-trails" });
    trailLayerRef.current = L.layerGroup().addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    popupRef.current = L.popup({ className: "udc-map-popup", maxWidth: 320, minWidth: 200 });
    popupRef.current.setContent(popupEl);
    map.on("moveend", () => {
      const c = map.getCenter();
      const round = (x: number) => Math.round(x * 1e4) / 1e4;
      setView({ center: [round(c.lat), round(c.lng)], zoom: map.getZoom() });
    });
    // Closed by its button, Escape or a click on the map: nothing is selected any more.
    map.on("popupclose", (e) => {
      if (e.popup === popupRef.current) setSelected(null);
    });
    mapRef.current = map;
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(el);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      trailLayerRef.current = null;
      trailRendererRef.current = null;
      popupRef.current = null;
      byId.current.clear();
    };
  }, [popupEl]);

  // --- markers, kept by id: a poll moves them in place ---------------------------------
  const fitted = useRef(false);
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const size = optsRef.current.icon_size;
    const seen = new Set<string>();
    for (const m of markers) {
      seen.add(m.id);
      const plane = m.rotation !== null;
      let marker = byId.current.get(m.id);
      // A row that gained or lost its track changes kind: drawn anew.
      if (marker && isPlane(marker) !== plane) {
        layer.removeLayer(marker);
        marker = undefined;
      }
      if (marker) {
        marker.setLatLng([m.lat, m.lng]);
        if (isPlane(marker)) updatePlane(marker, m);
        else {
          marker.setRadius(m.radius);
          const path = marker.getElement();
          path?.setAttribute("class", `leaflet-interactive udc-map-marker tone-${m.tone}`);
        }
        continue;
      }
      const id = m.id;
      marker = plane
        ? L.marker([m.lat, m.lng], {
            icon: planeIcon(m, size),
            keyboard: false,
            bubblingMouseEvents: false,
          })
        : L.circleMarker([m.lat, m.lng], {
            radius: m.radius,
            weight: 1.5,
            fillOpacity: 0.4,
            // The colour comes from the theme's tokens in index.css, by tone.
            className: `udc-map-marker tone-${m.tone}`,
            bubblingMouseEvents: false,
          });
      marker.on("click", () => setSelected(id));
      marker.on("mouseover", () => setHovered(id));
      marker.on("mouseout", () => setHovered((h) => (h === id ? null : h)));
      marker.addTo(layer);
      const el = markerElement(marker);
      el?.setAttribute("data-testid", "map-marker");
      el?.setAttribute("data-id", m.id);
      if (plane) {
        el?.setAttribute("data-icon", "airplane");
        el?.setAttribute("data-rotation", String(m.rotation ?? 0));
      }
      byId.current.set(m.id, marker);
    }
    for (const [id, marker] of byId.current) {
      if (seen.has(id)) continue;
      layer.removeLayer(marker);
      byId.current.delete(id);
    }
    // Fit once, when the first rows arrive; later filters leave the view where the user put it.
    if (optsRef.current.fit_bounds && !fitted.current && markers.length > 0) {
      fitted.current = true;
      fitMarkers(mapRef.current, markers, false);
    }
  }, [markers]);

  // --- trails: every one up to TRAILS_FOR_ALL_MAX markers, else the hovered and the selected
  useEffect(() => {
    const layer = trailLayerRef.current;
    const renderer = trailRendererRef.current;
    if (!layer || !renderer) return;
    layer.clearLayers();
    for (const m of trailMarkers(markers, hovered, selected)) {
      const active = m.id === hovered || m.id === selected;
      const line = L.polyline(m.trail, {
        renderer,
        interactive: false,
        weight: active ? 2.5 : 1.5,
        className: `udc-map-trail tone-${m.tone}${active ? " is-active" : ""}`,
      }).addTo(layer);
      const path = line.getElement();
      path?.setAttribute("data-testid", "map-trail");
      path?.setAttribute("data-id", m.id);
      path?.setAttribute("data-points", String(m.trail.length));
      if (active) path?.setAttribute("data-active", "true");
    }
  }, [markers, hovered, selected]);

  // --- the selected marker: highlighted, on top, its popup open ------------------------
  const selectedMarker = selected ? markers.find((m) => m.id === selected) : undefined;
  useEffect(() => {
    const map = mapRef.current;
    const popup = popupRef.current;
    if (!map || !popup) return;
    const marker = selectedMarker ? byId.current.get(selectedMarker.id) : undefined;
    if (!selectedMarker || !marker) {
      if (map.hasLayer(popup)) map.closePopup(popup);
      return;
    }
    const el = markerElement(marker);
    el?.classList.add("is-selected");
    if (isPlane(marker)) marker.setZIndexOffset(1000);
    else marker.bringToFront();
    // Opened by a click, it pans the map to fit; moved by a poll (setLatLng and update pan
    // too), it follows its marker and the viewport stays where the user put it.
    const open = map.hasLayer(popup);
    popup.options.autoPan = !open;
    popup.options.offset = isPlane(marker) ? [0, -opts.icon_size / 2] : [0, 7];
    popup.setLatLng(marker.getLatLng());
    if (!open) popup.openOn(map);
    else popup.update();
    return () => {
      el?.classList.remove("is-selected");
      if (isPlane(marker)) marker.setZIndexOffset(0);
    };
  }, [selectedMarker, opts.icon_size]);

  // A selection the filter took away goes with it.
  useEffect(() => {
    if (selected && !selectedMarker && !q.isFetching) setSelected(null);
  }, [selected, selectedMarker, q.isFetching]);

  const flyTo = (id: string) => {
    const r = regionById(opts, id);
    if (r) mapRef.current?.flyTo(r.center, r.zoom, { duration: 0.6 });
  };

  const region = regionAt(opts, view.center, view.zoom);
  const firstLoad = q.isLoading && q.rows.length === 0;
  const error = q.error && q.rows.length === 0 ? q.error : null;
  const empty = !firstLoad && !error && !q.isFetching && q.rows.length === 0;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="map"
      data-zoom={view.zoom}
      data-center={view.center.join(",")}
      data-region={region ?? undefined}
    >
      <AllRowsStatus result={q} />
      <MapToolbar
        opts={opts}
        region={region}
        onRegion={flyTo}
        onFitAll={() => fitMarkers(mapRef.current, markers, true)}
        canFit={markers.length > 0}
      />
      <div className="relative min-h-0 flex-1">
        <section
          ref={containerRef}
          className="udc-map absolute inset-0"
          aria-label={t("APP", "TAB_MAP")}
        />
        {firstLoad ? (
          <div className="absolute inset-0 z-[1000] p-3" data-testid="map-skeleton">
            <Skeleton className="size-full rounded-lg" />
          </div>
        ) : null}
        {error || empty ? (
          <div className="absolute inset-0 z-[1000] grid place-items-center bg-background/70 backdrop-blur-[1px]">
            <div className="rounded-xl border border-border bg-surface shadow-lg">
              {error ? (
                <ErrorState error={error} onRetry={() => void q.refetch()} />
              ) : (
                <EmptyState filtered={filtered} onClear={onClearFilters} />
              )}
            </div>
          </div>
        ) : null}
      </div>
      {selectedMarker
        ? createPortal(
            <MapPopup
              row={selectedMarker.row}
              collection={collection}
              describe={describe}
              opts={opts}
            />,
            popupEl,
          )
        : null}
    </div>
  );
}

/** Region buttons and "fit all", above the map; the count is the data view's. */
export function MapToolbar({
  opts,
  region,
  onRegion,
  onFitAll,
  canFit,
}: {
  opts: MapOptions;
  region: string | null;
  onRegion: (id: string) => void;
  onFitAll: () => void;
  canFit: boolean;
}) {
  const { t } = useI18n();
  const regions = opts.regions ?? [];
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5"
      data-testid="map-toolbar"
    >
      {regions.length > 0 ? (
        <Segmented<string>
          aria-label={t("APP", "MAP_REGIONS")}
          data-testid="map-regions"
          value={region ?? ""}
          onChange={onRegion}
          options={regions.map((r) => ({
            value: r.id,
            label: r.label,
            testId: `map-region-${r.id}`,
          }))}
        />
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        data-testid="map-fit-all"
        disabled={!canFit}
        onClick={onFitAll}
      >
        <Maximize />
        {t("APP", "MAP_FIT_ALL")}
      </Button>
    </div>
  );
}

/** The popup of a marker: `popup_fields` (else the first columns), as the table formats them. */
function MapPopup({
  row,
  collection,
  describe,
  opts,
}: {
  row: Row;
  collection: string;
  describe: DescribeResponse;
  opts: MapOptions;
}) {
  const { t, locale, intlLocale } = useI18n();
  const { view, schema } = describe;
  const section = tableSection(collection);
  const fields = (opts.popup_fields ?? view.columns.slice(0, 4).map((c) => c.field)).filter(
    (f) => schema.fields[f],
  );
  const column = (field: string) => view.columns.find((c) => c.field === field) ?? { field };
  const [head, ...rest] = fields;
  return (
    <div data-testid="map-popup" data-id={row.__meta.id} className="flex flex-col gap-1.5">
      {head ? (
        <div
          className="text-sm leading-snug font-semibold text-foreground"
          data-testid={`map-popup-${head}`}
        >
          <CellValue
            value={row[head]}
            column={column(head)}
            def={schema.fields[head]}
            locale={locale}
            intlLocale={intlLocale}
          />
        </div>
      ) : null}
      {rest.length > 0 ? (
        <dl className="flex flex-col">
          {rest.map((field) => (
            <div
              key={field}
              data-testid={`map-popup-${field}`}
              className="flex min-h-6 items-center justify-between gap-4 border-t border-dashed border-border/80 py-0.5"
            >
              <dt className="shrink-0 text-xs text-muted-foreground">{t(section, field)}</dt>
              <dd className="flex min-w-0 items-center justify-end text-right text-[13px] font-medium text-foreground">
                <CellValue
                  value={row[field]}
                  column={column(field)}
                  def={schema.fields[field]}
                  locale={locale}
                  intlLocale={intlLocale}
                />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
