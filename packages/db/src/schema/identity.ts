import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    steamId: text('steam_id').notNull().unique(),
    eosId: text('eos_id'),
    // BM'deki sayısal oyuncu id'si. Arşiv importu bunu doldurur ve ETL
    // tekrar çalıştırıldığında aynı oyuncuyu yeniden eklemek yerine bulur.
    // Geçiş sonrası yeni oyuncularda boş kalır.
    battlemetricsId: text('battlemetrics_id').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('players_eos_idx').on(table.eosId)],
);

/**
 * İsim geçmişi (Bölüm 4.1). BM arşivinde 111.327 oyuncunun tüm geçmiş
 * isimleri var — bir oyuncunun "6 ay önce hangi isimle oynadığı" sorusunun
 * tek kaynağı bu. Fuzzy arama için pg_trgm indeksi migration'da eklenir
 * (drizzle şemasında trigram indeksi ifade edilemiyor).
 */
export const playerNames = pgTable(
  'player_names',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    name: text('name').notNull(),
    firstSeen: timestamp('first_seen', { withTimezone: true }),
    lastSeen: timestamp('last_seen', { withTimezone: true }),
    source: text('source').notNull().default('altai'),
    // BM identifier id'si — ETL'in tekrar çalıştırılabilir olması için.
    externalId: text('external_id').unique(),
  },
  (table) => [
    index('player_names_player_idx').on(table.playerId),
    index('player_names_name_idx').on(table.name),
  ],
);

// Eski sistemin sessizce sildiği SteamID<->EOS çakışmaları burada tarihçe olarak tutulur.
export const playerIdHistory = pgTable('player_id_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id')
    .notNull()
    .references(() => players.id),
  previousEosId: text('previous_eos_id'),
  replacedAt: timestamp('replaced_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  discordId: text('discord_id').notNull().unique(),
  discordUsername: text('discord_username').notNull(),
  playerId: uuid('player_id').references(() => players.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Discord rol ID'si -> sistem rolü eşlemesi (panelden düzenlenir).
export const roleMappings = pgTable('role_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  discordRoleId: text('discord_role_id').notNull().unique(),
  systemRole: text('system_role').notNull(),
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
});

export const sessions = pgTable('auth_sessions', {
  token: text('token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  // Faz 0'da rol senkronu sadece login anında olur (Faz 3'te bot ile anlık
  // senkrona taşınacak) — bu yüzden çözümlenmiş izinler session'a yazılır,
  // her istekte tekrar Discord'a sorulmaz.
  systemRole: text('system_role').notNull(),
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  isBreakGlass: boolean('is_break_glass').notNull().default(false),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
