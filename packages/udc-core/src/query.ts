import { z } from "zod";

export const SORT_DIRS = ["asc", "desc"] as const;
export type SortDir = (typeof SORT_DIRS)[number];

export const SortKeySchema = z.object({
  field: z.string().min(1),
  dir: z.enum(SORT_DIRS).optional(),
});

/** `dir` defaults to `asc`. */
export type SortKey = z.infer<typeof SortKeySchema>;

export const MAX_PAGE_LIMIT = 1000;

export const PageRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(MAX_PAGE_LIMIT).optional(),
    cursor: z.string().nullable().optional(),
    offset: z.number().int().min(0).optional(),
  })
  .refine((p) => p.cursor == null || p.offset === undefined, {
    message: "cursor and offset are mutually exclusive",
    path: ["offset"],
  });

export type PageRequest = z.infer<typeof PageRequestSchema>;
