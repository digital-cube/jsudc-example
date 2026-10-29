import { type Condition, type FilterNode, isCondition } from "@jsudc/core";

/*
 * Folder navigation keeps the open folder as one `path eq <folder>`
 * condition of the URL filter tree (`?f=`), next to whatever else the user
 * filtered by. These split it off for the breadcrumb and the filter pills
 * and put it back; the root is no condition at all.
 */

const isFolderCond = (n: FilterNode, field: string): n is Condition =>
  isCondition(n) && n.field === field && n.op === "eq" && typeof n.value === "string";

/** The open folder (`null`: the root) and the tree without its condition. */
export function splitFolder(
  tree: FilterNode | null,
  field: string,
): { folder: string | null; rest: FilterNode | null } {
  if (!tree) return { folder: null, rest: null };
  if (isFolderCond(tree, field)) return { folder: tree.value as string, rest: null };
  if (!("and" in tree)) return { folder: null, rest: tree };
  const cond = tree.and.find((n) => isFolderCond(n, field)) as Condition | undefined;
  if (!cond) return { folder: null, rest: tree };
  const others = tree.and.filter((n) => n !== cond);
  const rest =
    others.length === 0 ? null : others.length === 1 ? (others[0] ?? null) : { and: others };
  return { folder: cond.value as string, rest };
}

/** `rest` with the folder condition first; `""` or `null` (the root) adds none. */
export function joinFolder(
  rest: FilterNode | null,
  field: string,
  folder: string | null,
): FilterNode | null {
  if (!folder) return rest;
  const cond: Condition = { field, op: "eq", value: folder };
  if (!rest) return cond;
  if ("and" in rest) return { and: [cond, ...rest.and] };
  return { and: [cond, rest] };
}

/** `docs/archive` → `[{name: docs, path: docs}, {name: archive, path: docs/archive}]`. */
export function folderCrumbs(folder: string | null): { name: string; path: string }[] {
  const parts = (folder ?? "").split("/").filter(Boolean);
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join("/") }));
}
