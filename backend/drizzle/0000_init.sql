CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "udc_schema_revisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"collection" text NOT NULL,
	"version" integer NOT NULL,
	"schema" jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "udc_schema_revisions_collection_version_key" UNIQUE("collection","version")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "udc_schema_revisions_one_active_idx" ON "udc_schema_revisions" USING btree ("collection") WHERE active;