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
import { clans, players, users } from './identity';
import { servers } from './presence';

/**
 * Topluluk tabloları — plan Faz 5.
 *
 * Kurallar, ticket'lar ve klan savaşları burada toplanıyor. Ayrı dosya
 * olmasının sebebi bunların ortak yanı: hiçbiri oyun sunucusundan
 * TÜREMİYOR, hepsi insanların yazdığı/yönettiği veri. Oyun verisiyle
 * (session, round, snapshot) aynı dosyaya karışmaları, "bu tabloyu kim
 * doldurur" sorusunu bulanıklaştırırdı.
 */

/**
 * Sunucu kuralları.
 *
 * Eski sistemde kurallar üç ayrı yerde yazılıydı: Discord'da bir kanal,
 * sunucu açıklamasında bir metin, ve bir plugin'in config dosyasında bir
 * dizi. Üçü birbirini tutmuyordu ve bir kural değiştiğinde hangisinin
 * güncel olduğu belirsizdi. Tek kaynak burası.
 *
 * `serverId` NULL = tüm sunucularda geçerli genel kural. Sunucuya özel
 * kural (seed sunucusunda farklı davranış) o sunucunun kimliğiyle
 * yazılıyor. Nullable olması bilinçli: kuralların çoğu geneldir ve her
 * sunucu için kopyalamak, birini güncellemeyi unutmak demekti.
 */
export const serverRules = pgTable(
  'server_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id').references(() => servers.id),
    /**
     * Sıra numarası — oyun içinde ve panelde bu sırayla gösteriliyor.
     *
     * `created_at`'e göre sıralamak yetmiyor: kurallar sonradan araya
     * ekleniyor ve yöneticiler sırayı elle değiştiriyor ("en önemli kural
     * başa"). Oyuncuya "3. kural" dendiğinde ikisinin aynı şeyi anlaması
     * için sıranın kararlı ve yönetilebilir olması gerekiyor.
     */
    position: integer('position').notNull().default(0),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Gruplama ("Genel", "Manga", "Yetkili"). Boş bırakılabilir. */
    category: text('category'),
    /**
     * Pasif kural SİLİNMİYOR, işaretleniyor.
     *
     * Bir kural kaldırıldığında geçmiş moderasyon kayıtları ona atıfta
     * bulunmaya devam ediyor ("2. kuraldan ban"). Satırı silmek o
     * kayıtları anlamsızlaştırırdı.
     */
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    /** Son düzenleyen panel kullanıcısı. */
    updatedBy: uuid('updated_by').references(() => users.id),
  },
  (table) => [
    index('server_rules_order_idx').on(table.serverId, table.position),
    index('server_rules_active_idx').on(table.active),
  ],
);

/**
 * Destek talepleri (ticket) — plan Faz 5.
 *
 * Akış Discord'da başlıyor: kişi komutu yazıyor, bot özel bir thread
 * açıyor, konuşma orada geçiyor. Panel bu konuşmanın AYNASI.
 *
 * TRANSKRİPT CANLI YAZILIYOR, kapanışta değil. Eski sistem konuşmayı
 * kapanış anında toplu olarak dışa aktarıyordu ve o an bir şey ters
 * giderse (bot kapalı, thread silinmiş, Discord kesintisi) talebin tamamı
 * kayboluyordu — üstelik en çok ihtiyaç duyulan talepler, tartışmalı olup
 * sonradan geri dönülenlerdi.
 *
 * `discordThreadId` NULLABLE: satır thread'den ÖNCE yazılıyor. Thread
 * oluşturma başarısız olursa elimizde en azından talebin kaydı kalıyor;
 * tersi sırada, thread açılıp veritabanı yazımı düşerse konuşma hiçbir
 * yere bağlanmadan ortada kalırdı.
 */
export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * İnsana görünen numara ("#42").
     *
     * UUID kimse için konuşulabilir değil; yetkililer birbirine "42
     * numaralı talebe bak" diyebilmeli. Sıra veritabanında üretiliyor,
     * Discord'da değil: iki bot örneği aynı numarayı vermemeli.
     */
    number: integer('number').notNull(),
    /** Sınıflandırma ("ban itirazı", "şikayet", "başvuru"). */
    category: text('category'),
    subject: text('subject').notNull(),

    openedByDiscordId: text('opened_by_discord_id').notNull(),
    /** Açan kişinin oyun hesabı — Discord bağı varsa çözülüyor. */
    openedByPlayerId: uuid('opened_by_player_id').references(() => players.id),

    discordGuildId: text('discord_guild_id').notNull(),
    discordThreadId: text('discord_thread_id'),

    /** 'open' | 'claimed' | 'closed'. */
    status: text('status').notNull().default('open'),
    /** Talebi üstlenen yetkili — iki kişinin aynı anda uğraşmasını önler. */
    claimedByDiscordId: text('claimed_by_discord_id'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),

    closedByDiscordId: text('closed_by_discord_id'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closeReason: text('close_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('tickets_number_idx').on(table.discordGuildId, table.number),
    // Thread kimliği tekil: aynı thread'e ikinci bir talep bağlanamaz.
    // Nullable olduğu için thread'i olmayan satırlar bu kısıttan muaf.
    uniqueIndex('tickets_thread_idx').on(table.discordThreadId),
    index('tickets_status_idx').on(table.status, table.createdAt),
    index('tickets_opener_idx').on(table.openedByPlayerId),
  ],
);

