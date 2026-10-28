import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  calendarOptionsProblems,
  FIELD_NAME_RE,
  type SchemaDoc,
  type SchemaDocInput,
  SchemaDocSchema,
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

/**
 * Read every `<dir>/<name>/` collection: `view.yaml` through `ViewConfigSchema`,
 * `schema.json` through `SchemaDocSchema`. Fails fast, naming the file, on
 * anything that would not serve: a bad view, a bad schema, core fields, or a
 * directory name that cannot be a table name.
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
    assertJsonbSchema(schema, schemaFile);
    // A calendar over a field that is not a datetime would draw nothing, a tree over a
    // field the schema lacks nothing sensible: refuse either at load.
    const blocks = [
      [
        "calendar_options",
        view.calendar_options && calendarOptionsProblems(view.calendar_options, schema),
      ],
      ["tree_options", view.tree_options && treeOptionsProblems(view.tree_options, schema)],
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
    };
  });
}

/** The registry the server starts with: every collection under `dir`, its source made by `makeSource`. */
export function loadRegistry(
  dir: string,
  makeSource: (asset: CollectionAsset) => Source,
): CollectionRegistry {
  const registry = new CollectionRegistry();
  for (const asset of readCollectionAssets(dir)) {
    registry.register({ name: asset.name, source: makeSource(asset), view: asset.view });
  }
  return registry;
}
