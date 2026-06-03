CREATE TABLE "group_members" (
	"group_id" text NOT NULL,
	"identity_id" integer NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" text NOT NULL,
	CONSTRAINT "group_members_group_id_identity_id_pk" PRIMARY KEY("group_id","identity_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_group_members_identity" ON "group_members" USING btree ("identity_id");