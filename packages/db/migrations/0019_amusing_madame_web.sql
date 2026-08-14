CREATE TABLE IF NOT EXISTS "steam_profiles" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"level" integer,
	"private" boolean DEFAULT false NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "steam_profiles" ADD CONSTRAINT "steam_profiles_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "steam_profiles_checked_idx" ON "steam_profiles" USING btree ("checked_at");