CREATE TABLE "card_fields" (
	"identity_id" integer NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"is_custom" integer DEFAULT 0 NOT NULL,
	"is_public" integer DEFAULT 1 NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "card_fields_identity_id_key_pk" PRIMARY KEY("identity_id","key")
);
--> statement-breakpoint
CREATE TABLE "day_overrides" (
	"identity_id" integer NOT NULL,
	"day" text NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "day_overrides_identity_id_day_pk" PRIMARY KEY("identity_id","day")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"identity_id" integer NOT NULL,
	"title" text NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text,
	"location" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"is_public" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gallery" (
	"id" serial PRIMARY KEY NOT NULL,
	"identity_id" integer NOT NULL,
	"filename" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gallery_likes" (
	"photo_id" integer NOT NULL,
	"fingerprint" text NOT NULL,
	CONSTRAINT "gallery_likes_photo_id_fingerprint_pk" PRIMARY KEY("photo_id","fingerprint")
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"access_key" text NOT NULL,
	"photo_file" text,
	"recovery_email" text DEFAULT '' NOT NULL,
	"pubkey" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "identities_handle_unique" UNIQUE("handle"),
	CONSTRAINT "identities_access_key_unique" UNIQUE("access_key")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair" text NOT NULL,
	"sender_id" integer NOT NULL,
	"iv" text NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"read" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"identity_id" integer NOT NULL,
	"type" text NOT NULL,
	"text" text NOT NULL,
	"link" text,
	"read" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_id" integer NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_type" text DEFAULT 'singleDevice' NOT NULL,
	"backed_up" integer DEFAULT 0 NOT NULL,
	"transports" text DEFAULT '[]' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"message_id" integer NOT NULL,
	"identity_id" integer NOT NULL,
	"emoji" text NOT NULL,
	CONSTRAINT "reactions_message_id_identity_id_emoji_pk" PRIMARY KEY("message_id","identity_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "relations" (
	"identity_id" integer NOT NULL,
	"related_id" integer NOT NULL,
	"type" text DEFAULT 'amis' NOT NULL,
	"created_at" text DEFAULT '' NOT NULL,
	CONSTRAINT "relations_identity_id_related_id_pk" PRIMARY KEY("identity_id","related_id"),
	CONSTRAINT "relations_no_self" CHECK ("relations"."identity_id" <> "relations"."related_id")
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"identity_id" integer NOT NULL,
	"day" text,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"identity_id" integer NOT NULL,
	"created_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"last_seen" text NOT NULL,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "card_fields" ADD CONSTRAINT "card_fields_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_overrides" ADD CONSTRAINT "day_overrides_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery" ADD CONSTRAINT "gallery_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_likes" ADD CONSTRAINT "gallery_likes_photo_id_gallery_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."gallery"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_identities_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_related_id_identities_id_fk" FOREIGN KEY ("related_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_events_identity" ON "events" USING btree ("identity_id","starts_at");--> statement-breakpoint
CREATE INDEX "idx_gallery_identity" ON "gallery" USING btree ("identity_id","position");--> statement-breakpoint
CREATE INDEX "idx_messages_pair" ON "messages" USING btree ("pair","created_at");--> statement-breakpoint
CREATE INDEX "idx_notif_identity" ON "notifications" USING btree ("identity_id","read","created_at");--> statement-breakpoint
CREATE INDEX "idx_passkey_identity" ON "passkey_credentials" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "idx_relations_related" ON "relations" USING btree ("related_id");--> statement-breakpoint
CREATE INDEX "idx_requests_identity" ON "requests" USING btree ("identity_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_identity" ON "sessions" USING btree ("identity_id");