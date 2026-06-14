-- Invitations à un événement (RSVP). L'événement reste celui de l'organisateur
-- (jointure virtuelle, pas de copie) ; l'invité le voit en lecture seule dans son
-- agenda une fois `accepted`. ON DELETE cascade : les invitations disparaissent si
-- l'événement ou l'une des deux identités est supprimé.
CREATE TABLE "event_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"inviter_id" integer NOT NULL,
	"invitee_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" text NOT NULL,
	"responded_at" text,
	CONSTRAINT "uq_event_invite" UNIQUE("event_id","invitee_id")
);--> statement-breakpoint
ALTER TABLE "event_invites" ADD CONSTRAINT "event_invites_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_invites" ADD CONSTRAINT "event_invites_inviter_id_identities_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_invites" ADD CONSTRAINT "event_invites_invitee_id_identities_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_event_invites_invitee" ON "event_invites" USING btree ("invitee_id","status");--> statement-breakpoint
CREATE INDEX "idx_event_invites_event" ON "event_invites" USING btree ("event_id");
