ALTER TABLE "flag_assignments" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "flag_assignments" ADD COLUMN "reason" text;