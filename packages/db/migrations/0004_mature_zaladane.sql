CREATE TABLE IF NOT EXISTS "discord_member_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_id" text NOT NULL,
	"discord_role_id" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "squad_admin_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"permissions" text DEFAULT '' NOT NULL,
	"server_id" uuid,
	"source" text DEFAULT 'altai' NOT NULL,
	"external_id" text
);
--> statement-breakpoint
ALTER TABLE "role_mappings" ADD COLUMN "squad_group" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "squad_admin_groups" ADD CONSTRAINT "squad_admin_groups_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discord_member_roles_unique" ON "discord_member_roles" USING btree ("discord_id","discord_role_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discord_member_roles_role_idx" ON "discord_member_roles" USING btree ("discord_role_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "squad_admin_groups_name_server_idx" ON "squad_admin_groups" USING btree ("name","server_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "squad_admin_groups_source_external_idx" ON "squad_admin_groups" USING btree ("source","external_id");