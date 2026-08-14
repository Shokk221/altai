CREATE TABLE IF NOT EXISTS "seed_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"seed_reason" text NOT NULL,
	"was_admin" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'altai' NOT NULL,
	"external_id" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "seed_sessions" ADD CONSTRAINT "seed_sessions_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "seed_sessions" ADD CONSTRAINT "seed_sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seed_sessions_player_started_idx" ON "seed_sessions" USING btree ("player_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seed_sessions_server_started_idx" ON "seed_sessions" USING btree ("server_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "seed_sessions_source_external_idx" ON "seed_sessions" USING btree ("source","external_id");