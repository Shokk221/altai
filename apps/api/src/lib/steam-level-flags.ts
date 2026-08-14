import type { Db } from '@altai/db';
import { identitySchema } from '@altai/db';
import { logger } from '@altai/shared';
import { etiketiUygula } from './player-flags.js';

/**
 * Steam seviyesine göre etiketleme.
 *
 * İstek: "3lv altı Steam hesapları kırmızı, 5lv altı sarı olacak şekilde bir
 * flag sistemi." Eski sistemde bu BattleMetrics flag'leriyle yapılacaktı;
 * bizim `flags` tablomuz aynı işi görüyor ve rozetin rengi zaten orada.
 *
 * Karar burada, agent'ta değil. Eşik değiştiğinde (bugün 3, yarın 4) oyun
 * sunucusundaki hiçbir dosyaya dokunmak gerekmiyor; etiketin adı ve rengi
 * de veritabanı satırı olduğu için panelden değiştirilebiliyor.
 *
 * ÜÇ DURUM VAR, ÜÇÜ DE FARKLI:
 *  - seviye okundu ve düşük  -> etiket atanır
 *  - seviye okundu ve yeterli -> varsa etiket KALDIRILIR (hesap büyümüş
 *    olabilir; damganın kalıcı olması yanlış olurdu)
 *  - seviye okunamadı (gizli profil) -> hiçbir şey yapılmaz. Profilini
 *    kapatmak kural ihlali değil ve "okunamadı"yı "seviye 0" saymak
 *    herkesi en düşük seviyeymiş gibi damgalardı.
 */

export interface SeviyeEsigi {
  /** Bu seviyenin ALTINDA olanlar bu etiketi alır. */
  altinda: number;
  flagAdi: string;
  /** Panelde rozet rengi (hex). */
  renk: string;
  aciklama: string;
}

/**
 * Eşikler SIRALI: ilk eşleşen kazanır, o yüzden en dar olan başta.
 * 3'ün altındaki bir hesap 5'in de altında; ikisini birden almamalı.
 */
export const VARSAYILAN_ESIKLER: SeviyeEsigi[] = [
  {
    altinda: 3,
    flagAdi: 'Steam Seviyesi < 3',
    renk: '#dc2626',
    aciklama: 'Steam hesap seviyesi 3’ün altında — yeni ya da tek kullanımlık hesap olabilir.',
  },
  {
    altinda: 5,
    flagAdi: 'Steam Seviyesi < 5',
    renk: '#f59e0b',
    aciklama: 'Steam hesap seviyesi 5’in altında.',
  },
];

/**
 * Seviyeyi kaydeder ve etiketleri güncel duruma getirir.
 *
 * Hiçbir durumda throw etmez: bu bir olay işleyicisinden çağrılıyor ve
 * başarısız olması olay akışını durdurmamalı.
 */
export async function steamSeviyesiniIsle(
  db: Db,
  playerId: string,
  level: number | null,
  gizli: boolean,
  esikler: SeviyeEsigi[] = VARSAYILAN_ESIKLER,
): Promise<void> {
  try {
    // Kayıt her hâlükârda güncelleniyor — gizli profilin de "ne zaman
    // denendi"si tutulmalı, yoksa her girişte tekrar denenir.
    await db
      .insert(identitySchema.steamProfiles)
      .values({ playerId, level, private: gizli, checkedAt: new Date() })
      .onConflictDoUpdate({
        target: identitySchema.steamProfiles.playerId,
        set: { level, private: gizli, checkedAt: new Date() },
      });

    // Seviye okunamadıysa etiketlere DOKUNULMUYOR: ne yeni etiket, ne de
    // eskisinin kaldırılması. Bilmediğimiz bir şeye göre karar vermiyoruz.
    if (level === null) return;

    // Sıralı eşikler: ilk eşleşen kazanır (bkz. VARSAYILAN_ESIKLER).
    const hakEdilen = esikler.find((e) => level < e.altinda) ?? null;

    for (const esik of esikler) {
      await etiketiUygula(
        db,
        playerId,
        { ad: esik.flagAdi, renk: esik.renk, aciklama: esik.aciklama },
        hakEdilen?.flagAdi === esik.flagAdi,
        'steam-level',
      );
    }
  } catch (err) {
    logger.error({ err, playerId, level }, 'Steam seviyesi işlenemedi');
  }
}

/**
 * Seviyeye hangi etiketin düştüğünü söyler (saf — testlerin baktığı yer).
 *
 * `null` = etiket yok. Seviyenin `null` olması (okunamadı) ile yeterince
 * yüksek olması AYNI sonucu veriyor gibi görünse de çağıran taraf ikisini
 * ayırıyor: okunamayanda mevcut etiketler kaldırılmıyor.
 */
export function seviyeEtiketi(
  level: number | null,
  esikler: SeviyeEsigi[] = VARSAYILAN_ESIKLER,
): string | null {
  if (level === null) return null;
  return esikler.find((e) => level < e.altinda)?.flagAdi ?? null;
}
