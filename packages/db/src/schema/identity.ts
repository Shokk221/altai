import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Oyuncu kimliği. steam_id VEYA eos_id dolu olmalı — ikisi de zorunlu değil.
 *
 * Başta steam_id notNull idi. Gerçek veri bunun yanlış olduğunu gösterdi:
 * Squad oyuncuyu artık EOS ID ile tanıyor (sunucunun kendi Bans.cfg'si EOS
 * yazıyor) ve arşivde SteamID'si olmayıp EOS'u olan 1.205 oyuncu ile 43 ban
 * var. notNull kısıtı bunların hepsini dışarıda bırakıyordu — üstelik ban
 * listemiz zaten EOS satırı ürettiği için o banlar uygulanabilir durumda.
 *
 * En az bir kimlik şartı migration'daki CHECK ile zorlanıyor (Drizzle şemada
 * ifade edemiyor).
 */
export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    steamId: text('steam_id').unique(),
    eosId: text('eos_id').unique(),
    // BM'deki sayısal oyuncu id'si. Arşiv importu bunu doldurur ve ETL
    // tekrar çalıştırıldığında aynı oyuncuyu yeniden eklemek yerine bulur.
    // Geçiş sonrası yeni oyuncularda boş kalır.
    battlemetricsId: text('battlemetrics_id').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // eos_id artık unique — ayrı index gereksiz.
  () => [],
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
    // Kaynağın kayıt kimliği — yalnızca izlenebilirlik için. Tekillik
    // ANAHTARI DEĞİL: BM aynı ismi farklı kayıt kimlikleriyle defalarca
    // bildiriyor ve bu alan üzerinden tekilleştirmek 4.064 ismi 9.852 satıra
    // bölmüştü. Gerçek anahtar (player_id, name).
    externalId: text('external_id').unique(),
  },
  (table) => [
    index('player_names_player_idx').on(table.playerId),
    index('player_names_name_idx').on(table.name),
    // Bir oyuncunun bir ismi TEK satır. Aynı isim tekrar görülürse yeni satır
    // değil, mevcut satırın first_seen/last_seen aralığı genişler.
    uniqueIndex('player_names_player_name_idx').on(table.playerId, table.name),
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

/**
 * Steam profilinden okunan, oyuncuya ait ama bizim üretmediğimiz veri.
 *
 * `players` tablosuna kolon eklemek yerine ayrı tablo, çünkü buradaki her
 * alan DIŞ bir kaynaktan geliyor ve bayatlayabiliyor: ne zaman okunduğu
 * verinin kendisi kadar önemli. `players` ise kimliğin kendisi — orada
 * bayatlayan bir şey yok.
 *
 * `level` NULL olabilir ve bu "seviye 0" DEMEK DEĞİL: profil gizliyse
 * Steam seviye vermiyor. İkisini karıştırmak, profilini kapatmış herkesi
 * en düşük seviyeymiş gibi işaretlemek olurdu.
 */
export const steamProfiles = pgTable(
  'steam_profiles',
  {
    playerId: uuid('player_id')
      .primaryKey()
      .references(() => players.id),
    /** Steam hesap seviyesi. NULL = okunamadı (gizli profil ya da API hatası). */
    level: integer('level'),
    /** Profil gizli olduğu için mi okunamadı — tekrar denemeye değer mi. */
    private: boolean('private').notNull().default(false),
    checkedAt: timestamp('checked_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('steam_profiles_checked_idx').on(table.checkedAt)],
);

/**
 * Klanlar.
 *
 * Üyelik SteamID ile yönetiliyor: klan yöneticisi panele SteamID listesi
 * yapıştırıyor, sistem oyuncuyu bulup (yoksa oluşturup) bağlıyor. Discord
 * rolüne bağlamak daha zarif olurdu ama klan üyelerinin çoğunun Discord
 * hesabı bizimkine bağlı değil — 550 whitelist kaydından yalnızca 97'sinin
 * bağı var. Bağlı olmayan herkesi klansız saymak, takım dengeleyicinin
 * klanları bir arada tutma işini büyük ölçüde işlevsiz bırakırdı.
 */
export const clans = pgTable(
  'clans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Görünen ad ("Altai Kartalları"). */
    name: text('name').notNull(),
    /**
     * Oyun içi etiket ("ALTAI", "[AK]").
     *
     * Takım dengeleyici oyuncu ADINDA bunu arayabiliyor: üyelik listesinde
     * olmayan ama isminde etiket taşıyan oyuncular da klanla birlikte
     * tutulsun diye. Bu yüzden kısa ve ayırt edici olmalı.
     */
    tag: text('tag'),
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('clans_name_idx').on(table.name)],
);

/**
 * Klan üyeliği.
 *
 * Ayrılma SİLME değil işaretleme: "bu oyuncu o maçta hangi klandaydı"
 * sorusu geçmişe dönük sorulabilmeli — takım dengeleme kararlarının
 * neden öyle verildiğini açıklayan tek kayıt bu.
 */
export const clanMembers = pgTable(
  'clan_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clanId: uuid('clan_id')
      .notNull()
      .references(() => clans.id),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (table) => [
    index('clan_members_clan_idx').on(table.clanId),
    index('clan_members_player_idx').on(table.playerId),
    // Bir oyuncu aynı klana iki kez AKTİF üye olamaz. Kısmi indeks:
    // ayrılıp geri dönen üyenin eski kaydı duruyor ve tam indeks bunu
    // engellerdi.
    uniqueIndex('clan_members_aktif_idx')
      .on(table.clanId, table.playerId)
      .where(sql`${table.removedAt} is null`),
  ],
);
