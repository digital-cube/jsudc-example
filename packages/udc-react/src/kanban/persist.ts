import { type FilterNode, type Row, UdcError } from "@jsudc/core";
import type { UdcClient } from "@jsudc/core/client";
import type { UdcMutateVars } from "../udc/hooks";
import { type DropPlan, orderOf, replanDrop } from "./model";

const SCOPE_LIMIT = 1000;

export interface PersistOrderArgs {
  client: UdcClient;
  collection: string;
  orderField: string;
  /** The rows the order is relative to (one bucket, or one board's buckets). */
  scope: Record<string, string>;
  plan: DropPlan;
  /** The moved row's version as the cache has it. */
  version: number | undefined;
  /** Fields the update writes besides the order (the new bucket). */
  patch: Record<string, unknown>;
  mutate: (vars: UdcMutateVars) => Promise<unknown>;
  /** The order the row is drawn at changed (after a reindex). */
  onOrder?: (order: number) => void;
}

/**
 * Write a dropped row's new order. When its neighbours left no room, the
 * scope is renumbered (`reindex`), the neighbours are read again and the
 * move is tried once more with their new orders; a second collision gives
 * up. Answers whether a reindex ran (the caller's lists are then stale).
 */
export async function persistOrder(args: PersistOrderArgs): Promise<{ reindexed: boolean }> {
  const { client, collection, orderField, scope } = args;
  let plan = args.plan;
  let version = args.version;
  let reindexed = false;

  if (plan.collision) {
    await client.reindex({ collection, scope, order_field: orderField });
    reindexed = true;
    const filter: FilterNode = {
      and: Object.entries(scope).map(([field, value]) => ({ field, op: "eq" as const, value })),
    };
    const fresh = await client.list({
      collection,
      filter,
      sort: [{ field: orderField }],
      page: { limit: SCOPE_LIMIT },
    });
    const orders = new Map(fresh.rows.map((r: Row) => [r.__meta.id, orderOf(r, orderField)]));
    plan = replanDrop(plan, orders);
    if (plan.collision) {
      throw new UdcError("internal", "no room between the neighbours, even after a reindex");
    }
    // A reindex bumps the version of every row it renumbered, the moved one included when in scope.
    const moved = fresh.rows.find((r) => r.__meta.id === plan.id);
    version = moved
      ? moved.__meta.version
      : (await client.read(collection, plan.id)).row.__meta.version;
    args.onOrder?.(plan.order);
  }

  await args.mutate({
    op: "update",
    id: plan.id,
    row: { ...args.patch, [orderField]: plan.order },
    ...(version === undefined ? {} : { expected_version: version }),
  });
  return { reindexed };
}
