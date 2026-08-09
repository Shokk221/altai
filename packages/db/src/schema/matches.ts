import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { players } from './identity';
import { servers } from './presence';

/**
 * Maç (round) kaydı — plan Faz 1 "PersistenceWriter (player/session/snapshot/
 * round/raw_events)" ve Faz 4 (istatistik/leaderboard) temeli.
 *
 * Bu tablolar önce GEÇMİŞ veriyi karşılamak için doğdu: eski sistemin
 * Mongo'sundaki `roundscoreboards` koleksiyonu 20 Şubat 2026'dan bugüne
 * 2.304 maçı oyuncu kırılımıyla tutuyor. Agent ileriye dönük aynı yapıya
 * yazacak, böylece geçmiş ve yeni veri tek şemada birleşiyor.
 *
 * `aarrounds` koleksiyonu bilinçli olarak alınmadı: 418 kayıt, oyuncu
 * kırılımı yok ve zaman aralığı skorbordların içinde kalıyor — aynı maçları
 * ikinci bir kaynaktan çoğaltmanın faydası yok.
 */
export const rounds = pgTable(
  'rounds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // null = hangi sunucu olduğu çözülemedi (eski kayıtlarda sunucu adı
    // serbest metin; yeniden adlandırmalar yüzünden hepsi eşleşmiyor).
    serverId: uuid('server_id').references(() => servers.id),
    // Eşleşmeyen kayıtlarda ham sunucu adını saklıyoruz ki sonradan
    // elle bağlanabilsin.
    serverName: text('server_name'),

    map: text('map'),
    layer: text('layer'),
    level: text('level'),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),
    playerCount: integer('player_count'),

    team1Name: text('team1_name'),
    team1Faction: text('team1_faction'),
    team1Tickets: integer('team1_tickets'),
    team2Name: text('team2_name'),
    team2Faction: text('team2_faction'),
    team2Tickets: integer('team2_tickets'),
    /** 1 veya 2; belirlenemiyorsa null. */
    winnerTeam: smallint('winner_team'),

    totalKills: integer('total_kills'),
    totalRevives: integer('total_revives'),
    totalTeamkills: integer('total_teamkills'),

    source: text('source').notNull().default('altai'),
    externalId: text('external_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    startedIdx: index('rounds_started_idx').on(t.startedAt),
    serverIdx: index('rounds_server_started_idx').on(t.serverId, t.startedAt),
    // Aktarımın tekrar çalıştırılabilir olması buna dayanıyor.
    sourceExternalIdx: uniqueIndex('rounds_source_external_idx').on(t.source, t.externalId),
  }),
);

/**
 * Maç başına oyuncu satırı.
 *
 * `playerId` BİLEREK nullable: skorbordda görünen bazı oyuncular henüz
 * players tablosunda olmayabilir (BM arşivi o oyuncuyu hiç görmemiş olabilir).
 * Kaydı düşürmek yerine ham steam/eos kimliğini saklıyoruz; oyuncu sonradan
 * oluştuğunda geriye dönük bağlanabilir. Kimliği atmak veriyi kalıcı
 * kaybetmek olurdu.
 */
export const roundPlayers = pgTable(
  'round_players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roundId: uuid('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id').references(() => players.id),
    steamId: text('steam_id'),
    eosId: text('eos_id'),
    /** Maç sırasındaki isim — oyuncu sonradan isim değiştirse de maç kaydı sabit kalır. */
    name: text('name'),

    teamId: smallint('team_id'),
    squadId: smallint('squad_id'),
    role: text('role'),
    isLeader: boolean('is_leader'),

    kills: integer('kills').notNull().default(0),
    deaths: integer('deaths').notNull().default(0),
    revives: integer('revives').notNull().default(0),
    teamkills: integer('teamkills').notNull().default(0),
    killstreak: integer('killstreak'),
    damageDealt: integer('damage_dealt'),
    damageTaken: integer('damage_taken'),
    isWinner: boolean('is_winner'),
    /** Silah adı -> öldürme sayısı. Faz 4 silah istatistikleri için. */
    weapons: jsonb('weapons'),
  },
  (t) => ({
    roundIdx: index('round_players_round_idx').on(t.roundId),
    playerIdx: index('round_players_player_idx').on(t.playerId),
    // Kimlik bazlı tekillik: aktarım iki kez koşarsa satır ikilenmesin.
    // steam_id null olan satırlar bu kısıttan muaf (Postgres'te null'lar
    // birbirine eşit sayılmaz) — o kayıtlar zaten oyuncuya bağlanamıyor.
    roundSteamIdx: uniqueIndex('round_players_round_steam_idx').on(t.roundId, t.steamId),
  }),
);
