CREATE TABLE IF NOT EXISTS "clan_war_roster" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"war_id" uuid NOT NULL,
	"clan_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clan_war_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"war_id" uuid NOT NULL,
	"clan_id" uuid NOT NULL,
	"side" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clan_wars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"status" text DEFAULT 'planned' NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clan_war_roster" ADD CONSTRAINT "clan_war_roster_war_id_clan_wars_id_fk" FOREIGN KEY ("war_id") REFERENCES "public"."clan_wars"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clan_war_roster" ADD CONSTRAINT "clan_war_roster_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clan_war_roster" ADD CONSTRAINT "clan_war_roster_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clan_war_teams" ADD CONSTRAINT "clan_war_teams_war_id_clan_wars_id_fk" FOREIGN KEY ("war_id") REFERENCES "public"."clan_wars"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clan_war_teams" ADD CONSTRAINT "clan_war_teams_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clan_wars" ADD CONSTRAINT "clan_wars_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clan_war_roster_unique" ON "clan_war_roster" USING btree ("war_id","player_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clan_war_roster_war_idx" ON "clan_war_roster" USING btree ("war_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clan_war_teams_unique" ON "clan_war_teams" USING btree ("war_id","clan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clan_war_teams_war_idx" ON "clan_war_teams" USING btree ("war_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clan_wars_server_idx" ON "clan_wars" USING btree ("server_id","scheduled_at");