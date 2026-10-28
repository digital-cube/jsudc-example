import { z } from "zod";
import { type SchemaDoc, SchemaDocSchema } from "./schema.js";
import { type SourceGroup, SourceGroupSchema } from "./source.js";

/*
 * The `yaml_menu` source: a nested YAML menu served as flat tree rows. The
 * file format (`MenuFileSchema`), the rows it becomes (`MENU_SCHEMA`) and the
 * grammar of a branch whose children are not written but resolved
 * (`children: "udc:collections?group=database"`).
 */

/**
 * The row of a menu node. Fixed: a yaml_menu collection needs no
 * `schema.json`, and one that ships it must say exactly this.
 */
export const MENU_SCHEMA: SchemaDoc = SchemaDocSchema.parse({
  version: "v1",
  core_fields: ["code"],
  fields: {
    code: { type: "string", length: 64 },
    translation_key: { type: "string", length: 128 },
    icon: { type: "string", length: 64 },
    url: { type: "string", length: 512 },
    parent_id: { type: "string", length: 40 },
    order: { type: "integer" },
    depth: { type: "integer" },
    ancestor_ids: { type: "json" },
    children_count: { type: "integer" },
    is_dynamic: { type: "bool" },
  },
});

/** Where `schema` disagrees with `MENU_SCHEMA` (a field missing, extra or of another type); empty when it agrees. */
export function menuSchemaProblems(schema: SchemaDoc): string[] {
  const problems: string[] = [];
  for (const [name, def] of Object.entries(MENU_SCHEMA.fields)) {
    const got = schema.fields[name];
    if (!got || got.deleted) problems.push(`${name}: missing (a menu row has it)`);
    else if (got.type !== def.type)
      problems.push(`${name}: is ${got.type}, a menu row has ${def.type}`);
  }
  for (const name of Object.keys(schema.fields)) {
    if (!(name in MENU_SCHEMA.fields)) problems.push(`${name}: not a field of a menu row`);
  }
  return problems;
}

// --- the dynamic reference ------------------------------------------------------

/**
 * A branch resolved at read time. `udc:collections[?group=…]` is the
 * server's own collection registry; `api:<path>` (udc-py's HTTP self-call)
 * parses so the refusal can say what it is, and is refused by `parseMenuRef`.
 */
export type MenuRef =
  | { scheme: "udc"; target: "collections"; group?: SourceGroup }
  | { scheme: "api"; path: string };

const UDC_REF_RE = /^udc:([a-z_]+)(?:\?(.*))?$/;

function grammar(text: string): MenuRef | string {
  if (text.startsWith("api:")) {
    const path = text.slice("api:".length);
    return path.startsWith("/") ? { scheme: "api", path } : "api: needs a path starting with /";
  }
  const m = UDC_REF_RE.exec(text);
  if (!m) return `not a menu reference: ${JSON.stringify(text)} (udc:collections[?group=…])`;
  if (m[1] !== "collections") return `unknown udc: target ${m[1]} (udc:collections)`;
  if (m[2] === undefined) return { scheme: "udc", target: "collections" };
  const params = m[2] === "" ? [] : m[2].split("&").map((kv) => kv.split("="));
  const [key, value] = params[0] ?? [];
  if (params.length !== 1 || key !== "group") {
    return `udc:collections takes one parameter, group (got ${m[2] || "an empty query"})`;
  }
  const group = SourceGroupSchema.safeParse(value);
  if (!group.success) {
    return `group must be one of ${SourceGroupSchema.options.join(", ")} (got ${value ?? ""})`;
  }
  return { scheme: "udc", target: "collections", group: group.data };
}

/** The reference grammar: a string → `MenuRef`, any other string is an issue. */
export const MenuRefSchema = z.string().transform((text, ctx): MenuRef => {
  const ref = grammar(text.trim());
  if (typeof ref === "string") {
    ctx.addIssue({ code: "custom", message: ref });
    return z.NEVER;
  }
  return ref;
});

/** A reference jsudc resolves: `udc:`. Throws on garbage and on `api:` (not served by jsudc). */
export function parseMenuRef(text: string): Extract<MenuRef, { scheme: "udc" }> {
  const res = MenuRefSchema.safeParse(text);
  if (!res.success) throw new Error(res.error.issues.map((i) => i.message).join("; "));
  if (res.data.scheme === "api") {
    throw new Error(
      `api: references (${text}) are not supported by jsudc: the server resolves its own ` +
        "branches, write udc:collections[?group=database|files|internet] instead",
    );
  }
  return res.data;
}

// --- the file -------------------------------------------------------------------

export interface MenuNode {
  code: string;
  translation_key?: string | undefined;
  icon?: string | undefined;
  url?: string | undefined;
  children?: MenuNode[] | string | undefined;
}

const CODE_RE = /^[A-Za-z0-9_.-]+$/;

/** One node. Its id is the path of codes from the root, so a code has no `/` and is unique among its siblings. */
export const MenuNodeSchema: z.ZodType<MenuNode> = z.lazy(() =>
  z.looseObject({
    code: z.string().regex(CODE_RE, "a code is letters, digits, _ . - (it names the node's path)"),
    translation_key: z.string().min(1).optional(),
    icon: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    children: z.union([MenuLevelSchema, z.string().min(1)]).optional(),
  }),
);

const MenuLevelSchema: z.ZodType<MenuNode[]> = z.lazy(() =>
  z.array(MenuNodeSchema).superRefine((nodes, ctx) => {
    const seen = new Set<string>();
    nodes.forEach((n, i) => {
      if (seen.has(n.code)) {
        ctx.addIssue({ code: "custom", path: [i, "code"], message: `duplicate code ${n.code}` });
      }
      seen.add(n.code);
    });
  }),
);

/** The whole file: the root level (an empty file is an empty menu). */
export const MenuFileSchema = z.preprocess((v) => v ?? [], MenuLevelSchema);
