import {
  type Capabilities,
  type FilterNode,
  type ListResponse,
  type MutateOp,
  type PageRequest,
  type Row,
  type SchemaDoc,
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

/**
 * Where a collection's rows live. Phase 1 has one real implementation
 * (Postgres jsonb) and an in-memory one for dispatcher tests; the
 * `schema.*` methods arrive with ticket 3.
 */
export interface Source {
  readonly capabilities: Capabilities;
  /** The active schema document, `version` in its wire form (`"v<n>"`). */
  describe(): Promise<SchemaDoc>;
  list(req: SourceListRequest): Promise<ListResponse>;
  read(id: string): Promise<Row>;
  mutate(op: SourceMutation): Promise<Row>;
}

export const ALL_FILTER_OPS = [...SUPPORTED_OPS];

export const DEFAULT_PAGE_SIZE = 50;
