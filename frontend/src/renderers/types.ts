import type { DescribeResponse, FilterNode, SortKey } from "@jsudc/udc-core";
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import type { SchemaAction } from "../schema-editor/fieldForm";
import type { UdcCollectionResult } from "../udc/hooks";
import type { PagingMode } from "../udc/keys";

/** The row count a renderer that loads its own rows reports to the toolbar. */
export interface RendererCount {
  shown: number;
  total: number | null;
  /**
   * `nodes`: the toolbar reads "N nodes" (the tree), `map`: "N on map of M"
   * (rows without a position are not drawn), instead of "Showing N of M".
   */
  unit?: "nodes" | "map";
}

/** What `<UdcDataView>` hands every renderer; each takes the parts it uses. */
export interface RendererProps {
  collection: string;
  /** `describe` with soft-deleted fields already gone. */
  describe: DescribeResponse;
  /** The data view's paged list; loaded only for a renderer with `paging`. */
  data: UdcCollectionResult;
  /** Search, chips and filter tree, composed. */
  filter: FilterNode | undefined;
  /** Chips and filter tree without the search: for a renderer that searches what it loaded. */
  baseFilter: FilterNode | undefined;
  /** The search box, as typed. */
  search: string;
  sort: SortKey[];
  onSort: (field: string, multi: boolean) => void;
  mode: PagingMode;
  page: number;
  limit: number;
  onPage: (page: number) => void;
  filtered: boolean;
  onClearFilters: () => void;
  resetKey: string;
  /** Set when the schema may be edited and the renderer has `editMode`. */
  onSchemaAction?: ((a: SchemaAction) => void) | undefined;
  /** For a renderer without `paging`: the count the toolbar shows. */
  onCount: (count: RendererCount | null) => void;
}

export interface RendererEntry {
  component: ComponentType<RendererProps>;
  icon: LucideIcon;
  /** `APP.<labelKey>` is the tab label. */
  labelKey: string;
  /** Reads the data view's paged list: the paging toggle shows, the list loads. */
  paging: boolean;
  /** Offers the schema editor (column menus, add column). */
  editMode: boolean;
  /** Extra controls in the toolbar while this tab is open. */
  toolbar?: ComponentType<{ collection: string; describe: DescribeResponse }>;
}
