import type { Db } from '@altai/db';
import { logger } from '@altai/shared';
import { type OtomatikEtiket, etiketiUygula } from './player-flags.js';

/**
 * CBL uyarısının kalıcı karşılığı.
 *
 * Olayın kendisi `raw_events`'e yazılıyor ve bot geldiğinde oradan render
 * edilecek. Ama bot HENÜZ YOK ve uyarının bir yerde görünmesi gerekiyor;
 * aksi hâlde plugin çalışıyor ama kimse haberdar olmuyor.
 *
 * Bu yüzden oyuncuya panelde görünen bir etiket konuyor. Etiket bir
 * YAPTIRIM değil, bir işaret: moderatör oyuncunun profiline baktığında
 * "bu kişinin başka sunucularda sicili var" bilgisini görüyor ve kararı
 * kendisi veriyor.
 */

export const CBL_ETIKETI: OtomatikEtiket = {
  ad: 'CBL Riski',
  renk: '#ffc40b',
  aciklama:
    'Community Ban List’te eşiğin üzerinde itibar puanı var — başka sunucularda ban geçmişi.',
};

/**
 * Uyarıyı işler. Hiçbir durumda throw etmez.
 *
 * Etiket yalnızca EKLENİYOR, kaldırılmıyor: CBL puanı düşse bile "bir
 * zamanlar işaretlenmişti" bilgisi moderatör için anlamlı ve kaldırma
 * kararı insana ait. Otomatik kaldırma, incelenmemiş bir sicili sessizce
 * temize çıkarırdı.
 */
export async function cblUyarisiniIsle(db: Db, playerId: string, puan: number): Promise<void> {
  try {
    await etiketiUygula(db, playerId, CBL_ETIKETI, true, 'cbl-info');
    logger.info({ playerId, puan }, 'CBL uyarısı kaydedildi');
  } catch (err) {
    logger.error({ err, playerId, puan }, 'CBL uyarısı işlenemedi');
  }
}
