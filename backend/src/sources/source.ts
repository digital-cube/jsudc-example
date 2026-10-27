import {
  type Capabilities,
  type FieldDef,
  type FilterNode,
  type ListResponse,
  type MutateOp,
  type PageRequest,
  type Row,
  type SchemaDoc,
  type SchemaPosition,
  type SortKey,
  SUPPORTED_OPS,
} from "@jsudc/udc-core";

/** A `list` request as a source sees it: the collection is already resolved. */
export interface SourceListRequest {
  filter?: FilterNode | undefined;
  sort?: SortKey[] | undefined;
  page?: PageRequest | undefined;
}

export interface SourceMutation {
  op: MutateOp;
  id?: string | undefined;
  row?: Record<string, unknown> | undefined;
  expected_version?: number | undefined;
}

export interface SourceAddField {
  name: string;
  fielddef: FieldDef;
  position: SchemaPosition;
}

/** A `reindex` request as a source sees it; the defaults are already applied by the caller or here. */
export interface SourceReindex {
  scope: Record<string, string | number | boolean>;
  order_field?: string | undefined;
  gap?: number | undefined;
}

export const DEFAULT_ORDER_FIELD = "order";

export interface SourceUpdateField {
  name: string;
  fielddef: FieldDef;
}

/**
 * Where a collection's rows live. Phase 1 has one real implementation
 * (Postgres jsonb) and an in-memory one for dispatcher tests. The schema
 * methods return the new active document (soft-deleted fields included);
 * a source without `capabilities.schema_edit` refuses them.
 */
export interface Source {
  readonly capabilities: Capabilities;
  /** The active schema document, `version` in its wire form (`"v<n>"`). */
  describe(): Promise<SchemaDoc>;
  list(req: SourceListRequest): Promise<ListResponse>;
  read(id: string): Promise<Row>;
  mutate(op: SourceMutation): Promise<Row>;
  addField(req: SourceAddField): Promise<SchemaDoc>;
  updateField(req: SourceUpdateField): Promise<SchemaDoc>;
  softDeleteField(field: string): Promise<SchemaDoc>;
  /**
   * Renumber `order_field` of the rows matching `scope` to `gap`, `2*gap`, …
   * in their current order (NULLs last, ties by id), bumping each version.
   * Answers how many rows it renumbered. Present when `capabilities.reindex`.
   */
  reindex?(req: SourceReindex): Promise<number>;
}

export const ALL_FILTER_OPS = [...SUPPORTED_OPS];

export const DEFAULT_PAGE_SIZE = 50;
