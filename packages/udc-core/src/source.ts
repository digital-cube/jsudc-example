import { z } from "zod";
import type { FieldDef, SchemaDoc } from "./schema.js";

/*
 * Where a collection's rows come from: `source.yaml` next to its `view.yaml`.
 * An absent file means `{kind: postgres_jsonb}`. The options block is typed
 * per kind; a dclabs-style file that writes the options flat next to `kind`
 * (no `options:` key) parses too.
 */

export const SOURCE_KINDS = [
  "postgres_jsonb",
  "memory",
  "filesystem",
  "http_api",
  "yaml_menu",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SourceKindSchema = z.enum(SOURCE_KINDS);

/** The sidebar's groups: where the rows live, as a person reads it. */
export const SOURCE_GROUPS = ["database", "files", "internet"] as const;
export type SourceGroup = (typeof SOURCE_GROUPS)[number];
export const SourceGroupSchema = z.enum(SOURCE_GROUPS);

const GROUP_OF: Record<SourceKind, SourceGroup> = {
  postgres_jsonb: "database",
  memory: "database",
  filesystem: "files",
  http_api: "internet",
  yaml_menu: "files",
};

export function sourceGroup(kind: SourceKind): SourceGroup {
  return GROUP_OF[kind];
}

// --- field paths ------------------------------------------------------------

/** One step of a field path: a key, an index `[N]` or the projection `[*]`. */
export type PathStep = { key: string } | { index: number } | { all: true };

const STEP_RE = /^([A-Za-z_$][\w$-]*)?((?:\[(?:\d+|\*)\])*)$/;

/**
 * `owner.login`, `geometry.coordinates[1]`, `authors[*].name`: dotted keys
 * with `[N]` indices and `[*]` projections, the udc-py syntax. An index may
 * open the path (`[0]`, `[5]`): the item itself is an array (OpenSky's
 * positional state vectors). `null` for a malformed path.
 */
export function parseFieldPath(path: string): PathStep[] | null {
  if (path.trim() === "") return null;
  const steps: PathStep[] = [];
  for (const part of path.split(".")) {
    const m = STEP_RE.exec(part);
    if (!m || (m[1] === undefined && m[2] === "")) return null;
    if (m[1] !== undefined) steps.push({ key: m[1] });
    for (const [, idx] of (m[2] ?? "").matchAll(/\[(\d+|\*)\]/g)) {
      steps.push(idx === "*" ? { all: true } : { index: Number(idx) });
    }
  }
  return steps;
}

function walk(cur: unknown, steps: readonly PathStep[], i: number): unknown {
  for (let at = i; at < steps.length; at++) {
    if (cur === null || cur === undefined) return null;
    const step = steps[at] as PathStep;
    if ("key" in step) {
      cur =
        typeof cur === "object" && !Array.isArray(cur)
          ? (cur as Record<string, unknown>)[step.key]
          : undefined;
    } else if ("all" in step) {
      if (!Array.isArray(cur)) return null;
      return cur.map((item) => walk(item, steps, at + 1));
    } else {
      if (!Array.isArray(cur)) return null;
      cur = cur[step.index];
    }
  }
  return cur === undefined ? null : cur;
}

/** The value at `path` in `obj`; `null` for a missing key, an index out of range or a non-array under `[N]`. */
export function getPath(obj: unknown, path: string | readonly PathStep[]): unknown {
  const steps = typeof path === "string" ? parseFieldPath(path) : path;
  return steps ? walk(obj, steps, 0) : null;
}

const FieldPathSchema = z
  .string()
  .refine((p) => parseFieldPath(p) !== null, { message: "not a field path (a.b, a[0], a[*].b)" });

// --- options per kind ---------------------------------------------------------

export const PostgresJsonbOptionsSchema = z.looseObject({
  /** The table; defaults to the collection name. */
  table: z.string().optional(),
});

export const MemoryOptionsSchema = z.looseObject({});

/** A root that climbs out of where it is written (`..` as a segment) is refused. */
const RootSchema = z
  .string()
  .min(1)
  .refine((r) => !r.split(/[\\/]+/).includes(".."), {
    message: "root must not contain a .. segment",
  });

export const FilesystemOptionsSchema = z.looseObject({
  /** Relative to the collection directory, or absolute. */
  root: RootSchema,
  follow_symlinks: z.boolean().default(false),
  /** The most entries one directory listing reads. */
  max_entries: z.number().int().min(1).max(100_000).default(5000),
});

const ENV_NAME = z.string().regex(/^[A-Z_][A-Z0-9_]*$/, "an environment variable name");

/**
 * An OAuth2 client-credentials grant: with both variables set the source
 * asks `token_url` for a bearer token and refreshes it before it expires;
 * with either unset it calls upstream without `Authorization` (anonymous).
 */
export const HttpApiAuthSchema = z.discriminatedUnion("kind", [
  z.looseObject({
    kind: z.literal("oauth2_client_credentials"),
    token_url: z.url(),
    client_id_env: ENV_NAME,
    client_secret_env: ENV_NAME,
    scope: z.string().min(1).optional(),
  }),
]);
export type HttpApiAuth = z.output<typeof HttpApiAuthSchema>;

/**
 * A sliding window over a stateless upstream: per row id, the last `size`
 * values of each of `fields` (numbers of the schema), oldest first, served
 * as `<field>_history`. An id absent for `ttl_polls` polls drops its window.
 */
export const HttpApiHistorySchema = z.looseObject({
  fields: z.array(z.string().min(1)).min(1),
  size: z.number().int().min(1).max(600).default(60),
  ttl_polls: z.number().int().min(1).max(100).default(10),
});
export type HttpApiHistory = z.output<typeof HttpApiHistorySchema>;

/** The row field a history window of `field` is served under. */
export const historyFieldName = (field: string) => `${field}_history`;

const HISTORY_NUMBER_TYPES = new Set(["integer", "decimal", "year", "rating"]);

/** What a schema says against a `history` block: every field a live number, no derived name taken by a non-json field. */
export function historyProblems(history: HttpApiHistory, schema: SchemaDoc): string[] {
  const problems: string[] = [];
  history.fields.forEach((f, i) => {
    const def = schema.fields[f];
    if (!def || def.deleted)
      problems.push(`history.fields[${i}]: ${f} is not a field of the schema`);
    else if (!HISTORY_NUMBER_TYPES.has(def.type)) {
      problems.push(`history.fields[${i}]: ${f} is ${def.type}, a history needs a number`);
    }
    const taken = schema.fields[historyFieldName(f)];
    if (taken && !taken.deleted && taken.type !== "json") {
      problems.push(
        `history.fields[${i}]: ${historyFieldName(f)} is a ${taken.type} field of the schema, the history needs it as json`,
      );
    }
  });
  return problems;
}

/**
 * The schema the server describes for a source with `history`: every
 * `<field>_history` added as a `json` field after the schema's own (one
 * schema.json already declares keeps its place).
 */
export function withHistoryFields(
  schema: SchemaDoc,
  history: HttpApiHistory | undefined,
): SchemaDoc {
  if (!history) return schema;
  const fields: Record<string, FieldDef> = { ...schema.fields };
  const order = [...schema.field_order];
  for (const f of history.fields) {
    const name = historyFieldName(f);
    const label = `Last values of ${f}, oldest first`;
    fields[name] = { description: label, ...fields[name], type: "json" } as FieldDef;
    if (!order.includes(name)) order.push(name);
  }
  return { ...schema, fields, field_order: order };
}

export const HttpApiOptionsSchema = z.looseObject({
  base_url: z.url(),
  /** Appended to `base_url`; may carry a query string. */
  list_endpoint: z.string().startsWith("/"),
  /** The item field (a path) whose value becomes `__meta.id`. */
  id_field: FieldPathSchema,
  /** Where the array sits in the response (`features`, `data.items`); absent: the response is the array. */
  list_unwrap: FieldPathSchema.optional(),
  /** Schema field → path in one item. A field without an entry reads `item[field]`. */
  field_map: z.record(z.string().min(1), FieldPathSchema).default({}),
  /** datetime / date fields whose upstream number is Unix seconds (OpenSky), not milliseconds (USGS). */
  epoch_seconds: z.array(z.string().min(1)).optional(),
  /** `${VAR}` is read from the environment; a header whose variable is unset is dropped. */
  headers: z.record(z.string().min(1), z.string()).optional(),
  timeout_ms: z.number().int().min(100).max(120_000).default(15_000),
  /** How long a fetched list is served from memory. 0 fetches every time. */
  cache_ttl_ms: z.number().int().min(0).default(60_000),
  /** The TTL while the `auth` client is active (a larger budget); `cache_ttl_ms` otherwise. */
  cache_ttl_ms_authenticated: z.number().int().min(0).optional(),
  /** An optional credential; without its variables the source runs anonymous. */
  auth: HttpApiAuthSchema.optional(),
  /** A per-row window of past values, kept across polls (the upstream keeps none). */
  history: HttpApiHistorySchema.optional(),
  /** Without every one of these set the source refuses to call upstream (`unsupported_op`). */
  env_required: z.array(ENV_NAME).optional(),
  /** The most items one fetch maps into rows. */
  max_rows: z.number().int().min(1).max(50_000).default(2000),
});

/** A file of the collection: relative to its directory, never absolute, never climbing out (`..`). */
const CollectionFileSchema = z
  .string()
  .min(1)
  .refine((f) => !/^([\\/]|[A-Za-z]:)/.test(f), {
    message: "file is relative to the collection directory, not absolute",
  })
  .refine((f) => !f.split(/[\\/]+/).includes(".."), {
    message: "file must not contain a .. segment",
  });

export const YamlMenuOptionsSchema = z.looseObject({
  /** The menu YAML, relative to the collection directory. */
  file: CollectionFileSchema,
  /** Resolve `children: "udc:…"` references against the live registry; `false` leaves them childless. */
  dynamic: z.boolean().default(true),
  /** Collection name → icon (`lucide:<name>`) of its node in a `udc:collections` branch. */
  collection_icons: z.record(z.string().min(1), z.string().min(1)).default({}),
});

export type PostgresJsonbOptions = z.output<typeof PostgresJsonbOptionsSchema>;
export type MemoryOptions = z.output<typeof MemoryOptionsSchema>;
export type FilesystemOptions = z.output<typeof FilesystemOptionsSchema>;
export type HttpApiOptions = z.output<typeof HttpApiOptionsSchema>;
export type YamlMenuOptions = z.output<typeof YamlMenuOptionsSchema>;

/** A flat file (`kind` plus the options beside it) is read as `{kind, options}`. */
function nestOptions(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || "options" in raw) return raw;
  const { kind, ...options } = raw as Record<string, unknown>;
  return { kind, options };
}

