import { collectionTable } from "@jsudc/server";

// The library's own table: listed here so drizzle-kit keeps it in the snapshot instead of dropping it.
export { udcSchemaRevisions } from "@jsudc/server";

// The demo collections: one jsonb table each, the shape the library reads.
export const companies = collectionTable("companies");
export const boards = collectionTable("boards");
export const buckets = collectionTable("buckets");
export const tickets = collectionTable("tickets");
export const appointments = collectionTable("appointments");
export const comments = collectionTable("comments");
export const org = collectionTable("org");
export const metrics = collectionTable("metrics");
