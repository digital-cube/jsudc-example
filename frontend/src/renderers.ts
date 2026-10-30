import { createRendererRegistry } from "@jsudc/react";
import { calendarRenderer } from "@jsudc/react/calendar";
import { cardsRenderer } from "@jsudc/react/cards";
import { chartRenderer } from "@jsudc/react/chart";
import { kanbanRenderer } from "@jsudc/react/kanban";
import { mapRenderer } from "@jsudc/react/map";
import { tableRenderer } from "@jsudc/react/table";
import { treeRenderer } from "@jsudc/react/tree";

/**
 * Every renderer the example shows, registered one by one from its subpath:
 * the explicit form of `RENDERERS` from `@jsudc/react/all`. A host that never
 * shows a map leaves `mapRenderer` out and does not install Leaflet. The
 * order is the order of the tabs.
 */
export const EXAMPLE_RENDERERS = createRendererRegistry(
  tableRenderer,
  cardsRenderer,
  kanbanRenderer,
  calendarRenderer,
  treeRenderer,
  mapRenderer,
  chartRenderer,
);
