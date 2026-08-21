CREATE TABLE IF NOT EXISTS "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"discord_message_id" text NOT NULL,
	"author_discord_id" text NOT NULL,
	"author_name" text,
	"body" text DEFAULT '' NOT NULL,
	"attachments" jsonb,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer NOT NULL,
	"category" text,
	"subject" text NOT NULL,
	"opened_by_discord_id" text NOT NULL,
	"opened_by_player_id" uuid,
	"discord_guild_id" text NOT NULL,
	"discord_thread_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"claimed_by_discord_id" text,
	"claimed_at" timestamp with time zone,
	"closed_by_discord_id" text,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_opened_by_player_id_players_id_fk" FOREIGN KEY ("opened_by_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_messages_ticket_idx" ON "ticket_messages" USING btree ("ticket_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_messages_discord_idx" ON "ticket_messages" USING btree ("discord_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tickets_number_idx" ON "tickets" USING btree ("discord_guild_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tickets_thread_idx" ON "tickets" USING btree ("discord_thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_status_idx" ON "tickets" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_opener_idx" ON "tickets" USING btree ("opened_by_player_id");