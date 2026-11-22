CREATE TABLE "mail_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"message_id" uuid NOT NULL,
	"op" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'custom' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"folder_id" uuid NOT NULL,
	"sender_name" text NOT NULL,
	"sender_email" text NOT NULL,
	"subject" text NOT NULL,
	"preview" text NOT NULL,
	"body" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen" boolean DEFAULT false NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_folder_id_mail_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."mail_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_audit_owner_message_idx" ON "mail_audit" USING btree ("owner","message_id");--> statement-breakpoint
CREATE INDEX "mail_folders_owner_idx" ON "mail_folders" USING btree ("owner","position");--> statement-breakpoint
CREATE INDEX "mail_messages_owner_folder_received_idx" ON "mail_messages" USING btree ("owner","folder_id","received_at");--> statement-breakpoint
CREATE INDEX "mail_messages_folder_seen_idx" ON "mail_messages" USING btree ("folder_id","seen");