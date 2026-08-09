CREATE TABLE IF NOT EXISTS "discord_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_id" text NOT NULL,
	"player_id" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlinked_at" timestamp with time zone,
	"source" text DEFAULT 'altai' NOT NULL,
	"external_id" text,
	CONSTRAINT "discord_links_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"group_name" text NOT NULL,
	"server_id" uuid,
	"comment" text,
	"origin" text DEFAULT 'manual' NOT NULL,
	"discord_role_id" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by_user_id" uuid,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"source" text DEFAULT 'altai' NOT NULL,
	"external_id" text
);
--> statement-breakpoint
ALTER TABLE "admin_cam_logs" ALTER COLUMN "server_id" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discord_links" ADD CONSTRAINT "discord_links_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grants" ADD CONSTRAINT "grants_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grants" ADD CONSTRAINT "grants_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grants" ADD CONSTRAINT "grants_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discord_links_player_idx" ON "discord_links" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discord_links_source_external_idx" ON "discord_links" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grants_player_idx" ON "grants" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grants_active_idx" ON "grants" USING btree ("revoked_at","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "grants_source_external_idx" ON "grants" USING btree ("source","external_id");