export const SourceConfigSchema = z.preprocess(
  nestOptions,
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("postgres_jsonb"),
      options: PostgresJsonbOptionsSchema.default({}),
    }),
    z.object({ kind: z.literal("memory"), options: MemoryOptionsSchema.default({}) }),
    z.object({ kind: z.literal("filesystem"), options: FilesystemOptionsSchema }),
    z.object({ kind: z.literal("http_api"), options: HttpApiOptionsSchema }),
    z.object({ kind: z.literal("yaml_menu"), options: YamlMenuOptionsSchema }),
  ]),
);

export type SourceConfigInput = z.input<typeof SourceConfigSchema>;
export type SourceConfig = z.output<typeof SourceConfigSchema>;
export type SourceConfigOf<K extends SourceKind> = Extract<SourceConfig, { kind: K }>;

export const DEFAULT_SOURCE_CONFIG: SourceConfig = { kind: "postgres_jsonb", options: {} };

/** `source.yaml` as parsed YAML → the config; `undefined` / `null` (no file, an empty file) → postgres. */
export function parseSourceConfig(raw: unknown): SourceConfig {
  if (raw === undefined || raw === null) return DEFAULT_SOURCE_CONFIG;
  return SourceConfigSchema.parse(raw);
}

/**
 * What a schema says against an http_api options block: the `history`
 * fields (see `historyProblems`) and the `epoch_seconds` fields, each a
 * live datetime or date. Empty when it fits; the registry refuses otherwise.
 */
export function httpApiProblems(opts: HttpApiOptions, schema: SchemaDoc): string[] {
  const problems = opts.history ? historyProblems(opts.history, schema) : [];
  (opts.epoch_seconds ?? []).forEach((f, i) => {
    const def = schema.fields[f];
    if (!def || def.deleted)
      problems.push(`epoch_seconds[${i}]: ${f} is not a field of the schema`);
    else if (def.type !== "datetime" && def.type !== "date") {
      problems.push(`epoch_seconds[${i}]: ${f} is ${def.type}, not a datetime or a date`);
    }
  });
  return problems;
}
