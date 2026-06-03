CREATE TABLE "attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair" text NOT NULL,
	"sender_id" integer NOT NULL,
	"file" text DEFAULT '' NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"expires_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_sender_id_identities_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_attachments_pair" ON "attachments" USING btree ("pair");