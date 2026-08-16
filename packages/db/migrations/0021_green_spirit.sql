CREATE TABLE IF NOT EXISTS "clan_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clan_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tag" text,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clan_members" ADD CONSTRAINT "clan_members_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clan_members" ADD CONSTRAINT "clan_members_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clan_members_clan_idx" ON "clan_members" USING btree ("clan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clan_members_player_idx" ON "clan_members" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clan_members_aktif_idx" ON "clan_members" USING btree ("clan_id","player_id") WHERE "clan_members"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clans_name_idx" ON "clans" USING btree ("name");