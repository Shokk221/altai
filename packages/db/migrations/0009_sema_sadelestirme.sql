-- Şema sadeleştirme. Üç iş yapıyor, hiçbiri veri kaybetmiyor.
--
-- 1) notes + warnings + watchlist -> player_records
--    Üçü de aynı şeyi modelliyordu: moderatörün oyuncuya iliştirdiği metin.
--    Üçü de BOŞTU ve hiçbiri koda bağlı değildi, o yüzden taşıma değil
--    doğrudan yeniden kurma yapıyoruz. Yine de güvenlik için satır sayısı
--    kontrol ediliyor: beklenmedik şekilde doluysa göç durur.
--
-- 2) squad_admin_groups.permissions -> squad_permissions
--    role_mappings.permissions      -> panel_permissions
--    İki farklı kavram aynı adı taşıyordu: biri Admins.cfg'ye yazılan Squad
--    erişim seviyeleri, diğeri panelin kendi izinleri. Yetki zincirini
--    okurken en çok karıştıran yer burasıydı.
--
-- 3) role_mappings mantıksal olarak access alanına taşındı (yalnızca kod
--    dosyası değişti; tabloya dokunulmuyor).

DO $$
DECLARE n bigint;
BEGIN
  SELECT (SELECT count(*) FROM notes)
       + (SELECT count(*) FROM warnings)
       + (SELECT count(*) FROM watchlist) INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'notes/warnings/watchlist bos degil (% satir) — bu goc veriyi tasimiyor, once tasima yazilmali', n;
  END IF;
END $$;
--> statement-breakpoint

DROP TABLE IF EXISTS "notes";
--> statement-breakpoint
DROP TABLE IF EXISTS "warnings";
--> statement-breakpoint
DROP TABLE IF EXISTS "watchlist";
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "player_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"server_id" uuid,
	"delivered_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"author_user_id" uuid,
	"author_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"source" text DEFAULT 'altai' NOT NULL,
	"external_id" text
);
--> statement-breakpoint
ALTER TABLE "player_records" ADD CONSTRAINT "player_records_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "player_records" ADD CONSTRAINT "player_records_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "player_records" ADD CONSTRAINT "player_records_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_records_player_idx" ON "player_records" USING btree ("player_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_records_kind_idx" ON "player_records" USING btree ("kind");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "player_records_source_external_idx" ON "player_records" USING btree ("source","external_id");
--> statement-breakpoint

-- Sütun adları: RENAME kullanıyoruz, DROP+ADD değil — squad_admin_groups'ta
-- 10 satır var ve içerikleri Admins.cfg'yi üretiyor.
ALTER TABLE "squad_admin_groups" RENAME COLUMN "permissions" TO "squad_permissions";
--> statement-breakpoint
ALTER TABLE "role_mappings" RENAME COLUMN "permissions" TO "panel_permissions";
