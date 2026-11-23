import type { CollectionAsset, Source } from "@jsudc/server";
import { makeSource } from "@jsudc/server/postgres";
import { mailSource } from "./mail/sources.js";

export type ExampleSourceDeps = Parameters<typeof makeSource>[1];

/**
 * The source of each collection: the mailbox collections are registered in
 * code (a `from` with a join, computed fields, an `onMutate`), every other
 * one is what its `source.yaml` says, through the library's `makeSource`.
 */
export function exampleSource(asset: CollectionAsset, deps: ExampleSourceDeps): Source | null {
  return (deps.db ? mailSource(asset, deps.db) : undefined) ?? makeSource(asset, deps);
}
