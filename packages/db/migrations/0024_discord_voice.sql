CREATE TABLE IF NOT EXISTS "discord_voice_states" (
	"discord_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"channel_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discord_voice_sync" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discord_voice_states_channel_idx" ON "discord_voice_states" USING btree ("channel_id");