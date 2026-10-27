import { randomUUID } from "node:crypto";
import {
  type Capabilities,
  evaluateFilter,
  type ListResponse,
  ORDER_GAP,
  type Row,
  type SchemaDoc,
  UdcError,
} from "@jsudc/udc-core";
import {
  assertQueryFields,
  assertValidRow,
  notFound,
  reindexPlan,
  versionConflict,
  withoutMeta,
} from "./fields.js";
import {
  ALL_FILTER_OPS,
  DEFAULT_ORDER_FIELD,
  DEFAULT_PAGE_SIZE,
  type Source,
  type SourceListRequest,
  type SourceMutation,
  type SourceReindex,
} from "./source.js";

const readOnlySchema = () =>
  Promise.reject(
    new UdcError("unsupported_op", "the memory source cannot edit its schema (schema_edit: false)"),
  );

interface Stored {
  id: string;
  version: number;
  data: Record<string, unknown>;
}

const isMissing = (v: unknown) => v === null || v === undefined;

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Rows in an array: filters through udc-core's `evaluateFilter`, offset paging only. */
export class MemorySource implements Source {
  readonly capabilities: Capabilities = {
    mutate: true,
    subscribe: false,
    total_count: true,
    schema_edit: false,
    config_edit: false,
    reindex: true,
    paging: ["offset"],
    supported_filter_ops: ALL_FILTER_OPS,
  };

  private readonly schema: SchemaDoc;
  private readonly pageSizeDefault: number;
  private rows: Stored[];

  constructor(opts: {
    schema: SchemaDoc;
    rows?: Record<string, unknown>[];
    pageSizeDefault?: number;
  }) {
    this.schema = opts.schema;
    this.pageSizeDefault = opts.pageSizeDefault ?? DEFAULT_PAGE_SIZE;
    this.rows = (opts.rows ?? []).map((data) => ({
      id: randomUUID(),
      version: 1,
      data: { ...data },
    }));
  }

  async describe(): Promise<SchemaDoc> {
    return this.schema;
  }

  async list(req: SourceListRequest): Promise<ListResponse> {
    assertQueryFields(this.schema, req.filter, req.sort);
    if (req.page?.cursor != null) {
      throw new UdcError("unsupported_op", "the memory source pages by offset only");
    }
    const matched = this.rows.filter((r) => evaluateFilter(req.filter, r.data));
    const keys = req.sort ?? [];
    matched.sort((a, b) => {
      for (const { field, dir } of keys) {
        const x = a.data[field];
        const y = b.data[field];
        // NULLS LAST in both directions, as the SQL source.
        if (isMissing(x) || isMissing(y)) {
          if (isMissing(x) && isMissing(y)) continue;
          return isMissing(x) ? 1 : -1;
        }
        const c = compareValues(x, y);
        if (c !== 0) return dir === "desc" ? -c : c;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const offset = req.page?.offset ?? 0;
    const limit = req.page?.limit ?? this.pageSizeDefault;
    return {
      rows: matched.slice(offset, offset + limit).map(serialize),
      next_cursor: null,
      total: matched.length,
    };
  }

  async read(id: string): Promise<Row> {
    return serialize(this.find(id));
  }

  async mutate(m: SourceMutation): Promise<Row> {
    if (m.op === "insert") {
      const data = withoutMeta(m.row ?? {});
      assertValidRow(this.schema, data, "insert");
      const stored = { id: randomUUID(), version: 1, data };
      this.rows.push(stored);
      return serialize(stored);
    }
    if (m.id === undefined) throw new UdcError("validation_error", `${m.op} needs an id`);
    const patch = m.op === "update" ? withoutMeta(m.row ?? {}) : {};
    if (m.op === "update") assertValidRow(this.schema, patch, "patch");
    const stored = this.find(m.id);
    if (m.expected_version !== undefined && m.expected_version !== stored.version) {
      throw versionConflict(m.id, m.expected_version, stored.version);
    }
    if (m.op === "delete") {
      this.rows = this.rows.filter((r) => r !== stored);
      return serialize(stored);
    }
    stored.data = { ...stored.data, ...patch };
    stored.version += 1;
    return serialize(stored);
  }

  async reindex(req: SourceReindex): Promise<number> {
    const { filter, orderField } = reindexPlan(
      this.schema,
      req.scope,
      req.order_field ?? DEFAULT_ORDER_FIELD,
    );
    // Same ordering as the list sort (NULLS LAST, then id), so the result matches the SQL source.
    const { rows } = await this.list({
      filter,
      sort: [{ field: orderField }],
      page: { limit: Number.MAX_SAFE_INTEGER },
    });
    const gap = req.gap ?? ORDER_GAP;
    rows.forEach((row, i) => {
      const stored = this.find(row.__meta.id);
      stored.data = { ...stored.data, [orderField]: (i + 1) * gap };
      stored.version += 1;
    });
    return rows.length;
  }

  addField(): Promise<SchemaDoc> {
    return readOnlySchema();
  }

  updateField(): Promise<SchemaDoc> {
    return readOnlySchema();
  }

  softDeleteField(): Promise<SchemaDoc> {
    return readOnlySchema();
  }

  private find(id: string): Stored {
    const stored = this.rows.find((r) => r.id === id);
    if (!stored) throw notFound(id);
    return stored;
  }
}

function serialize(r: Stored): Row {
  return { __meta: { id: r.id, version: r.version }, ...r.data };
}
