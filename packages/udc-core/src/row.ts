import { z } from "zod";

// Loose: udc-py also sends `actions`, `status`, `state` on the meta block.
export const RowMetaSchema = z.looseObject({
  id: z.string(),
  version: z.number().int(),
});

export type RowMeta = { id: string; version: number } & Record<string, unknown>;

export const RowSchema = z.looseObject({ __meta: RowMetaSchema });

/** Flat: every stored field sits at the top level next to `__meta`. */
export type Row = { __meta: RowMeta } & Record<string, unknown>;
