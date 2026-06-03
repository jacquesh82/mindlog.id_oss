CREATE TABLE "device_one_time_prekeys" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_pk" integer NOT NULL,
	"opk_id" integer NOT NULL,
	"opk_pub" text NOT NULL,
	"consumed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_prekeys" (
	"device_pk" integer PRIMARY KEY NOT NULL,
	"spk_pub" text NOT NULL,
	"spk_id" integer NOT NULL,
	"spk_sig" text DEFAULT '' NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"identity_id" integer NOT NULL,
	"device_id" text NOT NULL,
	"e2e_pubkey" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"approved" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"last_seen" text,
	"revoked_at" text,
	CONSTRAINT "uq_devices_identity_device" UNIQUE("identity_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "message_envelopes" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"recipient_device_pk" integer NOT NULL,
	"iv" text NOT NULL,
	"ciphertext" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sender_device_pk" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "client_msg_id" text;--> statement-breakpoint
ALTER TABLE "device_one_time_prekeys" ADD CONSTRAINT "device_one_time_prekeys_device_pk_devices_id_fk" FOREIGN KEY ("device_pk") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_prekeys" ADD CONSTRAINT "device_prekeys_device_pk_devices_id_fk" FOREIGN KEY ("device_pk") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_envelopes" ADD CONSTRAINT "message_envelopes_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_envelopes" ADD CONSTRAINT "message_envelopes_recipient_device_pk_devices_id_fk" FOREIGN KEY ("recipient_device_pk") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_device_pk_devices_id_fk" FOREIGN KEY ("sender_device_pk") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_device_opk" ON "device_one_time_prekeys" USING btree ("device_pk","consumed");--> statement-breakpoint
CREATE INDEX "idx_devices_identity" ON "devices" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "idx_envelope_message" ON "message_envelopes" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_envelope_recipient" ON "message_envelopes" USING btree ("recipient_device_pk");--> statement-breakpoint
CREATE INDEX "idx_messages_client_msg" ON "messages" USING btree ("client_msg_id");
