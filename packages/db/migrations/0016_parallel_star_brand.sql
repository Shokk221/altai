CREATE TABLE IF NOT EXISTS "config_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_name" text NOT NULL,
	"server_id" uuid,
	"action" text NOT NULL,
	"onceki" jsonb,
	"sonraki" jsonb,
	"actor_user_id" uuid,
	"actor_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_name" text NOT NULL,
	"server_id" uuid,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "config_audit" ADD CONSTRAINT "config_audit_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "config_audit" ADD CONSTRAINT "config_audit_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plugin_configs" ADD CONSTRAINT "plugin_configs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plugin_configs" ADD CONSTRAINT "plugin_configs_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "config_audit_plugin_idx" ON "config_audit" USING btree ("plugin_name","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_configs_name_server_idx" ON "plugin_configs" USING btree ("plugin_name","server_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_configs_server_idx" ON "plugin_configs" USING btree ("server_id");