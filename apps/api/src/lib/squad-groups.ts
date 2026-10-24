import { SQUAD_PERMISSIONS, yalnizcaWhitelistMi } from '@altai/contracts';
import { accessSchema } from '@altai/db';
import { z } from 'zod';

/**
 * Oyun içi grup (Admins.cfg `Group=` satırı) kuralları.
 *
 * Saf fonksiyonlar: uç bunları çağırıyor, testler de doğrudan. Buradaki bir
 * hata sessiz olurdu — Squad bozuk bir satırı hata vermeden yok sayıyor ve
 * "yetki verdim" sanılan kişi oyunda hiçbir şey yapamıyor.
 */

/**
 * Grup adı.
 *
 * Admins.cfg'de `Group=<ad>:<izinler>` ve `Admin=<id>:<ad>` biçimi var;
 * adın içinde `:` ya da `=` olursa satır bölünür. Boşluk da Squad'ın
 * ayrıştırmasında güvenilir değil. Yalnızca harf, rakam, alt çizgi.
 */
export const GRUP_ADI = /^[A-Za-z0-9_]{1,32}$/;

export const GrupGovdesi = z.object({
  squadPermissions: z.array(z.enum(SQUAD_PERMISSIONS)).max(SQUAD_PERMISSIONS.length),
  grantMode: z.enum(accessSchema.GRANT_MODES),
});

export const YeniGrupGovdesi = GrupGovdesi.extend({
  name: z
    .string()
    .trim()
    .regex(GRUP_ADI, 'grup adı yalnızca harf, rakam ve _ içerebilir (en çok 32)'),
});

/** Virgüllü Squad yazımından listeye; boşluk ve büyük harf toleranslı. */
export function izinleriOku(ham: string): string[] {
  return ham
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Listeden Squad yazımına: tekrarsız ve SABİT sırada.
 *
 * Sıra sabit olmalı: aynı izinler farklı sırayla kaydedilince Admins.cfg
 * değişmiş görünüyor ve "kim neyi değiştirdi" incelemesi boşuna uzuyor.
 */
export function izinleriYaz(izinler: readonly string[]): string {
  const kume = new Set(izinler);
  return SQUAD_PERMISSIONS.filter((p) => kume.has(p)).join(',');
}

/**
 * Grup türü ile izinlerin uyumu.
 *
 * 'manual' (elle verilen whitelist) yalnızca rezerve slot verebilir. Kick,
 * ban, kamera gibi YETKİLİ seviyeler Discord rolüne bağlı olmak zorunda:
 * elle verilen yetki, Discord'da rolü alınınca düşmeyen yetki demek — eski
 * sistemin asıl sorunu buydu.
 */
export function grupTuruHatasi(
  izinler: readonly string[],
  grantMode: (typeof accessSchema.GRANT_MODES)[number],
): string | null {
  if (grantMode === 'manual' && !yalnizcaWhitelistMi(izinler)) {
    return 'Elle verilen gruplar yalnızca rezerve slot (reserve) içerebilir. Yetkili izinler Discord rolüne bağlı olmalı.';
  }
  return null;
}

/**
 * Tür değişikliği mevcut bağları koparır mı?
 *
 *  manual → discord : bu gruba elle verilmiş whitelist kayıtları admin
 *                     listesinde REDDEDİLİR, o oyuncular slotlarını kaybeder.
 *                     Aktif kayıt varken engelleniyor.
 *  discord → manual : bir şey kopmuyor. Admin listesi Discord rolünden
 *                     gelen üyeyi whitelist grubuna da yazıyor; izinlerin
 *                     whitelist'e uygunluğunu `grupTuruHatasi` denetliyor.
 */
export function turDegisimiHatasi(
  yeniTur: (typeof accessSchema.GRANT_MODES)[number],
  aktifGrantSayisi: number,
): string | null {
  if (yeniTur === 'discord' && aktifGrantSayisi > 0) {
    return `Bu grupta elle verilmiş ${aktifGrantSayisi} aktif kayıt var. Türü değiştirmek onların slotunu düşürür.`;
  }
  return null;
}
