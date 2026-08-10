import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { players } from './identity';
import { servers } from './presence';

/**
 * Sohbet geçmişi.
 *
 * Moderasyonun en çok kullanılan aracı: "bu adam ne dedi" sorusu ban
 * kararlarının çoğunda soruluyor. Başlangıçta mesajlar yalnızca
 * `raw_events` içinde ham JSON olarak duruyordu — yani kaydediliyor ama
 * aranamıyor, oyuncuya bağlanamıyor, profilde gösterilemiyordu.
 *
 * `player_id` NULLABLE: mesajı atan oyuncu players tablosunda henüz
 * olmayabilir (eski Mongo kayıtlarında kimliği hiç bulunmayanlar var).
 * Kaydı düşürmek yerine ham kimliği saklıyoruz; oyuncu sonradan oluşursa
 * geriye dönük bağlanabiliyor. Aynı yaklaşım round_players'ta da var.
 *
 * `name` mesaj anındaki isim: oyuncu sonradan isim değiştirse de sohbet
 * kaydı o günkü hâliyle okunmalı.
 */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id').references(() => servers.id),
    playerId: uuid('player_id').references(() => players.id),
    steamId: text('steam_id'),
    eosId: text('eos_id'),
    name: text('name'),
    /** All | Team | Squad | Admin — Squad'ın kanal adları. */
    channel: text('channel'),
    message: text('message').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    source: text('source').notNull().default('altai'),
    externalId: text('external_id'),
  },
  (table) => [
    // Profildeki "bu oyuncunun son mesajları" sorgusunun sıcak yolu.
    index('chat_messages_player_idx').on(table.playerId, table.sentAt),
    index('chat_messages_server_idx').on(table.serverId, table.sentAt),
    // Aktarımlar tekrar çalıştırılabilsin.
    uniqueIndex('chat_messages_source_external_idx').on(table.source, table.externalId),
  ],
);
