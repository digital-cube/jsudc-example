import type { RendererName } from "@jsudc/udc-core";
import { Kanban, LayoutGrid, Table2 } from "lucide-react";
import { CardRenderer } from "../cards/CardRenderer";
import { KanbanBoardSwitcher } from "../kanban/KanbanBoardSwitcher";
import { KanbanRenderer } from "../kanban/KanbanRenderer";
import { TableRenderer } from "../table/TableRenderer";
import type { RendererEntry, RendererProps } from "./types";

function TableTab(props: RendererProps) {
  return <TableRenderer {...props} />;
}

function CardsTab(props: RendererProps) {
  return <CardRenderer {...props} />;
}

/**
 * Renderer name → its component and tab. `<UdcDataView>` shows a tab for
 * every name in `available_renderers`; a name with no entry here is drawn
 * disabled. A new renderer is one more entry.
 */
export const RENDERERS: Partial<Record<RendererName, RendererEntry>> = {
  table: { component: TableTab, icon: Table2, labelKey: "TAB_TABLE", paging: true, editMode: true },
  cards: {
    component: CardsTab,
    icon: LayoutGrid,
    labelKey: "TAB_CARDS",
    paging: true,
    editMode: false,
  },
  kanban: {
    component: KanbanRenderer,
    icon: Kanban,
    labelKey: "TAB_KANBAN",
    paging: false,
    editMode: false,
    toolbar: KanbanBoardSwitcher,
  },
};

export function rendererEntry(name: string): RendererEntry | undefined {
  return Object.hasOwn(RENDERERS, name) ? RENDERERS[name as RendererName] : undefined;
}

export interface RendererTab {
  name: string;
  entry: RendererEntry | undefined;
}

/** The tabs of a view: every available renderer, in view order, with its entry when one exists. */
export function rendererTabs(available: readonly string[]): RendererTab[] {
  return available.map((name) => ({ name, entry: rendererEntry(name) }));
}

/**
 * The tab to draw: the requested one when it is available and has a
 * component, else the view's default, else the first available one with a
 * component, else `table`.
 */
export function resolveTab(
  requested: string,
  available: readonly string[],
  fallback: string,
): string {
  const usable = (n: string) => available.includes(n) && rendererEntry(n) !== undefined;
  if (usable(requested)) return requested;
  if (usable(fallback)) return fallback;
  return available.find(usable) ?? "table";
}
