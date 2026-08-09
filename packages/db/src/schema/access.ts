import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { players, users } from './identity';
import { servers } from './presence';

/**
 * Yetki/grant modeli — plan Bölüm 6.6 "Tek 'yetki/grant' modeli + revoked_at
 * tarihçesi".
 *
 * Eski sistemde bu bilgi AdminEntry'de duruyordu ve iki sorunu vardı:
 *  1. Süresi dolan kayıt HARD-DELETE ediliyordu; "kimde ne zaman whitelist
 *     vardı" sorusunun cevabı yoktu. Burada kayıt silinmez, revoked_at ile
 *     işaretlenir.
 *  2. `id` alanı bazen SteamID bazen EOS tutuyordu (gerçek veride 456 Steam,
 *     90 EOS). Burada oyuncuya UUID ile bağlanıyor, format sorunu ETL'de
 *     bir kez çözülüyor.
 *
 * Grant'in KAYNAĞI iki türlü olabilir ve ikisi de destekleniyor:
 *  - 'discord_role': Discord rolünden türetilir (planın tek yetki zinciri).
 *    Rol kalkınca grant de düşer.
 *  - 'manual': doğrudan oyuncuya verilir. Mevcut 550 whitelist kaydının
 *    çoğu böyle — Discord bağı olan sadece 97 kişi var, yani hepsini rol
 *    zincirine bağlamak bugünkü veriyle mümkün değil.
 */
export const GRANT_ORIGINS = ['discord_role', 'manual'] as const;
export type GrantOrigin = (typeof GRANT_ORIGINS)[number];

export const grants = pgTable(
  'grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    // Admins.cfg'deki grup adı: SuperAdmin, Admin, KlanWL, VeteranWL, BagisWL...
    // Serbest metin bilinçli: gruplar panelden yönetilecek, enum'a hapsetmiyoruz.
    groupName: text('group_name').notNull(),
    // null = tüm sunucular
    serverId: uuid('server_id').references(() => servers.id),
    comment: text('comment'),
    origin: text('origin').$type<GrantOrigin>().notNull().default('manual'),
    // origin='discord_role' ise hangi rolden geldiği
    discordRoleId: text('discord_role_id'),
    grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id),
    // Süre dolumu SİLME değil işaretleme: tarihçe korunur.
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    source: text('source').notNull().default('altai'),
    externalId: text('external_id'),
  },
  (table) => [
    index('grants_player_idx').on(table.playerId),
    // Admin listesi ucunun sıcak yolu: aktif grantlar.
    index('grants_active_idx').on(table.revokedAt, table.expiresAt),
    uniqueIndex('grants_source_external_idx').on(table.source, table.externalId),
  ],
);

/**
 * Discord hesabı <-> oyun hesabı bağı.
 *
 * users tablosundan ayrı: panele hiç girmemiş biri de hesabını bağlamış
 * olabilir (eski sistemde bot üzerinden bağlanıyordu). users bir WEB hesabı,
 * bu ise bir KİMLİK eşlemesi.
 *
 * Oyun içi yetki bu bağa dayanıyor (plan Bölüm 8): Discord rolü -> sistem
 * rolü -> Admins.cfg üretimi, aradaki köprü burası.
 */
export const discordLinks = pgTable(
  'discord_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    discordId: text('discord_id').notNull().unique(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow().notNull(),
    unlinkedAt: timestamp('unlinked_at', { withTimezone: true }),
    source: text('source').notNull().default('altai'),
    externalId: text('external_id'),
  },
  (table) => [
    index('discord_links_player_idx').on(table.playerId),
    uniqueIndex('discord_links_source_external_idx').on(table.source, table.externalId),
  ],
);