/**
 * Talep transkripti — thread'deki her mesaj.
 *
 * `discordMessageId` TEKİL ve bu kritik: bot yeniden bağlandığında ya da
 * geçmişi tarayarak boşluk doldurduğunda aynı mesaj iki kez gelebiliyor.
 * Kısıt olmasa transkript sessizce ikilenirdi ve okuyan kişi konuşmanın
 * gerçekten tekrar ettiğini sanardı.
 *
 * Mesaj SİLİNSE bile satır duruyor. Bir talebin kaydı, taraflardan biri
 * mesajını silebildiği için silinebilir olmamalı — moderasyon geçmişinin
 * anlamı budur.
 */
export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    discordMessageId: text('discord_message_id').notNull(),
    authorDiscordId: text('author_discord_id').notNull(),
    /** Yazıldığı andaki görünen ad — sonradan değişse de kayıt sabit kalır. */
    authorName: text('author_name'),
    body: text('body').notNull().default(''),
    /** Ek dosyaların URL'leri. Discord bunları bir süre sonra siliyor. */
    attachments: jsonb('attachments'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('ticket_messages_ticket_idx').on(table.ticketId, table.sentAt),
    uniqueIndex('ticket_messages_discord_idx').on(table.discordMessageId),
  ],
);

/**
 * Klan savaşı — plan Faz 5 ("klan savaşları/lobi").
 *
 * Klan savaşı gecesi sunucu HERKESE AÇIK KALMAMALI: iki klan anlaşıp
 * saat ayırıyor, araya giren üçüncü kişiler maçı bozuyor. Eski sistemde
 * bu iş `clanwarenforcer` plugin'iyle yapılıyordu ve izinli oyuncu
 * listesi plugin'in config dosyasına elle yazılıyordu — her maç öncesi
 * dosya düzenlemek ve agent'ı yeniden başlatmak gerekiyordu.
 *
 * Burada liste veritabanında ve panelden yönetiliyor; plugin sorguyla
 * okuyor.
 *
 * DURUM AKIŞI: planned -> lobby -> live -> finished. Yaptırım YALNIZCA
 * `live` durumunda uygulanıyor; `lobby` kadroların toplandığı, kimsenin
 * atılmadığı aşama.
 */
export const clanWars = pgTable(
  'clan_wars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id),
    name: text('name').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    /** 'planned' | 'lobby' | 'live' | 'finished' | 'cancelled'. */
    status: text('status').notNull().default('planned'),
    /**
     * Kadro kilidi.
     *
     * Kilitten sonra kadroya ekleme yapılmıyor: maç başladıktan sonra
     * "bir kişi daha ekleyelim" demek, karşı tarafın kabul etmediği bir
     * değişiklik olurdu. Kilit ZAMANI tutuluyor çünkü tartışma çıktığında
     * "kadro ne zaman kapandı" sorusunun cevabı gerekiyor.
     */
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('clan_wars_server_idx').on(table.serverId, table.scheduledAt)],
);

/**
 * Savaşa katılan klanlar ve hangi tarafta oldukları.
 *
 * `side` 1 ya da 2 — Squad'ın takım numaralarıyla aynı. Bir klanın
 * hangi tarafta olduğu maç sırasında takım dengeleyiciyi de ilgilendiriyor.
 */
export const clanWarTeams = pgTable(
  'clan_war_teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    warId: uuid('war_id')
      .notNull()
      .references(() => clanWars.id, { onDelete: 'cascade' }),
    clanId: uuid('clan_id')
      .notNull()
      .references(() => clans.id),
    side: integer('side').notNull(),
  },
  (table) => [
    // Bir klan aynı savaşta iki kez yer alamaz.
    uniqueIndex('clan_war_teams_unique').on(table.warId, table.clanId),
    index('clan_war_teams_war_idx').on(table.warId),
  ],
);

/**
 * Kilitli kadro — savaşa girmesine izin verilen oyuncular.
 *
 * Klan ÜYELİĞİNDEN ayrı tutuluyor ve bu bilinçli. Klanın 60 üyesi olabilir
 * ama savaşa 20'si çıkıyor; ayrıca üyelik maç gecesi değişebiliyor
 * (birisi ayrılıyor, birisi katılıyor) ve yaptırımın dayandığı liste maç
 * boyunca SABİT kalmalı. Üyelik listesine bakan bir yaptırım, maç
 * ortasında klandan çıkarılan birini sunucudan attırırdı.
 */
export const clanWarRoster = pgTable(
  'clan_war_roster',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    warId: uuid('war_id')
      .notNull()
      .references(() => clanWars.id, { onDelete: 'cascade' }),
    clanId: uuid('clan_id')
      .notNull()
      .references(() => clans.id),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Aynı oyuncu aynı savaşta iki kadroda olamaz — iki klan da onu
    // yazmışsa bu bir hata ve sessizce geçilmemeli.
    uniqueIndex('clan_war_roster_unique').on(table.warId, table.playerId),
    index('clan_war_roster_war_idx').on(table.warId),
  ],
);
