CREATE TABLE "login_pins" (
	"pin_hash" text PRIMARY KEY NOT NULL,
	"identity_id" integer NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_pins" ADD CONSTRAINT "login_pins_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;