import { index, inet, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * Sistem günlüğü — "kim ne yaptı" sorusunun tek adresi.
 *
 * `moderation_audit` zaten vardı ama yalnızca moderasyon eylemlerini ve
 * yalnızca rota kodu açıkça yazdığında tutuyordu. Yani panele kim girdi, kim
 * kimin profiline baktı, agent ne zaman koptu, ban zorlayıcı kimi attı —
 * hiçbiri kayıtlı değildi. Bu tablo o boşluğu kapatıyor: HTTP katmanındaki
 * genel kanca her isteği buraya yazıyor, süreç içi olaylar da aynı yere
 * düşüyor.
 *
 * moderation_audit KALDIRILMADI. İkisi farklı soruların cevabı:
 *   activity_log     -> "ne oldu" (her şey, hacimli, süresi dolunca budanır)
 *   moderation_audit -> "bu ban kimin kararı" (az, kalıcı, eylemle aynı tx)
 * Moderasyon eylemleri her ikisine de yazılıyor; bağ `request_id` üzerinden.
 *
 * Aktör alanları ÜÇ parça hâlinde:
 *   actor_type   makine mi insan mı — filtrelemenin ilk kırılımı
 *   actor_user_id kullanıcı tablosuna bağ (yalnızca panel kullanıcıları için)
 *   actor_label  o ANDAKİ görünen ad. Denormal bilinçli: kullanıcı Discord
 *                adını değiştirse ya da kaydı silinse bile günlük okunabilir
 *                kalmalı — denetim kaydının bütün değeri bu.
 */

/** Kaydı üretenin cinsi. */
export const ACTOR_TYPES = [
  /** Panele giriş yapmış insan. */
  'user',
  /** Oturumsuz istek — başarısız giriş denemeleri buraya düşer. */
  'anonymous',
  /** Oyun sunucusundaki agent (WS uplink). */
  'agent',
  /** Squad sunucusunun kendisi: ban/admin listesi çekişleri. */
  'game_server',
  /** Zamanlayıcı, açılış/kapanış, ban zorlayıcı gibi süreç içi işler. */
  'system',
] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/**
 * Kaba kırılım — ekranda sekme, sorguda indeks işi görüyor.
 * Eylem adı (`action`) serbest metin; kategori onun sabit üst kümesi.
 */
export const ACTIVITY_CATEGORIES = [
  /** Giriş, çıkış, oturum düşmesi, yetki reddi. */
  'oturum',
  /** Ban, uyarı, kick, not, flag — oyuncuya dokunan her şey. */
  'moderasyon',
  /** Rol eşlemesi, yetki değişikliği, admin listesi yönetimi. */
  'erisim',
  /** Panelde veri okuma: arama, profil görüntüleme, sohbet okuma. */
  'okuma',
  /** Agent bağlantısı, servis açılış/kapanışı, liste çekişleri. */
  'sistem',
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const activityLog = pgTable(
  'activity_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),

    actorType: text('actor_type').$type<ActorType>().notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorLabel: text('actor_label'),

    /** 'auth.login', 'ban.create', 'http.request', 'agent.disconnect'... */
    action: text('action').notNull(),
    category: text('category').$type<ActivityCategory>().notNull(),

    /** Eylemin dokunduğu şey; oyuncu profilindeki "bu adama ne yapıldı" için. */
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    /** UUID'si olmayan hedefler (slug, SteamID, Discord rol id'si). */
    targetLabel: text('target_label'),

    // --- HTTP bağlamı (süreç içi olaylarda null) ---
    method: text('method'),
    /** Maskelenmiş yol — ban/admin listesi token'ları yola gömülü geliyor. */
    path: text('path'),
    /** Fastify rota kalıbı ('/api/players/:id'): grupla saymayı mümkün kılar. */
    route: text('route'),
    statusCode: integer('status_code'),
    durationMs: integer('duration_ms'),

    ip: inet('ip'),
    userAgent: text('user_agent'),

    /**
     * Girdinin maskelenmiş özeti. Şemaya bağlanamayacak kadar değişken;
     * parola/token gibi alanlar yazıcı tarafında ayıklanıyor.
     */
    payload: jsonb('payload'),

    /**
     * Aynı isteğin ürettiği satırları birbirine bağlar: bir POST'un genel
     * http kaydı ile o istekte yazılan moderasyon kaydı aynı id'yi taşır.
     */
    requestId: text('request_id'),
  },
  (table) => [
    // Ana ekran: en yeniden eskiye akış.
    index('activity_log_at_idx').on(table.at.desc()),
    // "Bu yetkili ne yaptı" — hesap sorulurken ilk bakılan.
    index('activity_log_actor_idx').on(table.actorUserId, table.at.desc()),
    // "Bu oyuncuya ne yapıldı" — profil sayfasının sıcak yolu.
    index('activity_log_target_idx').on(table.targetType, table.targetId, table.at.desc()),
    // Sekme filtresi ve eylem bazlı sayımlar.
    index('activity_log_category_idx').on(table.category, table.at.desc()),
    index('activity_log_action_idx').on(table.action, table.at.desc()),
    index('activity_log_request_idx').on(table.requestId),
  ],
);
