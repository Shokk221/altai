import type { PluginConfigRow } from '@altai/contracts';
import type { Db } from '@altai/db';
import { opsSchema, presenceSchema } from '@altai/db';
import { eq, isNull, or } from 'drizzle-orm';
import { adminKayitlari } from './admin-registry.js';
import { agentaGonder, bagliAgentlar } from './agent-command-bus.js';

/**
 * Plugin ayarlarının okunması ve agent'a itilmesi.
 *
 * Agent'ın Postgres'e erişimi yok (plan Bölüm 3), bu yüzden ayarlar api
 * tarafından okunup uplink üzerinden gönderiliyor. İki tetikleyicisi var:
 * agent bağlandığında (hello_ack'in ardından) ve panelden bir ayar
 * değiştiğinde.
 */

/**
 * Bir sunucunun etkin ayar kümesi.
 *
 * Kapsam kuralı: sunucuya özel satır varsa GENEL satırı EZER. Böylece
 * "genel eşik + tek sunucuda farklı eşik" tek modelle karşılanıyor ve
 * her sunucu için ayarın tamamını kopyalamak gerekmiyor.
 */
export async function sunucuAyarlari(db: Db, serverId: string): Promise<PluginConfigRow[]> {
  const satirlar = await db
    .select({
      pluginName: opsSchema.pluginConfigs.pluginName,
      serverId: opsSchema.pluginConfigs.serverId,
      enabled: opsSchema.pluginConfigs.enabled,
      config: opsSchema.pluginConfigs.config,
    })
    .from(opsSchema.pluginConfigs)
    .where(
      or(isNull(opsSchema.pluginConfigs.serverId), eq(opsSchema.pluginConfigs.serverId, serverId)),
    );

  // Sunucuya özel olan kazanır. Önce genelleri koyup üzerine yazıyoruz;
  // sıralamaya güvenmiyoruz çünkü sorgu sırası garanti değil.
  const etkin = new Map<string, PluginConfigRow>();
  for (const s of satirlar) {
    if (s.serverId === null && !etkin.has(s.pluginName)) {
      etkin.set(s.pluginName, { pluginName: s.pluginName, enabled: s.enabled, config: s.config });
    }
  }
  for (const s of satirlar) {
    if (s.serverId !== null) {
      etkin.set(s.pluginName, { pluginName: s.pluginName, enabled: s.enabled, config: s.config });
    }
  }
  return [...etkin.values()];
}

/** Tek bir sunucuya ayarları iter. Agent kopuksa sessizce false döner. */
export async function ayarlariIt(db: Db, serverId: string, serverSlug: string): Promise<boolean> {
  const configs = await sunucuAyarlari(db, serverId);
  return agentaGonder(serverSlug, { type: 'plugin_configs', configs });
}

/**
 * Oyun içi yetki listesini agent'a iter.
 *
 * Kaynak Admins.cfg'yi üreten sorgunun aynısı; plugin muafiyeti ile oyun içi
 * yetki ayrışamasın diye. Kimliği hiç olmayan kayıtlar atlanıyor: plugin
 * oyuncuyu steam/eos ile arıyor, ikisi de yoksa kayıt hiçbir zaman eşleşmez.
 */
export async function adminListesiniIt(
  db: Db,
  serverId: string,
  serverSlug: string,
): Promise<boolean> {
  const kayit = await adminKayitlari(db, serverId);
  const yetkiler = new Map(kayit.groups.map((g) => [g.name, g.permissions]));

  const admins = kayit.entries
    .filter((e) => e.steamId || e.eosId)
    .map((e) => ({
      ...(e.steamId ? { steamId: e.steamId } : {}),
      ...(e.eosId ? { eosId: e.eosId } : {}),
      groupName: e.groupName,
      // Grubun tanımı yoksa boş yetki: "grup var ama hiçbir şey yapamaz".
      // Uydurma yetki vermek, olmayan bir muafiyet yaratmak olurdu.
      permissions: yetkiler.get(e.groupName) ?? '',
    }));

  return agentaGonder(serverSlug, { type: 'admin_list', admins });
}

/**
 * Ayar değişikliğini BAĞLI tüm agent'lara yayar.
 *
 * Hangi sunucunun etkilendiğini hesaplamak yerine hepsine gönderiyoruz:
 * genel (server_id NULL) bir satır zaten hepsini etkiliyor ve ayar kümesi
 * küçük. Yanlış hesaplayıp bir sunucuyu atlamak, gereksiz bir mesaj
 * göndermekten çok daha pahalı — atlanan sunucu panelden farklı bir
 * durumda kalır ve bu hiçbir yerde görünmez.
 */
export async function ayarlariYay(db: Db): Promise<string[]> {
  const sunucular = await db
    .select({ id: presenceSchema.servers.id, slug: presenceSchema.servers.slug })
    .from(presenceSchema.servers);

  const bagli = new Set(bagliAgentlar());
  const gidenler: string[] = [];
  for (const s of sunucular) {
    if (!bagli.has(s.slug)) continue;
    if (await ayarlariIt(db, s.id, s.slug)) gidenler.push(s.slug);
  }
  return gidenler;
}
