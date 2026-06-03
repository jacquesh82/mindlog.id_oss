CREATE TABLE "e2e_one_time_prekeys" (
	"id" serial PRIMARY KEY NOT NULL,
	"identity_id" integer NOT NULL,
	"opk_id" integer NOT NULL,
	"opk_pub" text NOT NULL,
	"consumed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "e2e_prekeys" (
	"identity_id" integer PRIMARY KEY NOT NULL,
	"spk_pub" text NOT NULL,
	"spk_id" integer NOT NULL,
	"spk_sig" text DEFAULT '' NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "e2e_one_time_prekeys" ADD CONSTRAINT "e2e_one_time_prekeys_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e2e_prekeys" ADD CONSTRAINT "e2e_prekeys_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_opk_identity" ON "e2e_one_time_prekeys" USING btree ("identity_id","consumed");