CREATE TABLE IF NOT EXISTS "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"actor_label" text,
	"action" text NOT NULL,
	"category" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"target_label" text,
	"method" text,
	"path" text,
	"route" text,
	"status_code" integer,
	"duration_ms" integer,
	"ip" "inet",
	"user_agent" text,
	"payload" jsonb,
	"request_id" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_at_idx" ON "activity_log" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_actor_idx" ON "activity_log" USING btree ("actor_user_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_target_idx" ON "activity_log" USING btree ("target_type","target_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_category_idx" ON "activity_log" USING btree ("category","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_action_idx" ON "activity_log" USING btree ("action","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_request_idx" ON "activity_log" USING btree ("request_id");