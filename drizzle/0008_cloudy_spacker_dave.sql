ALTER TABLE "messages" ADD COLUMN "sender_pub" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "recipient_pub" text DEFAULT '' NOT NULL;