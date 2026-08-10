-- Sohbet geçmişi.
--
-- Mesajlar şimdiye kadar yalnızca raw_events içinde ham JSON olarak
-- duruyordu: kaydediliyor ama aranamıyor, oyuncuya bağlanamıyor, profilde
-- gösterilemiyordu. "Bu adam ne dedi" moderasyonun en sık sorduğu soru.
CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid,
	"player_id" uuid,
	"steam_id" text,
	"eos_id" text,
	"name" text,
	"channel" text,
	"message" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'altai' NOT NULL,
	"external_id" text
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_player_idx" ON "chat_messages" USING btree ("player_id","sent_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_server_idx" ON "chat_messages" USING btree ("server_id","sent_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_messages_source_external_idx" ON "chat_messages" USING btree ("source","external_id");
--> statement-breakpoint
-- Mesaj içinde arama ("küfür geçen mesajlar", "şu ismi anan kim"). pg_trgm
-- eklentisi 0000'da kuruldu. Drizzle şemasında trigram indeksi ifade
-- edilemiyor, o yüzden burada.
CREATE INDEX IF NOT EXISTS "chat_messages_trgm_idx" ON "chat_messages" USING gin ("message" gin_trgm_ops);
