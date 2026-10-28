import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Capabilities,
  type FieldDef,
  getPath,
  type HttpApiOptions,
  type Row,
  type SchemaDoc,
  UdcError,
} from "@jsudc/udc-core";
import { type ArrayLoad, ArraySource, READ_ONLY_ARRAY_CAPABILITIES } from "./array.js";

/** The part of `fetch` the source uses; a test hands in its own. */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; statusText: string; json(): Promise<unknown> }>;

export type Env = Record<string, string | undefined>;

const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * The headers with every `${VAR}` filled from `env`. A header naming a
 * variable that is unset (or empty) is dropped whole: no `Bearer ` with
 * nothing after it.
 */
export function interpolateHeaders(
  headers: Record<string, string> | undefined,
  env: Env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, template] of Object.entries(headers ?? {})) {
    let missing = false;
    const value = template.replace(VAR_RE, (_, v: string) => {
      const got = env[v];
      if (got === undefined || got === "") missing = true;
      return got ?? "";
    });
    if (!missing) out[name] = value;
  }
  return out;
}

const finite = (n: number) => (Number.isFinite(n) ? n : null);

/** One upstream value as the schema type wants it; `null` when it cannot be read as one. */
export function coerceValue(v: unknown, def: FieldDef): unknown {
  if (v === null || v === undefined) return null;
  switch (def.type) {
    case "integer":
    case "year": {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    case "decimal":
    case "rating":
      return typeof v === "number"
        ? finite(v)
        : typeof v === "string" && v.trim()
          ? finite(Number(v))
          : null;
    case "bool":
      if (typeof v === "boolean") return v;
      if (v === "true" || v === 1 || v === "1") return true;
      if (v === "false" || v === 0 || v === "0") return false;
      return null;
    case "datetime":
    case "date": {
      // Epoch milliseconds (USGS) or an ISO string (GitHub); always out as ISO.
      const ms = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
      if (!Number.isFinite(ms)) return null;
      const iso = new Date(ms).toISOString();
      return def.type === "date" ? iso.slice(0, 10) : iso;
    }
    case "string_array":
    case "lookup_array":
      if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined).map(String);
      return typeof v === "string" ? [v] : null;
    case "json":
      return v;
    default:
      if (typeof v === "string") return v;
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      return JSON.stringify(v);
  }
}

/**
 * The rows of one upstream response: `list_unwrap` walked to the array,
 * each item mapped field by field (`field_map[field]`, else `item[field]`)
 * and coerced by the schema type; `__meta.id` from `id_field` (a missing or
 * repeated id gets the item's position appended).
 */
export function mapItems(body: unknown, schema: SchemaDoc, opts: HttpApiOptions): Row[] {
  const list = opts.list_unwrap ? getPath(body, opts.list_unwrap) : body;
  if (!Array.isArray(list)) {
    throw new UdcError(
      "internal",
      opts.list_unwrap
        ? `upstream answer has no array at ${opts.list_unwrap}`
        : "upstream answer is not an array",
    );
  }
  const fields = schema.field_order.filter((f) => !schema.fields[f]?.deleted);
  const seen = new Set<string>();
  return list.slice(0, opts.max_rows).map((item, i) => {
    const raw = getPath(item, opts.id_field);
    let id = raw === null || typeof raw === "object" ? `#${i}` : String(raw);
    if (seen.has(id)) id = `${id}#${i}`;
    seen.add(id);
    const row: Row = { __meta: { id, version: 1 } };
    for (const f of fields) {
      row[f] = coerceValue(getPath(item, opts.field_map[f] ?? f), schema.fields[f] as FieldDef);
    }
    return row;
  });
}

interface Snapshot {
  rows: Row[];
  /** When upstream answered them (ms). */
  fetchedAt: number;
  /** When upstream was last asked, answered or not (ms): the TTL runs from here. */
  checkedAt: number;
  stale: boolean;
}

