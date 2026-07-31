import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  steamId: text('steam_id').notNull().unique(),
  eosId: text('eos_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

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
