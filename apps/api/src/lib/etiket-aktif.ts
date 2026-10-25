import { moderationSchema } from '@altai/db';
import { type SQL, and, gt, isNull, or } from 'drizzle-orm';

/**
 * "Bu etiket şu an oyuncuda duruyor mu" — TEK tanım.
 *
 * Etiketler süresiz olarak tasarlanmıştı ve kural tek bir koşuldan
 * ibaretti: `removed_at is null`. Bu koşul yedi ayrı yere elle yazılmıştı.
 * SL ban'a süre eklenince (0029) kural değişti ve yedi kopyadan birini
 * atlamak, yaptırımın bir yolda sürmeye devam etmesi demekti: süresi
 * dolmuş bir SL ban'ın oyuncuyu hâlâ manga liderliğinden atması.
 *
 * Aynı hata ban tarafında da yaşandı (bkz. lib/ban-active.ts ve
 * yaptirimKaynakKosulu): kural iki yerde yazılıydı, biri güncellendi,
 * diğeri unutuldu. O yüzden burada tablo sütununa dokunan HER koşul
 * toplanıyor ve `ban-listesi-valfi.test.ts`'teki gibi bir değişmez
 * testiyle kilitleniyor.
 *
 * İKİ FARKLI SORU VAR, karıştırılmamalı:
 *
 *   aktifEtiketKosulu   — "oyuncuda şu an bu etiket var mı?"  (OKUMA)
 *   kaldirilmamisKosulu — "hangi satırı kaldıracağım?"        (YAZMA)
 *
 * Süresi dolmuş bir atama okumada AKTİF DEĞİLDİR ama hâlâ
 * kaldırılmamıştır: satır duruyor, `removed_at` boş. Yazma yolu o satırı
 * hedefleyebilmeli, yoksa yetkili süresi dolmuş bir etiketi elle
 * kaldırmak istediğinde hiçbir satır eşleşmez.
 */

export interface EtiketZamanlari {
  removedAt: Date | null;
  expiresAt: Date | null;
}

/** Elde hesaplama — profil, listeler ve testler için. */
export function etiketAktifMi(atama: EtiketZamanlari, now: Date): boolean {
  if (atama.removedAt) return false;
  if (!atama.expiresAt) return true;
  return atama.expiresAt.getTime() > now.getTime();
}

/**
 * OKUMA koşulu: oyuncuda şu an duran etiketler.
 *
 * `gt` kullanılıyor, `gte` değil — ban tarafıyla aynı sınır: tam bitiş
 * anında etiket artık geçerli değil.
 */
export function aktifEtiketKosulu(now: Date): SQL | undefined {
  return and(
    isNull(moderationSchema.flagAssignments.removedAt),
    or(
      isNull(moderationSchema.flagAssignments.expiresAt),
      gt(moderationSchema.flagAssignments.expiresAt, now),
    ),
  );
}

/**
 * YAZMA koşulu: henüz elle kaldırılmamış satır.
 *
 * Süreye BAKMIYOR, bilerek. Süresi dolmuş bir atamayı yetkili yine de
 * kaldırabilmeli (kayıtta "kendiliğinden bitti" ile "yetkili kaldırdı"
 * ayrı durur) ve yeniden atama yapılırken eski satır hedeflenebilmeli.
 */
export function kaldirilmamisKosulu(): SQL | undefined {
  return isNull(moderationSchema.flagAssignments.removedAt);
}
