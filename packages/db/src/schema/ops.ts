import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity';
import { servers } from './presence';

/**
 * Plugin ayarları — plan Bölüm 4.6 (ops) ve Bölüm 6.
 *
 * Eski sistemin `config.json` modeli terk ediliyor. Oradaki sorun ayarların
 * dosyada olması değil, ayar değiştirmenin SUNUCUYA GİRİP DOSYA DÜZENLEYİP
 * RESTART ATMAK olmasıydı: her eşik denemesi bir kesinti demekti ve kimin
 * neyi ne zaman değiştirdiği hiçbir yerde durmuyordu.
 *
 * Burada ayar veritabanında, panelden düzenleniyor ve agent'a WS ile
 * itiliyor (hot-reload). Değişiklik denetim kaydı bırakıyor.
 *
 * AGENT'IN BU TABLOYA ERİŞİMİ YOK. Mimari kural (plan Bölüm 3): agent
 * Postgres'e dokunmaz. Ayarlar api tarafından okunur ve uplink üzerinden
 * agent'a gönderilir.
 */
export const pluginConfigs = pgTable(
  'plugin_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Plugin'in kod içindeki adı (`auto-kick-unassigned` gibi).
     * Serbest metin bilinçli: plugin listesi kodda yaşıyor ve enum'a
     * bağlamak her yeni plugin için migration gerektirirdi.
     */
    pluginName: text('plugin_name').notNull(),

    /**
     * null = TÜM sunucular. Sunucuya özel satır varsa o kazanır; böylece
     * "genel ayar + tek sunucuda farklı eşik" tek modelle karşılanıyor.
     */
    serverId: uuid('server_id').references(() => servers.id),

    /**
     * Kapalı bir plugin hiç yüklenmiyor (onEnable çağrılmıyor).
     * Varsayılan KAPALI: yeni bir plugin eklendiğinde kimse istemeden
     * canlı sunucuda çalışmaya başlamasın.
     */
    enabled: boolean('enabled').notNull().default(false),

    /**
     * Plugin'e özel ayarlar. Şekli plugin'in kendi Zod şeması belirliyor;
     * burada şemasız tutuluyor çünkü her plugin farklı.
     */
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),

    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
  },
  (table) => [
    // Aynı plugin + aynı sunucu iki kez tanımlanamaz; yoksa hangi satırın
    // geçerli olduğu belirsizleşir.
    uniqueIndex('plugin_configs_name_server_idx').on(table.pluginName, table.serverId),

    // GENEL satır (server_id NULL) için AYRI kısmi index şart.
    //
    // Postgres unique index'te iki NULL'ı birbirinden farklı sayar, yani
    // yukarıdaki kısıt "aynı plugin için iki genel satır" durumunu HİÇ
    // yakalamıyor. Gerçekten denendi: aynı plugin adıyla iki NULL satır
    // yazıldı, ikisi de kabul edildi. Bu tam da yukarıdaki yorumun
    // engellediğini sandığı şeydi.
    uniqueIndex('plugin_configs_name_global_idx')
      .on(table.pluginName)
      .where(sql`${table.serverId} is null`),

    // Agent bağlandığında "bu sunucunun ayarları" sorgusunun sıcak yolu.
    index('plugin_configs_server_idx').on(table.serverId),
  ],
);

/**
 * Ayar değişikliklerinin tarihçesi — plan Bölüm 8 ("her değişiklik audit
 * loglanır").
 *
 * `activity_log`'dan ayrı duruyor: orası hacimli ve süresi dolunca budanıyor.
 * Bir eşiğin ne zaman ve neden değiştiği ise aylar sonra sorulan bir soru
 * ("balancer ne zamandan beri böyle davranıyor?"), o yüzden burada kalıcı.
 *
 * Öncesi ve sonrası birlikte tutuluyor: yalnızca yeni değeri saklamak
 * "neydi" sorusunu cevapsız bırakır ve geri almayı elle tahmine dönüştürür.
 */
export const configAudit = pgTable(
  'config_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pluginName: text('plugin_name').notNull(),
    serverId: uuid('server_id').references(() => servers.id),
    /** 'create' | 'update' | 'delete' | 'enable' | 'disable' */
    action: text('action').notNull(),
    onceki: jsonb('onceki').$type<Record<string, unknown> | null>(),
    sonraki: jsonb('sonraki').$type<Record<string, unknown> | null>(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    /** O andaki görünen ad — kullanıcı silinse de kayıt okunabilir kalsın. */
    actorLabel: text('actor_label'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('config_audit_plugin_idx').on(table.pluginName, table.createdAt)],
);
