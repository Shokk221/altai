ALTER TABLE "servers" ADD COLUMN "battlemetrics_id" text;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_battlemetrics_id_unique" UNIQUE("battlemetrics_id");