import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CollectionDocs,
  calendarOptionsProblems,
  FIELD_NAME_RE,
  LOCALES_WITH_DOCS,
  mapOptionsProblems,
  type SchemaDoc,
  type SchemaDocInput,
  SchemaDocSchema,
  type SourceConfig,
  SourceConfigSchema,
  treeOptionsProblems,
  UdcError,
  type ViewConfig,
  ViewConfigSchema,
} from "@jsudc/udc-core";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { assertJsonbSchema } from "./schema-store.js";
import type { Source } from "./sources/source.js";

export interface Collection {
  name: string;
  label?: string | undefined;
  source: Source;
  view: ViewConfig;
  /** The README per locale, served in `describe.docs`. */
  docs?: CollectionDocs | undefined;
}

/** `name → {source, view}` for every collection the server serves. */
export class CollectionRegistry {
  private readonly byName = new Map<string, Collection>();

  register(collection: Collection): void {
    if (this.byName.has(collection.name)) {
      throw new Error(`collection ${collection.name} is registered twice`);
    }
    this.byName.set(collection.name, collection);
  }

  get(name: string): Collection {
    const found = this.byName.get(name);
    if (!found)
      throw new UdcError("not_found", `unknown collection: ${name}`, { collection: name });
    return found;
  }

  list(): Collection[] {
    return [...this.byName.values()];
  }
}

/** One `collections/<name>/` directory, parsed and validated. */
export interface CollectionAsset {
  name: string;
  dir: string;
  view: ViewConfig;
  /** The initial schema; served until the collection has an active revision. */
  schema: SchemaDoc;
  /** `schema.json` exactly as on disk. */
  schemaJson: SchemaDocInput;
  /** `seed.json`, when the collection ships one. */
  seedFile: string | null;
  /** `source.yaml`, validated; `{kind: postgres_jsonb}` without one. */
  source: SourceConfig;
  /** `README.md` (en) and `README.<locale>.md`, when present. */
  docs?: CollectionDocs | undefined;
}

function readFile(file: string, parse: (text: string) => unknown): unknown {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(`${file}: cannot read (${(err as Error).message})`);
  }
  try {
    return parse(text);
  } catch (err) {
    throw new Error(`${file}: cannot parse (${(err as Error).message})`);
  }
}

function validated<S extends z.ZodType>(file: string, schema: S, value: unknown): z.output<S> {
  const res = schema.safeParse(value);
  if (!res.success) throw new Error(`${file}: invalid\n${z.prettifyError(res.error)}`);
  return res.data;
}

/** `README.md` as `en`, `README.<locale>.md` as the others; `undefined` when the directory has none. */
function readDocs(base: string): CollectionDocs | undefined {
  const docs: CollectionDocs = {};
  for (const locale of LOCALES_WITH_DOCS) {
    const file = join(base, locale === "en" ? "README.md" : `README.${locale}.md`);
    if (existsSync(file)) docs[locale] = readFileSync(file, "utf8");
  }
  return Object.keys(docs).length > 0 ? docs : undefined;
}

/**
 * Read every `<dir>/<name>/` collection: `view.yaml` through `ViewConfigSchema`,
 * `schema.json` through `SchemaDocSchema`, `source.yaml` (optional) through
 * `SourceConfigSchema`, and the READMEs. Fails fast, naming the file, on
 * anything that would not serve: a bad view, a bad schema or source, core
 * fields in a jsonb collection, or a directory name that cannot be a table name.
 */
export function readCollectionAssets(dir: string): CollectionAsset[] {
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  return names.map((name) => {
    const base = join(dir, name);
    if (!FIELD_NAME_RE.test(name)) {
      throw new Error(`${base}: collection name must be lowercase snake_case (it names the table)`);
    }
    const viewFile = join(base, "view.yaml");
    const schemaFile = join(base, "schema.json");
    const view = validated(
      viewFile,
      ViewConfigSchema,
      readFile(viewFile, (t) => parseYaml(t) ?? {}),
    );
    const schemaJson = readFile(schemaFile, JSON.parse) as SchemaDocInput;
    const schema = validated(schemaFile, SchemaDocSchema, schemaJson);
    const sourceFile = join(base, "source.yaml");
    const source: SourceConfig = existsSync(sourceFile)
      ? validated(
          sourceFile,
          SourceConfigSchema,
          readFile(sourceFile, (t) => parseYaml(t) ?? { kind: "postgres_jsonb" }),
        )
      : { kind: "postgres_jsonb", options: {} };
    if (source.kind === "postgres_jsonb") assertJsonbSchema(schema, schemaFile);
    // A calendar over a field that is not a datetime would draw nothing, a tree or a map
    // over a field the schema lacks nothing sensible: refuse any of them at load.
    const blocks = [
      [
        "calendar_options",
        view.calendar_options && calendarOptionsProblems(view.calendar_options, schema),
      ],
      ["tree_options", view.tree_options && treeOptionsProblems(view.tree_options, schema)],
      ["map_options", view.map_options && mapOptionsProblems(view.map_options, schema)],
    ] as const;
    for (const [block, problems] of blocks) {
      if (problems && problems.length > 0) {
        throw new Error(`${viewFile}: ${block} do not fit schema.json\n${problems.join("\n")}`);
      }
    }
    const seedFile = join(base, "seed.json");
    return {
      name,
      dir: base,
      view,
      schema,
      schemaJson,
      seedFile: existsSync(seedFile) ? seedFile : null,
      source,
      docs: readDocs(base),
    };
  });
}

/**
 * The registry the server starts with: every collection under `dir`, its
 * source made by `makeSource`. A collection for which `makeSource` answers
 * `null` is not served (an http_api one with `UDC_HTTP_SOURCES=off`).
 */
export function loadRegistry(
  dir: string,
  makeSource: (asset: CollectionAsset) => Source | null,
): CollectionRegistry {
  const registry = new CollectionRegistry();
  for (const asset of readCollectionAssets(dir)) {
    const source = makeSource(asset);
    if (!source) continue;
    registry.register({
      name: asset.name,
      source,
      view: asset.view,
      docs: asset.docs,
    });
  }
  return registry;
}
