import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity';
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
