import { type FilterNode, FilterNodeSchema, type SortKey } from "@jsudc/core";
import type { PagingMode } from "../udc/keys";

/*
 * The data view's address-bar state. Every codec is total: a hand-edited or
 * truncated URL decodes to "nothing set", never to an exception.
 */

export const PARAM = {
  tab: "tab",
  search: "q",
  chips: "cf",
  filter: "f",
  sort: "sort",
  mode: "mode",
  page: "p",
} as const;

export function utf8ToBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToUtf8(b64u: string): string | null {
  try {
    const padding = "=".repeat((4 - (b64u.length % 4)) % 4);
    const bin = atob(b64u.replace(/-/g, "+").replace(/_/g, "/") + padding);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function decodeJson(raw: string | null | undefined): unknown {
  if (!raw) return undefined;
  const json = base64UrlToUtf8(raw);
  if (json === null) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

// ?f= -----------------------------------------------------------------------

/** base64url of the node's JSON: the udc-js encoding, so links work in both. */
export function encodeFilterParam(tree: FilterNode | null | undefined): string | null {
  return tree ? utf8ToBase64Url(JSON.stringify(tree)) : null;
}

export function decodeFilterParam(raw: string | null | undefined): FilterNode | null {
  const parsed = FilterNodeSchema.safeParse(decodeJson(raw));
  return parsed.success ? parsed.data : null;
}

// ?cf= ----------------------------------------------------------------------

/** One chip's value; its shape follows the chip's `kind`. */
export type ChipValue =
  | { kind: "select"; values: string[] }
  | { kind: "range"; min: number | null; max: number | null }
  | { kind: "bool"; value: boolean };

/** Chip values keyed by field. An unset chip has no key. */
export type ChipState = Record<string, ChipValue>;

export function isEmptyChip(v: ChipValue | undefined): boolean {
  if (!v) return true;
  if (v.kind === "select") return v.values.length === 0;
  if (v.kind === "range") return v.min === null && v.max === null;
  return false;
}

const finiteOrNull = (v: unknown): number | null | undefined =>
  v === null ? null : typeof v === "number" && Number.isFinite(v) ? v : undefined;

function parseChip(v: unknown): ChipValue | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "select" && Array.isArray(o.values)) {
    const values = o.values.filter((x): x is string => typeof x === "string");
    return values.length ? { kind: "select", values } : null;
  }
  if (o.kind === "range") {
    const min = finiteOrNull(o.min ?? null);
    const max = finiteOrNull(o.max ?? null);
    if (min === undefined || max === undefined || (min === null && max === null)) return null;
    return { kind: "range", min, max };
  }
  if (o.kind === "bool" && typeof o.value === "boolean") return { kind: "bool", value: o.value };
  return null;
}

/** base64url JSON of the non-empty chips; `null` when none is set. */
export function encodeChipParam(state: ChipState): string | null {
  const set = Object.fromEntries(Object.entries(state).filter(([, v]) => !isEmptyChip(v)));
  return Object.keys(set).length ? utf8ToBase64Url(JSON.stringify(set)) : null;
}

export function decodeChipParam(raw: string | null | undefined): ChipState {
  const obj = decodeJson(raw);
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out: ChipState = {};
  for (const [field, v] of Object.entries(obj)) {
    const chip = parseChip(v);
    if (chip) out[field] = chip;
  }
  return out;
}

// ?sort= --------------------------------------------------------------------

/** `employees:desc,name:asc` */
export function encodeSortParam(sort: readonly SortKey[]): string | null {
  return sort.length ? sort.map((k) => `${k.field}:${k.dir ?? "asc"}`).join(",") : null;
}

export function decodeSortParam(raw: string | null | undefined): SortKey[] {
  if (!raw) return [];
  const out: SortKey[] = [];
  for (const part of raw.split(",")) {
    const [field, dir = "asc"] = part.split(":");
    if (!field || (dir !== "asc" && dir !== "desc")) continue;
    if (out.some((k) => k.field === field)) continue;
    out.push({ field, dir });
  }
  return out;
}

/**
 * A header click: asc → desc → none. Without `multi` the clicked field
 * becomes the only sort key; with it (shift-click) the others stay.
 */
export function cycleSort(sort: readonly SortKey[], field: string, multi = false): SortKey[] {
  const current = sort.find((k) => k.field === field);
  const next: SortKey | null = !current
    ? { field, dir: "asc" }
    : (current.dir ?? "asc") === "asc"
      ? { field, dir: "desc" }
      : null;
  if (!multi) return next ? [next] : [];
  const others = sort.filter((k) => k.field !== field);
  if (!next) return others;
  return current ? sort.map((k) => (k.field === field ? next : k)) : [...others, next];
}

// ?mode= ?p= ----------------------------------------------------------------

export function decodeModeParam(raw: string | null | undefined): PagingMode | null {
  return raw === "pages" || raw === "infinite" ? raw : null;
}

export function decodePageParam(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
