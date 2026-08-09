CREATE TABLE IF NOT EXISTS "round_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"player_id" uuid,
	"steam_id" text,
	"eos_id" text,
	"name" text,
	"team_id" smallint,
	"squad_id" smallint,
	"role" text,
	"is_leader" boolean,
	"kills" integer DEFAULT 0 NOT NULL,
	"deaths" integer DEFAULT 0 NOT NULL,
	"revives" integer DEFAULT 0 NOT NULL,
	"teamkills" integer DEFAULT 0 NOT NULL,
	"killstreak" integer,
	"damage_dealt" integer,
	"damage_taken" integer,
	"is_winner" boolean,
	"weapons" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid,
	"server_name" text,
	"map" text,
	"layer" text,
	"level" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"player_count" integer,
	"team1_name" text,
	"team1_faction" text,
	"team1_tickets" integer,
	"team2_name" text,
	"team2_faction" text,
	"team2_tickets" integer,
	"winner_team" smallint,
	"total_kills" integer,
	"total_revives" integer,
	"total_teamkills" integer,
	"source" text DEFAULT 'altai' NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "round_players" ADD CONSTRAINT "round_players_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "round_players" ADD CONSTRAINT "round_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rounds" ADD CONSTRAINT "rounds_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "round_players_round_idx" ON "round_players" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "round_players_player_idx" ON "round_players" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "round_players_round_steam_idx" ON "round_players" USING btree ("round_id","steam_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rounds_started_idx" ON "rounds" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rounds_server_started_idx" ON "rounds" USING btree ("server_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rounds_source_external_idx" ON "rounds" USING btree ("source","external_id");