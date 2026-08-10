import { OnlinePlayers } from '@altai/contracts';
import type { Db } from '@altai/db';
import { presenceSchema } from '@altai/db';
import { logger } from '@altai/shared';
import { agentBagliMi, komutGonder } from './agent-command-bus.js';
import { replacePlayers } from './server-state.js';

/**
 * Canlı oyuncu listesini RCON'dan tazeler.
 *
 * Neden gerekli: liste şimdiye kadar yalnızca giriş/çıkış olaylarından
 * türüyordu ve iki şekilde yanlışlıyordu — kaçırılan bir disconnect oyuncuyu
 * sonsuza kadar listede bırakıyor, takım/manga/rol bilgisi ise olaylarda hiç
 * gelmiyor. Panelin ana ekranı bu sütunları gösterdiği için RCON'dan
 * okumak zorunlu.
 *
 * 20 saniye: BattleMetrics'in kendi tazeleme aralığına yakın, RCON'a yük
 * bindirmeyecek kadar seyrek. Aradaki değişimi giriş/çıkış olayları zaten
 * anında yansıtıyor, tazeleme yalnızca doğruyu geri getiriyor.
 */
const ARALIK_MS = 20_000;

/**
 * Tek bir sunucunun listesini okuyup canlı duruma yazar.
 *
 * `taze` = agent önce RCON'a gidip SquadJS'in önbelleğini yenilesin.
 * Periyodik tazelemede gerekmiyor (önbellek zaten 10 sn'de bir yenileniyor)
 * ama bir eylemin hemen ardından ŞART: yenilenmemiş önbellek eylemden
 * önceki durumu döndürüp ekranı geri sarıyordu.
 */
export async function sunucuyuTazele(slug: string, taze = false): Promise<boolean> {
  if (!agentBagliMi(slug)) return false;

  const cevap = await komutGonder(
    slug,
    'listPlayers',
    taze ? { taze: true } : {},
    'player-refresh',
  );
  if (cevap.durum !== 'ok') return false;

  const ayristirilmis = OnlinePlayers.safeParse(cevap.data);
  if (!ayristirilmis.success) {
    logger.error({ slug }, 'oyuncu listesi beklenen biçimde değil');
    return false;
  }

  replacePlayers(
    slug,
    ayristirilmis.data.players
      // Kimliksiz satır profile bağlanamaz ve listede işe yaramaz.
      .filter((p) => p.steamId)
      .map((p) => ({
        steamId: p.steamId as string,
        eosId: p.eosId,
        name: p.name,
        teamId: p.teamId,
        squadId: p.squadId,
        squadName: p.squadName,
        role: p.role,
        isLeader: p.isLeader,
      })),
    new Date().toISOString(),
  );
  return true;
}

export async function oyunculariTazele(db: Db) {
  const sunucular = await db
    .select({ slug: presenceSchema.servers.slug })
    .from(presenceSchema.servers);

  for (const s of sunucular) {
    await sunucuyuTazele(s.slug);
  }
}

/**
 * Bir eylemden hemen sonra listeyi doğrulatmak için.
 *
 * `taze: true` ile: agent SquadJS'in önbelleğini RCON'dan yeniletiyor.
 * Bu olmadan komuttan 2 saniye sonra okunan liste hâlâ eski takımı
 * gösteriyordu ve iyimser güncellemeyi geri alıyordu — ekranda oyuncu
 * karşıya geçip sonra geri dönüyor gibi görünüyordu.
 *
 * Gecikme yine de duruyor: oyunun komutu işlemesi anlık değil.
 */
export function tazelemeyiPlanla(slug: string, gecikmeMs = 2_000) {
  setTimeout(() => {
    void sunucuyuTazele(slug, true).catch((err) =>
      logger.error({ err, slug }, 'eylem sonrası tazeleme başarısız'),
    );
  }, gecikmeMs).unref?.();
}

/** Tazelemeyi başlatır; dönen fonksiyon durdurur. */
export function tazelemeyiBaslat(db: Db): () => void {
  const zamanlayici = setInterval(() => {
    void oyunculariTazele(db).catch((err) => logger.error({ err }, 'oyuncu listesi tazelenemedi'));
  }, ARALIK_MS);
  zamanlayici.unref?.();
  logger.info({ aralikMs: ARALIK_MS }, 'canlı oyuncu tazelemesi başladı');
  return () => clearInterval(zamanlayici);
}
