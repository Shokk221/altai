CREATE TABLE IF NOT EXISTS "team_change_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"player_id" uuid,
	"steam_id" text NOT NULL,
	"player_name" text,
	"from_team" text,
	"requested_by_user_id" uuid,
	"requested_by_name" text,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"result" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_change_queue" ADD CONSTRAINT "team_change_queue_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_change_queue" ADD CONSTRAINT "team_change_queue_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_change_queue" ADD CONSTRAINT "team_change_queue_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_change_queue_bekleyen_idx" ON "team_change_queue" USING btree ("server_id","settled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_change_queue_player_idx" ON "team_change_queue" USING btree ("player_id","created_at");