CREATE TABLE "tags" (
	"identity_id" integer NOT NULL,
	"tag" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tags_identity_id_tag_pk" PRIMARY KEY("identity_id","tag")
);
--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;