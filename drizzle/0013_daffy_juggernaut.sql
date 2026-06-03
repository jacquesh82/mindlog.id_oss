CREATE TABLE "invites" (
	"token" text PRIMARY KEY NOT NULL,
	"from_id" integer NOT NULL,
	"type" text DEFAULT 'amis' NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"expires_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_from_id_identities_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;