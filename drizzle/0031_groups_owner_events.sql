-- Groupes : owner unique distinct des admins + audit léger des changements.
-- Modèle final (cf. docs/groups-proposal.md §0) :
--   - owner : créateur, peut promouvoir/rétrograder des admins, transférer la propriété ;
--   - admins : ajoutent/retirent membres ;
--   - members : envoient et quittent uniquement.
-- group_events stocke les actions de membership (créa, ajout, retrait, départ, rotation
-- de rôle, transfert) pour l'affichage de bandeaux système dans la conversation.

ALTER TABLE "groups" ADD COLUMN "owner_id" integer;--> statement-breakpoint
UPDATE "groups" g SET "owner_id" = (SELECT gm."identity_id" FROM "group_members" gm WHERE gm."group_id" = g."id" AND gm."role" = 'admin' ORDER BY gm."joined_at" ASC LIMIT 1) WHERE g."owner_id" IS NULL;--> statement-breakpoint
UPDATE "groups" g SET "owner_id" = (SELECT gm."identity_id" FROM "group_members" gm WHERE gm."group_id" = g."id" ORDER BY gm."joined_at" ASC LIMIT 1) WHERE g."owner_id" IS NULL;--> statement-breakpoint
UPDATE "group_members" gm SET "role" = 'owner' WHERE EXISTS (SELECT 1 FROM "groups" g WHERE g."id" = gm."group_id" AND g."owner_id" = gm."identity_id");--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_owner_id_identities_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "group_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"kind" text NOT NULL,
	"actor_id" integer NOT NULL,
	"target_id" integer,
	"payload" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL
);--> statement-breakpoint
ALTER TABLE "group_events" ADD CONSTRAINT "group_events_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_group_events_group" ON "group_events" USING btree ("group_id","created_at");
