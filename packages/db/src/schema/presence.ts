import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { players } from './identity';

// Bölüm 4.2 "presence" alanı. Not: pg tablo adı bilinçli olarak "game_sessions" —
// identity.ts'teki auth "sessions" (pg: auth_sessions) tablosuyla karışmasın diye.
export const servers = pgTable('servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  // agent bu id'yi kullanır (config'de tanımlı, DB'de de aynı id ile durur)
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  // BM'deki sayısal sunucu id'si. Arşiv importu session/ban kayıtlarını doğru
  // sunucuya bağlamak için buna bakar; agent'ın oluşturduğu satırla import'un
  // yazdığı satır böylece aynı olur (ikisi de slug üzerinden buluşur).
  battlemetricsId: text('battlemetrics_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const gameSessions = pgTable(
  'game_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull(),
    leftAt: timestamp('left_at', { withTimezone: true }),
    // Session açılırken kaçtaydı — seed/canlı ayrımı bundan türetilir (Bölüm 5)
    playerCountAtJoin: integer('player_count_at_join'),
    // Reconciler'ın kapattığı (crash sonrası kalıntı) session'ları işaretler —
    // 4 saat üst sınırıyla kapatılır (eski backfill kuralı, Bölüm 5.5-B)
    closedByReconciler: boolean('closed_by_reconciler').notNull().default(false),
    // 'battlemetrics' = arşivden import edilen tarihsel session,
    // 'altai' = agent'ın canlı topladığı. Gölge dönemde ikisi çakışabilir;
    // doğrulama ve tekilleştirme bu kolona bakar.
    source: text('source').notNull().default('altai'),
    // BM session id'si — ETL tekrar çalıştırılabilir olsun diye.
    externalId: text('external_id'),
  },
  (table) => [
    index('game_sessions_player_idx').on(table.playerId),
    index('game_sessions_server_open_idx').on(table.serverId, table.leftAt),
    // Coplay hesabı (kim kiminle oynamış) sunucu + zaman aralığı üzerinden
    // kesişim arıyor. Bu indeks olmadan 417 bin satırda tam tarama yapıyordu.
    index('game_sessions_server_joined_idx').on(table.serverId, table.joinedAt),
    // Oyuncunun kendi oturumlarını tarih sırasıyla okumak: profil ve coplay
    // sorgusunun ilk adımı.
    index('game_sessions_player_joined_idx').on(table.playerId, table.joinedAt),
    uniqueIndex('game_sessions_source_external_idx').on(table.source, table.externalId),
  ],
);

// 60 sn'de bir yazılır (Bölüm 5: "Sunucu popülasyon geçmişi")
export const serverSnapshots = pgTable(
  'server_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id),
    playerCount: integer('player_count').notNull(),
    queueCount: integer('queue_count').notNull().default(0),
    layer: text('layer'),
    /**
     * Sunucu tick hızı. NULLABLE: değer yalnızca oyun log'undan geliyor
     * ve agent'ın log'u okuyamadığı ya da değerin bayat olduğu anlarda
     * hiç gelmiyor. 0 yazmak "sunucu donmuş" demek olurdu — bilinmiyor
     * ile donmuş arasındaki farkı korumak için null.
     */
    tickRate: doublePrecision('tick_rate'),
    takenAt: timestamp('taken_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('server_snapshots_server_time_idx').on(table.serverId, table.takenAt)],
);

// Ham event arşivi — debug/yeniden-işleme/backfill için (30-90 gün saklama, Bölüm 4.7)
export const rawEvents = pgTable(
  'raw_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('raw_events_server_type_idx').on(table.serverId, table.eventType)],
);
