import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { players, users } from './identity';
import { servers } from './presence';

/**
 * Maç sonuna ertelenmiş takım değişimleri.
 *
 * Bellekte tutulamaz: bir maç 45 dakika sürüyor ve api bu süre içinde
 * kolayca yeniden başlıyor (her dağıtımda oluyor). Bellekte tutsaydık
 * yetkili "maç sonunda geçireceğim" der, oyuncuya haber verilir ve maç
 * bitince hiçbir şey olmazdı — sessiz başarısızlığın en kötü biçimi,
 * çünkü söz verilmiş oluyor.
 *
 * Oyuncu kimliği İKİ biçimde tutuluyor: `playerId` bizim kaydımız,
 * `steamId` ise komutun gerçekten kullandığı şey. Oyuncu veritabanında
 * yoksa (ilk kez giren biri) işlem yine yapılabilmeli.
 */
export const teamChangeQueue = pgTable(
  'team_change_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id),
    playerId: uuid('player_id').references(() => players.id),
    steamId: text('steam_id').notNull(),
    /** Kuyruğa alındığı andaki oyun içi adı — günlükte okunabilir kalsın. */
    playerName: text('player_name'),
    /**
     * Kuyruğa alındığı andaki takımı. Maç sonunda oyuncu zaten karşıya
     * geçmişse (kendi geçti, başka yetkili geçirdi) komutu çalıştırmak
     * onu GERİ getirirdi; bu alan o kontrolü mümkün kılıyor.
     */
    fromTeam: text('from_team'),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id),
    requestedByName: text('requested_by_name'),
    /** Oyuncuya gösterilen uyarı metni. */
    message: text('message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    /** Dolduğunda iş bitmiştir; `result` neyle bittiğini söyler. */
    settledAt: timestamp('settled_at', { withTimezone: true }),
    /** 'ok' | 'oyuncu_yok' | 'zaten_karsida' | 'komut_basarisiz' | 'iptal' */
    result: text('result'),
  },
  (table) => [
    // Maç bitince "bu sunucuda bekleyen var mı" sorgusunun sıcak yolu.
    index('team_change_queue_bekleyen_idx').on(table.serverId, table.settledAt),
    index('team_change_queue_player_idx').on(table.playerId, table.createdAt),
  ],
);
