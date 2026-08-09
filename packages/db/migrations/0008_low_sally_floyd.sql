-- player_names birleştirme.
--
-- Sorun: tekillik BM'nin kayıt kimliğine (external_id) bağlanmıştı. BM aynı
-- ismi farklı kayıt kimlikleriyle defalarca bildirdiği için 4.064 isim 9.852
-- satıra bölünmüştü ve her satır o ismin farklı bir görülme anını taşıyordu.
-- Ayrıca first_seen 859.956 satırın 857.961'inde boştu — sütun ölü duruyordu.
--
-- Çözüm: (player_id, name) başına TEK satır; first_seen = o ismin en erken,
-- last_seen = en geç görülme anı. Hiçbir bilgi kaybolmuyor, aralığa dönüşüyor.
-- Tek görülmüş isimlerde first_seen = last_seen olur: elimizdeki veri
-- gerçekten "bu ismi yalnızca o an gördük" diyor.

-- 1) Önce hayatta kalacak satırların aralığını yaz. Silmeden önce yapıyoruz;
--    grubun tüm satırları aynı değeri alır, sonra hangisi kalırsa kalsın doğru.
UPDATE "player_names" n
   SET first_seen = g.fs,
       last_seen  = g.ls
  FROM (
        SELECT player_id,
               name,
               min(coalesce(first_seen, last_seen)) AS fs,
               max(coalesce(last_seen, first_seen)) AS ls
          FROM "player_names"
         GROUP BY player_id, name
       ) g
 WHERE n.player_id = g.player_id
   AND n.name = g.name;
--> statement-breakpoint

-- 2) Fazlalıkları sil (her grupta en eski fiziksel satır kalır).
DELETE FROM "player_names" a
      USING "player_names" b
      WHERE a.ctid > b.ctid
        AND a.player_id = b.player_id
        AND a.name = b.name;
--> statement-breakpoint

-- 3) Tekrarını kalıcı olarak engelle. Sıra önemli: kopyalar dururken
--    UNIQUE index oluşturulamaz.
CREATE UNIQUE INDEX IF NOT EXISTS "player_names_player_name_idx" ON "player_names" USING btree ("player_id","name");
