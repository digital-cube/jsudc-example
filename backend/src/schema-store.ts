import { type SchemaDoc, SchemaDocSchema, UdcError } from "@jsudc/udc-core";
import { and, eq } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { udcSchemaRevisions } from "./db/schema.js";

/** The integer revision in the table is `"v<n>"` on the wire. */
export const wireVersion = (version: number) => `v${version}`;

/** The active schema revision of a collection, in its wire form; `null` when none is active. */
export async function activeSchema(db: Db, collection: string): Promise<SchemaDoc | null> {
  const [rev] = await db
    .select({ version: udcSchemaRevisions.version, schema: udcSchemaRevisions.schema })
    .from(udcSchemaRevisions)
    .where(and(eq(udcSchemaRevisions.collection, collection), eq(udcSchemaRevisions.active, true)))
    .limit(1);
  if (!rev) return null;
  const parsed = SchemaDocSchema.safeParse({ ...rev.schema, version: wireVersion(rev.version) });
  if (!parsed.success) {
    throw new Error(
      `active schema revision ${rev.version} of ${collection} is invalid: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

/** Phase 1 keeps every field in `data`: a schema with core fields cannot be served. */
export function assertJsonbSchema(schema: Pick<SchemaDoc, "core_fields">, where: string): void {
  if (schema.core_fields.length > 0) {
    throw new UdcError(
      "unsupported_op",
      `${where}: core_fields must be empty, the jsonb source stores every field in data ` +
        `(got ${schema.core_fields.join(", ")})`,
      { core_fields: schema.core_fields },
    );
  }
}
