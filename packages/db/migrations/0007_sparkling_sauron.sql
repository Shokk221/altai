-- Aktarım iki kez koştuğu için admin_cam_logs ikilenmişti: 2.812 gerçek
-- oturum 5.624 satır olarak duruyordu. Tekillik kısıtı olmadığı için
-- `onConflictDoNothing` hiçbir şeye çarpmıyordu.
--
-- Önce kopyaları siliyoruz (her (player_id, entered_at) için en eski
-- fiziksel satır kalır), sonra tekrarını kalıcı olarak engelliyoruz.
-- Sıra önemli: kopyalar dururken UNIQUE index oluşturulamaz.
DELETE FROM "admin_cam_logs" a
      USING "admin_cam_logs" b
      WHERE a.ctid > b.ctid
        AND a.player_id = b.player_id
        AND a.entered_at = b.entered_at;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_cam_logs_player_entered_idx" ON "admin_cam_logs" USING btree ("player_id","entered_at");
