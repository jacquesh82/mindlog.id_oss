CREATE TABLE "e2e_vaults" (
	"identity_id" integer PRIMARY KEY NOT NULL,
	"vault" text DEFAULT '' NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "e2e_vaults" ADD CONSTRAINT "e2e_vaults_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;