/**
 * A collection fetched from an HTTP JSON API. The mapped array is kept in
 * memory for `cache_ttl_ms`: every `list` inside it (filter, sort, page) is
 * served without calling upstream, concurrent misses share one call. When
 * upstream fails after a good fetch the old array is served with
 * `stale: true` (and the next attempt waits another TTL); a failing first
 * fetch answers `internal` with the upstream status. With `fixturesDir` the
 * response is read from `<fixturesDir>/<name>.json` and nothing goes out.
 */
export class HttpApiSource extends ArraySource {
  readonly capabilities: Capabilities = { ...READ_ONLY_ARRAY_CAPABILITIES };
  readonly kind = "http_api";
  // Unsorted, the rows come as upstream sent them: USGS newest first, GitHub by last update.
  protected override readonly keepOrder = true;
  protected readonly label: string;
  readonly name: string;
  private readonly opts: HttpApiOptions;
  private readonly fetch: FetchLike;
  private readonly env: Env;
  private readonly fixturesDir: string | undefined;
  private readonly now: () => number;
  private snapshot: Snapshot | null = null;
  private inflight: Promise<Snapshot> | null = null;

  constructor(args: {
    name: string;
    schema: SchemaDoc;
    options: HttpApiOptions;
    fetch?: FetchLike | undefined;
    env?: Env | undefined;
    fixturesDir?: string | undefined;
    now?: (() => number) | undefined;
    pageSizeDefault?: number | undefined;
  }) {
    super(args);
    this.name = args.name;
    this.label = `collection ${args.name} (http_api)`;
    this.opts = args.options;
    this.fetch = args.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.env = args.env ?? process.env;
    this.fixturesDir = args.fixturesDir;
    this.now = args.now ?? Date.now;
  }

  get url(): string {
    return this.opts.base_url.replace(/\/+$/, "") + this.opts.list_endpoint;
  }

  protected async load(): Promise<ArrayLoad> {
    const snap = await this.current();
    const rows = snap.stale
      ? snap.rows.map((r) => ({ ...r, __meta: { ...r.__meta, stale: true } }))
      : snap.rows;
    return {
      rows,
      extra: { fetched_at: new Date(snap.fetchedAt).toISOString(), stale: snap.stale },
    };
  }

  private async current(): Promise<Snapshot> {
    const missing = (this.opts.env_required ?? []).filter((v) => !this.env[v]);
    if (missing.length > 0) {
      throw new UdcError(
        "unsupported_op",
        `${this.label} needs ${missing.join(", ")} set in the server's environment`,
        { env_required: missing },
      );
    }
    const snap = this.snapshot;
    if (snap && this.now() - snap.checkedAt < this.opts.cache_ttl_ms) return snap;
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(): Promise<Snapshot> {
    const at = this.now();
    try {
      const rows = mapItems(await this.fetchBody(), this.schema, this.opts);
      this.snapshot = { rows, fetchedAt: at, checkedAt: at, stale: false };
      return this.snapshot;
    } catch (err) {
      const old = this.snapshot;
      if (!old) throw err instanceof UdcError ? err : this.upstreamError(err);
      this.snapshot = { ...old, checkedAt: at, stale: true };
      return this.snapshot;
    }
  }

  private async fetchBody(): Promise<unknown> {
    if (this.fixturesDir !== undefined) {
      const file = join(this.fixturesDir, `${this.name}.json`);
      try {
        return JSON.parse(await readFile(file, "utf8"));
      } catch (err) {
        throw new UdcError("internal", `fixture ${file} cannot be read`, {
          fixture: file,
          reason: (err as Error).message,
        });
      }
    }
    const res = await this.fetch(this.url, {
      headers: interpolateHeaders(this.opts.headers, this.env),
      signal: AbortSignal.timeout(this.opts.timeout_ms),
    });
    if (!res.ok) {
      throw new UdcError("internal", `upstream answered ${res.status} ${res.statusText}`.trim(), {
        url: this.url,
        status: res.status,
      });
    }
    return res.json();
  }

  private upstreamError(err: unknown): UdcError {
    const reason = err instanceof Error ? err.message : String(err);
    return new UdcError("internal", `upstream unreachable: ${reason}`, {
      url: this.url,
      status: null,
      reason,
    });
  }
}
