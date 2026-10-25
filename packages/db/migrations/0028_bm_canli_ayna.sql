CREATE TABLE IF NOT EXISTS "bm_sync_state" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"bm_player_id" text,
	"synced_at" timestamp with time zone,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"erisilemeyen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sunucular" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bm_bans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"expires_at" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"issued_by_name" text,
	"ban_list_name" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bm_sync_state" ADD CONSTRAINT "bm_sync_state_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bm_bans" ADD CONSTRAINT "bm_bans_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bm_sync_state_synced_idx" ON "bm_sync_state" USING btree ("synced_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bm_sync_state_attempted_idx" ON "bm_sync_state" USING btree ("attempted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bm_bans_player_idx" ON "bm_bans" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bm_bans_external_idx" ON "bm_bans" USING btree ("external_id");