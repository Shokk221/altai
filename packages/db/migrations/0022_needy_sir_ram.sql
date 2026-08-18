ALTER TABLE "raw_events" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "raw_events_seq_idx" ON "raw_events" USING btree ("seq");