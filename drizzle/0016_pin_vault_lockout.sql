ALTER TABLE "e2e_vaults" ADD COLUMN "pin_fail_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "e2e_vaults" ADD COLUMN "pin_locked_until" text;
