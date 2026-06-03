CREATE TABLE "e2e_verifications" (
	"identity_id" integer NOT NULL,
	"peer_id" integer NOT NULL,
	"safety_hash" text NOT NULL,
	"verified_at" text NOT NULL,
	CONSTRAINT "e2e_verifications_identity_id_peer_id_pk" PRIMARY KEY("identity_id","peer_id")
);
--> statement-breakpoint
ALTER TABLE "e2e_verifications" ADD CONSTRAINT "e2e_verifications_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e2e_verifications" ADD CONSTRAINT "e2e_verifications_peer_id_identities_id_fk" FOREIGN KEY ("peer_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;