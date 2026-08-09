import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { players, users } from './identity';
import { servers } from './presence';

// Bölüm 4.4 "moderation" alanı — BattleMetrics'in yerini alan çekirdek.
//
// İki kaynaktan beslenir ve hangisinden geldiği HER kayıtta saklanır
// (plan 5.5-A/2): 'battlemetrics' = tek seferlik arşiv importu,
// 'altai' = yeni sistemde üretilen kayıt. Kaynağı bilmek, geçiş sonrası bir
// tutarsızlık çıktığında hangi veriye güvenileceğini belirler.
export const RECORD_SOURCES = ['altai', 'battlemetrics', 'mongo'] as const;
export type RecordSource = (typeof RECORD_SOURCES)[number];

/**
 * externalId + source birlikte tekil: ETL tekrar tekrar çalıştırılabilsin.
 * Import yarıda kalırsa baştan başlatmak, aynı banları ikinci kez eklemek
 * anlamına gelmemeli.
 */

export const bans = pgTable(
  'bans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    // null = tüm sunucular (BM'deki org geneli banların karşılığı)
    serverId: uuid('server_id').references(() => servers.id),
    reason: text('reason').notNull(),
    // Sadece adminlerin gördüğü iç not (BM'de "note" alanı)
    internalNote: text('internal_note'),
    // Kanıt: link, ekran görüntüsü yolu, demo referansı
    evidence: text('evidence'),
    // null = kalıcı. Eski sistemde bu alan Türkçe tarih string'iydi
    // ("Kalıcı" dahil) ve sorgulanamıyordu (plan 5.5-B).
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    // Ban kaldırıldıysa: kayıt SİLİNMEZ, işaretlenir. Kimin ne zaman ban
    // kaldırdığı moderasyon geçmişinin parçası.
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id),
    // Banı atan: kendi sistemimizdeyse user, importsa sadece isim bilinir.
    issuedByUserId: uuid('issued_by_user_id').references(() => users.id),
    issuedByName: text('issued_by_name'),
    // Hangi BM ban listesinden geldiği — paylaşımlı listeler ayırt edilebilsin.
    banListName: text('ban_list_name'),
    source: text('source').$type<RecordSource>().notNull().default('altai'),
    externalId: text('external_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('bans_player_idx').on(table.playerId),
    // Aktif ban sorgusu (remote ban list endpoint'inin sıcak yolu)
    index('bans_active_idx').on(table.revokedAt, table.expiresAt),
    uniqueIndex('bans_source_external_idx').on(table.source, table.externalId),
  ],
);

export const flags = pgTable(
  'flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    // BM'deki gibi hex renk; panelde rozet olarak gösterilir.
    color: text('color'),
    icon: text('icon'),
    source: text('source').$type<RecordSource>().notNull().default('altai'),
    externalId: text('external_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('flags_source_external_idx').on(table.source, table.externalId)],
);

export const flagAssignments = pgTable(
  'flag_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    flagId: uuid('flag_id')
      .notNull()
      .references(() => flags.id),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
    // Kaldırılan flag silinmez, işaretlenir — "bu oyuncuda ne zaman SL ban
    // vardı" sorusu geçmişe dönük cevaplanabilmeli.
    removedAt: timestamp('removed_at', { withTimezone: true }),
    addedByUserId: uuid('added_by_user_id').references(() => users.id),
    addedByName: text('added_by_name'),
    source: text('source').$type<RecordSource>().notNull().default('altai'),
    externalId: text('external_id'),
  },
  (table) => [
    index('flag_assignments_player_idx').on(table.playerId),
    index('flag_assignments_flag_idx').on(table.flagId),
    uniqueIndex('flag_assignments_source_external_idx').on(table.source, table.externalId),
  ],
);

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    body: text('body').notNull(),
    authorUserId: uuid('author_user_id').references(() => users.id),
    authorName: text('author_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    source: text('source').$type<RecordSource>().notNull().default('altai'),
    externalId: text('external_id'),
  },
  (table) => [
    index('notes_player_idx').on(table.playerId),
    uniqueIndex('notes_source_external_idx').on(table.source, table.externalId),
  ],
);

export const warnings = pgTable(
  'warnings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    serverId: uuid('server_id').references(() => servers.id),
    reason: text('reason').notNull(),
    issuedByUserId: uuid('issued_by_user_id').references(() => users.id),
    // Oyun içinde oyuncuya gösterildi mi (RCON warn gitti mi)
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('warnings_player_idx').on(table.playerId)],
);

export const watchlist = pgTable(
  'watchlist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    reason: text('reason').notNull(),
    addedByUserId: uuid('added_by_user_id').references(() => users.id),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (table) => [index('watchlist_player_idx').on(table.playerId)],
);

// Faz 6'da admin cam takibi bunu doldurur; şema şimdiden duruyor ki vendored
// SquadJS'in admin-cam süre kurtarma mantığı bağlanacak yeri bulsun.
export const adminCamLogs = pgTable(
  'admin_cam_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable: eski sistemin admin cam kayıtları hangi sunucu olduğunu
    // tutmuyor. Yeni kayıtlarda agent doldurur.
    serverId: uuid('server_id').references(() => servers.id),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    enteredAt: timestamp('entered_at', { withTimezone: true }).notNull(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (table) => [
    index('admin_cam_logs_player_idx').on(table.playerId, table.enteredAt),
    // Tekillik ŞART. Bu tabloda (source, external_id) yok — kayıtlar iki
    // Mongo satırının (POSSESSED/UNPOSSESSED) eşleştirilmesiyle üretiliyor,
    // yani tek bir kaynak kimliği yok. Kısıt olmayınca aktarımın
    // `onConflictDoNothing`i hiçbir şeye çarpmıyordu ve ikinci koşu tüm
    // kayıtları ikiledi: 2.812 gerçek oturum 5.624 satır olmuştu.
    // Bir oyuncu aynı anda iki kez admin cam'e giremez, dolayısıyla
    // (player_id, entered_at) doğal anahtar.
    uniqueIndex('admin_cam_logs_player_entered_idx').on(table.playerId, table.enteredAt),
  ],
);

/**
 * Her moderasyon işlemi buraya yazılır — ban, flag, not, uyarı, kick.
 * Eski sistemin en büyük eksiklerinden biri buydu: bir ban kaldırıldığında
 * kimin kaldırdığı hiçbir yerde durmuyordu.
 */
export const moderationAudit = pgTable(
  'moderation_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    // 'ban.create', 'ban.revoke', 'flag.assign', 'note.edit', ...
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    // Değişikliğin öncesi/sonrası; şemaya bağlanamayacak kadar değişken.
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('moderation_audit_actor_idx').on(table.actorUserId, table.createdAt),
    index('moderation_audit_target_idx').on(table.targetType, table.targetId),
  ],
);
